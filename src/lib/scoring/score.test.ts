import { describe, expect, test } from "vitest";
import kitJson from "../../../data/kit.json";
import subDpsBuilds from "../../../data/subdps-builds.json";
import { distributeRolls, type ScaleStat, type SubDpsPriority } from "./benchmark";
import { canTrigger } from "./reactions";
import { carryDamage } from "./damage";
import { fightingSpiritBuilt } from "./kit";
import { loadScoringCharacters } from "./load";
import { scoreTeam, subDpsStats, teamScore } from "./score";
import { findBestTeams } from "./search";
import type { CharacterStats } from "../../types/build";
import type { EffectTag } from "../../types/effects";
import { characterEffects } from "./effects";
import type { ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const team = (...ids: string[]) =>
  ids.map((id) => {
    const c = byId.get(id);
    if (!c) throw new Error(`Unknown character ${id}`);
    return c;
  });
const score = (...ids: string[]) => scoreTeam(team(...ids));

describe("reactions", () => {
  test("base reactions need both elements", () => {
    expect(canTrigger("vaporize", new Set(["Pyro", "Hydro"]))).toBe(true);
    expect(canTrigger("vaporize", new Set(["Pyro", "Cryo"]))).toBe(false);
    expect(canTrigger("swirl", new Set(["Anemo", "Geo"]))).toBe(false);
  });

  test("Lunar and Stellar reactions need a member who converts that reaction (#45, #63)", () => {
    expect(canTrigger("stellar-conduct", new Set(["Electro", "Cryo"]))).toBe(false);
    expect(canTrigger("stellar-conduct", new Set(["Electro", "Cryo"]), new Set(["stellar-conduct"]))).toBe(true);
    // Alyosha benefits from Stellar-Conduct but can't enable it; Sandrone can.
    expect(score("Alyosha", "Ganyu", "Bennett", "Zhongli").activeReactions).not.toContain("stellar-conduct");
    expect(score("Alyosha", "Sandrone", "Bennett", "Zhongli").activeReactions).toContain("stellar-conduct");
  });

  test("conversion is per character, not per family (#63)", () => {
    const active = (...ids: string[]) => score(...ids).activeReactions;
    // Aino is Moonsign but converts nothing; Ineffa converts Electro-Charged.
    expect(active("Raiden Shogun", "Aino", "Bennett", "Zhongli")).not.toContain("lunar-charged");
    expect(active("Raiden Shogun", "Aino", "Ineffa", "Zhongli")).toContain("lunar-charged");
    // Ineffa doesn't convert Bloom; Lauma does.
    expect(active("Nahida", "Ineffa", "Xingqiu", "Zhongli")).not.toContain("lunar-bloom");
    expect(active("Nahida", "Lauma", "Xingqiu", "Zhongli")).toContain("lunar-bloom");
    // Vesna converts Cryo Swirl only; Odette converts Superconduct too.
    expect(active("Vesna", "Fischl", "Ganyu", "Zhongli")).not.toContain("stellar-conduct");
    expect(active("Odette", "Fischl", "Ganyu", "Zhongli")).toContain("stellar-conduct");
  });
});

describe("scoreTeam", () => {
  test("a focused team beats a pile of carries", () => {
    const good = score("Hu Tao", "Xingqiu", "Yelan", "Zhongli");
    const bad = score("Hu Tao", "Raiden Shogun", "Ganyu", "Neuvillette");
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.mainDps).toBe("Hu Tao");
    expect(bad.breakdown.some((l) => l.reason.includes("also wants field time"))).toBe(true);
  });

  // The flat reaction points only apply to carries whose damage isn't modeled yet (Yoimiya, Tartaglia, Keqing):
  // a modeled carry's reactions score by the damage they add (#134).
  test("double Hydro gets credit for the second Hydro support", () => {
    const double = score("Yoimiya", "Xingqiu", "Yelan", "Zhongli");
    expect(double.breakdown.some((l) => l.reason === "2 supports enable Vaporize")).toBe(true);
  });

  test("same-element supports are not reaction partners (#1)", () => {
    const yoimiya = score("Yoimiya", "Bennett", "Furina", "Xingqiu");
    const vape = yoimiya.breakdown.find((l) => l.reason.startsWith("Vaporize:"));
    expect(vape?.reason).toBe("Vaporize: Yoimiya + Furina, Xingqiu");

    const childe = score("Tartaglia", "Bennett", "Furina", "Xiangling");
    expect(childe.breakdown.find((l) => l.reason.startsWith("Vaporize:"))?.reason).toBe(
      "Vaporize: Tartaglia + Bennett, Xiangling",
    );
  });

  test("only the carry's main reaction gets full points (#49)", () => {
    const s = score("Keqing", "Xingqiu", "Furina", "Zhongli");
    const reasons = s.breakdown.map((l) => l.reason);
    expect(reasons.some((r) => r.startsWith("Electrocharged:"))).toBe(false);
    expect(reasons).toContain("Electrocharged as a secondary reaction");
    expect(score("Keqing", "Nahida", "Baizhu", "Furina").breakdown.map((l) => l.reason)).toContain(
      "Aggravate: Keqing + Nahida, Baizhu",
    );
  });

  test("a modeled carry's reactions score by the damage they add (#134)", () => {
    const reactions = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Reactions");
    expect(reactions("Hu Tao", "Xingqiu", "Yelan", "Zhongli")).toEqual([
      { rule: "Reactions", points: 27, reason: "Vaporize adds ~+54% to Hu Tao's damage" },
    ]);
    // Clorinde's Dark-Shattering Flame needs any Electro-related reaction (#141): its own line, at full value with
    // Overloaded alone; Aggravate then scores only what it adds on top.
    expect(reactions("Clorinde", "Bennett", "Chevreuse", "Furina")).toEqual([
      { rule: "Reactions", points: 38, reason: "Any Electro-related reaction enables Clorinde's passive: ~+75% damage" },
    ]);
    expect(reactions("Clorinde", "Fischl", "Nahida", "Kaedehara Kazuha")).toEqual([
      { rule: "Reactions", points: 38, reason: "Any Electro-related reaction enables Clorinde's passive: ~+75% damage" },
      { rule: "Reactions", points: 27, reason: "Aggravate, Quicken add ~+54% to Clorinde's damage, on top of the passive" },
    ]);
    // Reactions the damage model doesn't cover yet keep the flat points: Wriothesley's Freeze.
    expect(reactions("Wriothesley", "Sandrone", "Fischl", "Furina").map((l) => l.reason)).toEqual(["Freeze: Wriothesley + Furina"]);
  });

  test("sub-DPS are measured against the carry without the team's reactions (#134)", () => {
    // Enabling Clorinde's Aggravate scores as a reaction; it doesn't shrink Fischl's share.
    const fischl = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Fischl's own hits"))?.reason;
    expect(fischl("Clorinde", "Fischl", "Nahida", "Zhongli")).toBe("Fischl's own hits add ~+57% damage");
    expect(fischl("Clorinde", "Fischl", "Zhongli", "Chiori")).toBe("Fischl's own hits add ~+57% damage");
  });

  test("a Cryo carry plays Freeze or Melt, not both (#53)", () => {
    const split = (s: ReturnType<typeof scoreTeam>) => s.breakdown.find((l) => l.rule === "Conflicts" && l.reason.includes("split"));
    expect(split(score("Kamisato Ayaka", "Amber", "Bennett", "Furina"))).toEqual({
      rule: "Conflicts",
      points: -15,
      reason: "Hydro (Furina) and Pyro (Amber, Bennett) split Freeze and Melt",
    });
    expect(split(score("Kamisato Ayaka", "Ganyu", "Kamisato Ayato", "Sangonomiya Kokomi"))).toBeUndefined();
    const melt = score("Kamisato Ayaka", "Dehya", "Kaedehara Kazuha", "Bennett");
    expect(split(melt)).toBeUndefined();
    expect(melt.breakdown.some((l) => l.reason.includes("not possible"))).toBe(false);
  });

  test("a hypercarry is not penalized for a team without reactions (#49)", () => {
    const s = score("Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli");
    // Only his passive 1 counts, by the damage it adds (#134): Swirl and Crystallize stacks.
    expect(s.breakdown.filter((l) => l.rule === "Reactions")).toEqual([
      { rule: "Reactions", points: 9, reason: "Swirl, Crystallize add ~+19% to Neuvillette's damage" },
    ]);
  });

  test("a main reaction is one of the main DPS's own reactions, or none", () => {
    for (const c of all.filter((c) => c.mainReaction)) {
      expect(c.roles, c.id).toContain("main-dps");
      if (c.mainReaction !== "none") expect(c.reactions, c.id).toContain(c.mainReaction);
    }
  });

  test("Ascendant Gleam scores what it unlocks for this team (#63)", () => {
    const lines = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Moonsign");
    // Two Moonsign members (Aino, Ineffa) reach Ascendant Gleam: Flins's own kit upgrade counts, by the damage it adds
    // (his thundercloud hit and passive 1's +20%), since his damage model has it (#150).
    expect(lines("Flins", "Aino", "Ineffa", "Xilonen")).toEqual([
      { rule: "Moonsign", points: 24, reason: "Ascendant Gleam adds ~+48% to Flins's damage" },
    ]);
    // One Moonsign member is only Nascent Gleam.
    expect(lines("Flins", "Bennett", "Xingqiu", "Xilonen")).toEqual([]);
    // Raiden isn't Moonsign and Lauma's upgrade is for Lunar-Bloom, which Raiden doesn't deal.
    expect(lines("Raiden Shogun", "Aino", "Lauma", "Baizhu")).toEqual([]);
    // Lauma's Lunar-Bloom crit helps Nefer; Nefer's own upgrade counts too.
    const nefer = lines("Nefer", "Lauma", "Aino", "Yaoyao").map((l) => l.reason);
    expect(nefer.some((r) => r.startsWith("Ascendant Gleam adds") && r.endsWith("to Nefer's damage"))).toBe(true);
    expect(nefer.some((r) => r.startsWith("Ascendant Gleam: Lauma gives Nefer"))).toBe(true);
    // Linnea's extra Geo shred only helps a Geo carry.
    expect(lines("Zibai", "Linnea", "Columbina", "Xilonen").some((l) => l.reason.startsWith("Ascendant Gleam: Linnea"))).toBe(true);
  });

  test("a team without a main DPS is penalized", () => {
    const s = score("Bennett", "Xingqiu", "Zhongli", "Sucrose");
    expect(s.mainDps).toBeNull();
    expect(s.breakdown.some((l) => l.reason === "No main DPS in the team")).toBe(true);
  });

  test("Skirk prefers only Hydro and Cryo teammates", () => {
    const pure = score("Skirk", "Escoffier", "Furina", "Shenhe");
    const mixed = score("Skirk", "Escoffier", "Furina", "Bennett");
    expect(pure.breakdown.some((l) => l.rule === "Team preference" && l.points > 0)).toBe(true);
    expect(mixed.breakdown.some((l) => l.rule === "Team preference" && l.points < 0)).toBe(true);
  });

  test("Varka's mono-element Hexerei preference", () => {
    const met = score("Varka", "Venti", "Klee", "Durin");
    expect(met.breakdown.some((l) => l.reason.startsWith("Varka:"))).toBe(true);
  });

  test("Hexerei only counts for characters whose quest is done", () => {
    const ids = ["Varka", "Venti", "Klee", "Durin"];
    const locked = scoreTeam(team(...ids), { hexereiUnlocked: ["Varka"] });
    expect(locked.breakdown.some((l) => l.rule === "Hexerei")).toBe(false);
    const done = scoreTeam(team(...ids), { hexereiUnlocked: ids });
    expect(done.breakdown.some((l) => l.rule === "Hexerei")).toBe(true);
  });

  test("a reaction bonus reaches only the share of the carry's damage that is that reaction (#87)", () => {
    const gain = (id: string, ...ids: string[]) =>
      Number(score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id))?.reason.match(/~\+(\d+)%/)?.[1] ?? 0);
    // The same Ifa bonus (Swirl, ~60%) is worth less to a Swirl carry than Columbina's Lunar bonus to a Lunar
    // carry, whose damage mostly is the reaction.
    expect(gain("Ifa", "Varka", "Ifa", "Durin", "Bennett")).toBeLessThan(gain("Columbina", "Nefer", "Aino", "Columbina", "Baizhu"));
  });

  test("Hexerei: Secret Rite scores what it turns on for this team (#63)", () => {
    const lines = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Hexerei");
    const reasons = (...ids: string[]) => lines(...ids).map((l) => l.reason);
    // Varka's own kit upgrade, plus Venti's +50% DMG after the carry's own Swirl.
    expect(reasons("Varka", "Venti", "Klee", "Durin")).toContain("Secret Rite enhances Varka's kit");
    expect(reasons("Varka", "Venti", "Klee", "Durin").some((r) => r.startsWith("Secret Rite: Venti gives Varka"))).toBe(true);
    // One Hexerei member: no Secret Rite.
    expect(lines("Varka", "Kaedehara Kazuha", "Bennett", "Xiangling")).toEqual([]);
    // Albedo's Silver Isotoma bonus only reaches Hexerei members, so a Hexerei carry gets more from him.
    const albedo = (...ids: string[]) => lines(...ids).find((l) => l.reason.startsWith("Secret Rite: Albedo"))?.points ?? 0;
    expect(albedo("Klee", "Albedo", "Sucrose", "Furina")).toBeGreaterThan(albedo("Hu Tao", "Albedo", "Sucrose", "Xingqiu"));
    expect(albedo("Hu Tao", "Albedo", "Sucrose", "Xingqiu")).toBeGreaterThan(0);
    // Nicole's bigger Arcane Projections only reach Hexerei members.
    expect(reasons("Varka", "Nicole", "Venti", "Bennett").some((r) => r.startsWith("Secret Rite: Nicole gives Varka"))).toBe(true);
    expect(reasons("Hu Tao", "Nicole", "Mona", "Zhongli")).toEqual([]);
    // Prune's ATK (so her Tolling Rally) grows when a Hexerei carry triggers a reaction.
    expect(reasons("Varka", "Prune", "Venti", "Bennett").some((r) => r.startsWith("Secret Rite: Prune gives Varka"))).toBe(true);
    // Fischl's buffs need Overloaded or Electro-Charged in the team; Mona's need her on the field.
    expect(reasons("Klee", "Fischl", "Durin", "Bennett").some((r) => r.startsWith("Secret Rite: Fischl"))).toBe(true);
    expect(reasons("Varka", "Fischl", "Venti", "Sucrose").some((r) => r.startsWith("Secret Rite: Fischl"))).toBe(false);
    expect(reasons("Klee", "Mona", "Albedo", "Furina").some((r) => r.startsWith("Secret Rite: Mona"))).toBe(false);
  });

  test("Nightsoul Bursts power the carry's own kit, more often with more Natlanese members (#63)", () => {
    const line = (...ids: string[]) => score(...ids).breakdown.find((l) => l.rule === "Nightsoul");
    // Mavuika alone: every 18s, her +30% ATK is up 10s of it; with 3 Natlanese members every 9s, always up.
    const solo = line("Mavuika", "Bennett", "Furina", "Xingqiu")!;
    const three = line("Mavuika", "Xilonen", "Citlali", "Bennett")!;
    expect(solo.reason).toMatch(/^Nightsoul Burst every 18s \(1 Natlan\)/);
    expect(three.reason).toMatch(/^Nightsoul Burst every 9s \(3 Natlan\)/);
    expect(three.points).toBeGreaterThan(solo.points);
    // Pyro Traveler has Nightsoul but isn't Natlanese.
    expect(line("Mavuika", "Traveler (Pyro)", "Bennett", "Furina")!.reason).toContain("(1 Natlan)");
    // Kinich's Hunter's Experience stacks: a kit upgrade, scaled by how many stacks are up.
    expect(line("Kinich", "Xilonen", "Citlali", "Bennett")!.points).toBeGreaterThan(line("Kinich", "Emilie", "Xiangling", "Bennett")!.points);
    // A support's own Nightsoul Burst effect (Kachina's Geo DMG) doesn't score for a non-Natlan carry, and nor
    // does the old flat Nightsoul pair.
    const geo = score("Navia", "Kachina", "Xilonen", "Zhongli").breakdown;
    expect(geo.some((l) => l.rule === "Nightsoul" || (l.rule === "Family" && l.reason.includes("Nightsoul")))).toBe(false);
  });

  test("Stellar Radiance scores what it does for this team (#63)", () => {
    const lines = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Stellar").map((l) => l.reason);
    // Sandrone converts Superconduct (Cryo + Electro) to Stellar-Conduct: her Radiance kit upgrade, plus
    // Alyosha's +20% Stellar-Conduct DMG for the on-field carry.
    const sandrone = lines("Sandrone", "Alyosha", "Fischl", "Bennett");
    expect(sandrone).toContain("Radiance: Stellar-conduct enhances Sandrone's kit");
    expect(sandrone.some((r) => r.startsWith("Alyosha's Stellar buff gives Sandrone"))).toBe(true);
    // No Stellar reaction (no Electro or Anemo partner): no Radiance.
    expect(lines("Sandrone", "Bennett", "Xingqiu", "Zhongli")).toEqual([]);
    // Qiqi's Herald of Frost buffs the carry's Stellar-Conduct.
    expect(lines("Wriothesley", "Qiqi", "Sandrone", "Fischl").some((r) => r.startsWith("Qiqi's Stellar buff"))).toBe(true);
    // Stellar isn't a flat family pair any more.
    expect(score("Sandrone", "Alyosha", "Fischl", "Bennett").breakdown.some((l) => l.rule === "Family")).toBe(false);
  });

  test("a family pair only counts when it helps the team (#43)", () => {
    // Mona and Nicole are Hexerei, but neither has a Secret Rite buff Hu Tao can use.
    const huTao = score("Hu Tao", "Mona", "Nicole", "Zhongli").breakdown;
    expect(huTao.some((l) => l.rule === "Family" || l.rule === "Hexerei")).toBe(false);
    // Hexerei isn't a flat family pair any more: it scores through Secret Rite (#63).
    const varka = score("Varka", "Venti", "Klee", "Durin").breakdown;
    expect(varka.some((l) => l.rule === "Family")).toBe(false);
    expect(varka.some((l) => l.rule === "Hexerei")).toBe(true);
    // Moonsign isn't a flat family pair any more: it scores through Ascendant Gleam (#63).
    const lunar = score("Flins", "Columbina", "Ineffa", "Zhongli");
    expect(lunar.activeReactions).toContain("lunar-charged");
    expect(lunar.breakdown.some((l) => l.rule === "Family")).toBe(false);
    expect(lunar.breakdown.some((l) => l.rule === "Moonsign")).toBe(true);
  });

  test("a support's own team preference counts less than the carry's (#43)", () => {
    const prefs = (s: ReturnType<typeof score>) => s.breakdown.filter((l) => l.rule === "Team preference");
    // Chevreuse wants an all Pyro/Electro team; she's a support here.
    expect(prefs(score("Raiden Shogun", "Chevreuse", "Bennett", "Xiangling")).find((l) => l.reason.startsWith("Chevreuse"))?.points).toBe(5);
    // Zibai carrying with her partner Columbina: full points.
    expect(prefs(score("Zibai", "Columbina", "Illuga", "Zhongli")).find((l) => l.reason === "Zibai with Columbina")?.points).toBe(15);
  });

  test("Witch's Revelation characters count as Stellar only once their quest is done (#45)", () => {
    const ids = ["Wriothesley", "Sandrone", "Fischl", "Furina"];
    // Wriothesley's Radiance: Stellar-Conduct upgrade counts only once his quest is done.
    const stellarFamily = (s: ReturnType<typeof scoreTeam>) => s.breakdown.some((l) => l.rule === "Stellar" && l.reason.includes("Wriothesley's kit"));
    expect(stellarFamily(scoreTeam(team(...ids)))).toBe(true); // no option: all quests assumed done
    expect(stellarFamily(scoreTeam(team(...ids), { revelationUnlocked: [] }))).toBe(false);
    expect(stellarFamily(scoreTeam(team(...ids), { revelationUnlocked: ["Wriothesley"] }))).toBe(true);
  });

  test("partner preference: Zibai with Columbina", () => {
    const s = score("Zibai", "Columbina", "Illuga", "Zhongli");
    expect(s.breakdown.some((l) => l.reason === "Zibai with Columbina")).toBe(true);
  });

  test("Kazuha's buff needs something to swirl", () => {
    const s = score("Arataki Itto", "Kaedehara Kazuha", "Gorou", "Zhongli");
    expect(s.breakdown.some((l) => l.reason.includes("Kaedehara Kazuha buffs"))).toBe(false);
  });

  describe("buffs must fit the carry (#3)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.reason.startsWith(id));

    test("ATK buffs skip HP scalers", () => {
      const line = buffLine(score("Neuvillette", "Bennett", "Furina", "Xiangling"), "Bennett");
      expect(line?.points).toBe(0);
      expect(line?.reason).toBe("Bennett: ATK buff, but Neuvillette scales on HP");
    });

    test("ATK buffs count for carries that scale on ATK", () => {
      expect(buffLine(score("Hu Tao", "Bennett", "Xingqiu", "Yelan"), "Bennett")?.points).toBe(12); // ~+24% (#68)
      expect(buffLine(score("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu"), "Bennett")?.points).toBe(12);
    });

    test("element buffs only count for that element", () => {
      expect(buffLine(score("Hu Tao", "Shenhe", "Xingqiu", "Zhongli"), "Shenhe")?.points).toBe(0);
      expect(buffLine(score("Kamisato Ayaka", "Shenhe", "Furina", "Kaedehara Kazuha"), "Shenhe")?.points).toBe(11);
    });

    test("EM buffs need a reaction that uses EM", () => {
      // Freeze does not scale with EM; Vaporize does.
      expect(buffLine(score("Kamisato Ayaka", "Sucrose", "Furina", "Shenhe"), "Sucrose")?.points).toBe(0);
      expect(buffLine(score("Hu Tao", "Sucrose", "Xingqiu", "Yelan"), "Sucrose")?.points).toBe(11);
    });

    test("reaction buffs need that reaction in the team", () => {
      // Spread bonus: it only adds to Spread's flat damage, ~0.3 of a Spread carry's damage (#87).
      expect(buffLine(score("Alhaitham", "Baizhu", "Fischl", "Kuki Shinobu"), "Baizhu")?.points).toBe(3);
      // Pyro + Dendro, but nobody here builds Burning, so no Dendro reaction is active.
      expect(buffLine(score("Diluc", "Baizhu", "Bennett", "Zhongli"), "Baizhu")?.points).toBe(0);
    });

    test("reaction buffs need a reaction the carry deals (#58)", () => {
      const neuv = score("Neuvillette", "Citlali", "Columbina", "Lauma");
      expect(buffLine(neuv, "Columbina")).toEqual({
        rule: "Buffs",
        points: 0,
        reason: "Columbina: buffs Lunar-charged/Lunar-bloom/Lunar-crystallize, which Neuvillette does not deal",
      });
      expect(buffLine(neuv, "Lauma")?.points).toBe(0);
      // Lunar-Bloom is Nefer's main reaction: ~0.8 of her damage (#87).
      expect(buffLine(score("Nefer", "Aino", "Columbina", "Baizhu"), "Columbina")?.points).toBe(9);
      // Alhaitham triggers Lunar-Bloom with Lauma and a Hydro teammate, so Lauma's buff counts for him, on the
      // ~0.3 of his damage that a side reaction is.
      expect(buffLine(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu"), "Lauma")?.points).toBe(6);
    });

    test("Kazuha's swirl buff does nothing for an Anemo carry (#58)", () => {
      expect(buffLine(score("Xiao", "Bennett", "Kaedehara Kazuha", "Nicole"), "Kaedehara Kazuha")?.points).toBe(0);
      expect(buffLine(score("Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"), "Kaedehara Kazuha")?.points).toBe(10);
    });

    test("every main DPS has scalesOn", () => {
      const missing = all.filter((c) => c.roles.includes("main-dps") && !c.scalesOn?.length).map((c) => c.id);
      expect(missing).toEqual([]);
    });
  });

  test("rejects teams that are not 4 characters", () => {
    expect(() => scoreTeam(team("Hu Tao", "Xingqiu"))).toThrow();
  });

  describe("build checks", () => {
    const benchmark: CharacterStats = {
      atk: 1500, hp: 30000, def: 800, critRate: 60, critDmg: 80,
      energyRecharge: 200, elementalMastery: 100, elementalDmgBonus: 46.6,
    };
    // The team from team(...ids), with stats set for the named members.
    const built = (stats: Record<string, Partial<CharacterStats>>, ...ids: string[]) =>
      team(...ids).map((c) => (stats[c.id] ? { ...c, stats: { ...benchmark, ...stats[c.id] } } : c));
    const lines = (t: ScoringCharacter[], rule: string) => scoreTeam(t).breakdown.filter((l) => l.rule === rule);
    const vape = ["Hu Tao", "Xingqiu", "Yelan", "Zhongli"];

    test("ATK % buffs use the build's base ATK when it has one (#80)", () => {
      // The ~+N% in a line's reason, so small differences show even when points round the same.
      const pct = (t: ScoringCharacter[], start: string) =>
        Number(scoreTeam(t).breakdown.find((l) => l.reason.startsWith(start))?.reason.match(/~\+(\d+)%/)?.[1] ?? 0);
      // Bennett's burst adds a ratio of his base ATK.
      const bennett = ["Hu Tao", "Bennett", "Xingqiu", "Zhongli"];
      const lowBase = pct(built({ Bennett: { baseAtk: 700 } }, ...bennett), "Bennett buffs");
      const highBase = pct(built({ Bennett: { baseAtk: 1100 } }, ...bennett), "Bennett buffs");
      expect(highBase).toBeGreaterThan(lowBase);
      // Prune's Secret Rite: +60% of her base ATK, below her Tolling Rally cap at 2,600 ATK.
      const prune = ["Varka", "Prune", "Venti", "Bennett"];
      const benchmarkWeapon = pct(built({ Prune: { atk: 2600 } }, ...prune), "Secret Rite: Prune");
      const realWeapon = pct(built({ Prune: { atk: 2600, baseAtk: 900 } }, ...prune), "Secret Rite: Prune");
      expect(realWeapon).toBeGreaterThan(benchmarkWeapon);
    });

    test("no stats: no build lines, and the team says it assumes default builds", () => {
      const result = score(...vape);
      expect(result.breakdown.some((l) => l.rule === "Carry build")).toBe(false);
      expect(result.defaultBuilds).toEqual(vape);
    });

    test("carry CV scales the carry's points, within bounds", () => {
      const weak = lines(built({ "Hu Tao": { critRate: 30, critDmg: 60 } }, ...vape), "Carry build"); // CV 120
      const strong = lines(built({ "Hu Tao": { critRate: 80, critDmg: 200 } }, ...vape), "Carry build"); // CV 360
      expect(weak[0].points).toBeLessThan(0);
      expect(weak[0].reason).toBe("Hu Tao CV 120 vs 200 benchmark");
      expect(strong[0].points).toBeGreaterThan(0);
      // Capped at 1.2x, so a huge CV can't outweigh team fit.
      const carryPoints = scoreTeam(team(...vape)).breakdown
        .filter((l) => l.rule === "Carry" || l.rule === "Reactions" || l.rule === "Buffs")
        .reduce((s, l) => s + l.points, 0);
      expect(strong[0].points).toBe(Math.round(carryPoints * 0.2));
    });

    test("a benchmark carry gets no CV line", () => {
      expect(lines(built({ "Hu Tao": {} }, ...vape), "Carry build")).toEqual([]);
    });

    test("ER under the tagged target costs points", () => {
      const result = lines(built({ Xingqiu: { energyRecharge: 120 }, Zhongli: { energyRecharge: 120 } }, ...vape), "Energy");
      expect(result.map((l) => l.reason)).toContain("Xingqiu ER 120% vs 200% target");
      expect(result.some((l) => l.reason.startsWith("Zhongli"))).toBe(false); // target 100%
    });

    test("without erTarget, the default comes from energyNeed; low is not checked", () => {
      const untagged = (t: ScoringCharacter[]) => t.map((c) => ({ ...c, erTarget: undefined }));
      const result = lines(untagged(built({ Xingqiu: { energyRecharge: 120 }, Zhongli: { energyRecharge: 90 } }, ...vape)), "Energy");
      expect(result.map((l) => l.reason)).toContain("Xingqiu ER 120% vs 180% target");
      expect(result.some((l) => l.reason.startsWith("Zhongli"))).toBe(false);
    });

    test("every character with an Energy burst has a drafted erTarget", () => {
      const noEnergyBurst = ["Mavuika", "Skirk"];
      expect(all.filter((c) => !c.erTarget && !noEnergyBurst.includes(c.id)).map((c) => c.id)).toEqual([]);
    });

    test("EM matters for Swirl buffers, not for supports that don't react", () => {
      const swirl = ["Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"];
      expect(lines(built({ "Kaedehara Kazuha": { elementalMastery: 900 } }, ...swirl), "EM")[0]).toMatchObject({
        points: 5,
        reason: "Kaedehara Kazuha has 900 EM for reactions",
      });
      expect(lines(built({ "Kaedehara Kazuha": { elementalMastery: 100 } }, ...swirl), "EM")[0].points).toBe(-5);
      expect(lines(built({ Zhongli: { elementalMastery: 900 } }, ...swirl), "EM")).toEqual([]);
    });
  });
});

describe("sub-DPS (#96)", () => {
  test("Furina's Salon bonus needs another healer to keep members above 50% HP (#130)", () => {
    const share = (...ids: string[]) =>
      Number(score(...ids).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith("Furina"))?.reason.match(/~\+(\d+)%/)?.[1]);
    // Same carry and supports' elements; Bennett heals, Xiangling doesn't.
    expect(share("Neuvillette", "Furina", "Bennett", "Kaedehara Kazuha")).toBeGreaterThan(share("Neuvillette", "Furina", "Xiangling", "Kaedehara Kazuha"));
  });

  test("Lunar sub-DPS hits only fire with their Lunar reaction (#151)", () => {
    const share = (who: string, ...ids: string[]) =>
      Number(score(...ids).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith(who))?.reason.match(/~\+(\d+)%/)?.[1]);
    // Yoimiya isn't modeled yet, so every share is of the same benchmark carry.
    // Ineffa's Overclocking Circuit needs thunderclouds (Lunar-Charged): Xingqiu's Hydro makes them, Zhongli doesn't.
    expect(share("Ineffa", "Yoimiya", "Ineffa", "Xingqiu", "Bennett")).toBeGreaterThan(share("Ineffa", "Yoimiya", "Ineffa", "Zhongli", "Bennett"));
    // Columbina's Gravity Interference needs a Lunar reaction: Ineffa's Electro-Charged turns Lunar-Charged; with
    // Kazuha instead there is none.
    expect(share("Columbina", "Yoimiya", "Columbina", "Ineffa", "Bennett")).toBeGreaterThan(share("Columbina", "Yoimiya", "Columbina", "Kaedehara Kazuha", "Bennett"));
  });

  test("a sub-DPS without a build gets a KQM Standards build for the stat they scale on (#158, #164-#167)", () => {
    const stats = (id: string) => subDpsStats(byId.get(id)!)!;
    // Ineffa scales on ATK: level 90 base 330 + the 500 benchmark weapon, ATK% sands + 4 ATK% rolls, plume, 2 ATK rolls.
    const ineffa = stats("Ineffa");
    expect(ineffa.atk).toBeCloseTo(830 * (1 + 0.466 + 4 * 0.0496) + 311 + 2 * 16.54, 0);
    expect(ineffa.em).toBeCloseTo(2 * 19.82, 1); // KQM: "CRIT > ATK% > EM", so only the 2 fixed EM rolls
    // CRIT Rate circlet, 2 fixed + 8 rolls, and her level 90 ascension stat, CRIT Rate 24.2% (#166).
    expect(ineffa.critRate).toBeCloseTo(0.05 + 0.311 + 10 * 0.0331 + 0.242, 3);
    expect(ineffa.critDmg).toBeCloseTo(0.5 + 12 * 0.0662, 3); // 2 fixed + 10 rolls
    // Columbina scales on HP; KQM "CRIT = HP%" spreads the rolls: HP% 6, CRIT Rate 7, CRIT DMG 7.
    expect(stats("Columbina").hp).toBeCloseTo(14695 * (1 + 0.466 + 8 * 0.0496) + 4780 + 2 * 253.94, 0);
    // Nahida is hand-tagged EM first (#167): EM sands, goblet and circlet, EM 800 (Jessie) + her 115.2 EM ascension stat.
    expect(stats("Nahida")).toMatchObject({ em: 915.2, dmgBonus: 0 });
    // Albedo's Geo DMG ascension stat adds to the Geo goblet.
    expect(stats("Albedo").dmgBonus).toBeCloseTo(0.466 + 0.288, 3);
    // A build always wins over the benchmark.
    const built = { ...byId.get("Ineffa")!, stats: { ...ineffa, elementalMastery: 300, critRate: 50, critDmg: 100, energyRecharge: 120, elementalDmgBonus: 46.6 } };
    expect(subDpsStats(built as ScoringCharacter)).toMatchObject({ em: 300, critRate: 0.5, critDmg: 1, dmgBonus: 0.466 });
  });

  test("the 20 distributed rolls follow the KQM stat priority, each stat up to its cap (#164, #165)", () => {
    const rolls = (scale: ScaleStat, priority?: SubDpsPriority) =>
      Object.fromEntries(Object.entries(distributeRolls(scale, priority)).filter(([, n]) => n > 0));
    // No priority: PR #163's split. CRIT Rate stops at 8 (the circlet is CRIT Rate), CRIT DMG at 10.
    expect(rolls("atk")).toEqual({ critDmg: 10, critRate: 8, atkPct: 2 });
    // A tie fills one roll at a time: Columbina's "CRIT = HP%".
    expect(rolls("hp", { priority: [["critRate", "critDmg", "hpPct"], ["em"]] })).toEqual({ critRate: 7, critDmg: 7, hpPct: 6 });
    // EM first in an EM build: only flower and plume can roll EM (4); then CRIT (no CRIT Rate circlet: up to 10 each).
    expect(rolls("em", { priority: [["em"], ["critRate", "critDmg"]] })).toEqual({ em: 4, critRate: 8, critDmg: 8 });
    // Yelan's "HP% (until 30,000 HP)" stops HP% once the total reaches it.
    const yelan = (n: number) => 14450 * (1 + 0.466 + (2 + n) * 0.0496) + 4780 + 2 * 253.94; // 3 rolls: 30,055
    expect(distributeRolls("hp", { priority: [["hpPct"], ["critRate", "critDmg"], ["hpPct"]], hpPctUntil: 30000 }, yelan)).toMatchObject({
      hpPct: 3,
      critRate: 8,
      critDmg: 9,
    });
  });

  test("every sub-DPS has a hand-tagged scalesOn and a sourced stat priority (#164-#167)", () => {
    const subDps = Object.keys(kitJson.subDps);
    expect(subDps.filter((id) => !byId.get(id)?.scalesOn?.length)).toEqual([]);
    expect(subDps.filter((id) => !(id in subDpsBuilds.characters))).toEqual([]);
    // A KQM quick guide's stat priority, or a marked fallback to PR #163's split where KQM gives none (#165).
    for (const [id, b] of Object.entries(subDpsBuilds.characters) as [string, { source: string; fallback?: boolean; priority: unknown[] }][]) {
      if (b.fallback) expect(b.priority, id).toEqual([]);
      else expect(b.source, id).toMatch(/^https:\/\/keqingmains\.com\//);
    }
  });
});

describe("talent levels (#25)", () => {
  const talents = (normal: number, skill: number, burst: number) => ({ normal, skill, burst });
  // The team from team(...ids), with talent levels set for the named members.
  const leveled = (levels: Record<string, ReturnType<typeof talents>>, ...ids: string[]) =>
    team(...ids).map((c) => (levels[c.id] ? { ...c, talents: levels[c.id] } : c));
  const lines = (t: ScoringCharacter[], rule: string) => scoreTeam(t).breakdown.filter((l) => l.rule === rule);
  const vape = ["Hu Tao", "Bennett", "Xingqiu", "Zhongli"];
  const carryPoints = scoreTeam(team(...vape)).breakdown
    .filter((l) => l.rule === "Carry" || l.rule === "Reactions" || l.rule === "Buffs" || l.rule === "Effects")
    .reduce((sum, l) => sum + l.points, 0);

  test("every main DPS has a key talent and every tag buff says where it comes from", () => {
    expect(all.filter((c) => c.roles.includes("main-dps") && !c.keyTalent).map((c) => c.id)).toEqual([]);
    expect(all.filter((c) => c.buffs?.some((b) => !b.talent)).map((c) => c.id)).toEqual([]);
  });

  test("the carry's key talent scales the carry's points, within bounds", () => {
    const low = lines(leveled({ "Hu Tao": talents(6, 10, 10) }, ...vape), "Carry talent");
    expect(low).toEqual([{ rule: "Carry talent", points: Math.round(carryPoints * (0.7 - 1)), reason: "Hu Tao normal level 6 vs 9 benchmark" }]);
    const high = lines(leveled({ "Hu Tao": talents(13, 1, 1) }, ...vape), "Carry talent");
    expect(high[0].points).toBe(Math.round(carryPoints * 0.15)); // capped at 1.15x
  });

  test("level 9, or no build, gets no talent line", () => {
    expect(lines(leveled({ "Hu Tao": talents(9, 1, 1) }, ...vape), "Carry talent")).toEqual([]);
    expect(lines(team(...vape), "Carry talent")).toEqual([]);
  });

  test("a buffer's points scale with the talent its buff comes from", () => {
    const bennett = (levels: ReturnType<typeof talents>) =>
      lines(leveled({ Bennett: levels }, ...vape), "Buffs").find((l) => l.reason.startsWith("Bennett"));
    expect(bennett(talents(1, 1, 13))).toEqual({ rule: "Buffs", points: 14, reason: "Bennett buffs Hu Tao (~+24% damage, burst level 13)" });
    expect(bennett(talents(13, 13, 6))?.points).toBe(8);
    expect(bennett(talents(9, 9, 9))?.points).toBe(12);
  });

  test("passive buffs don't scale", () => {
    const swirl = ["Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"];
    const kazuha = lines(leveled({ "Kaedehara Kazuha": talents(1, 1, 1) }, ...swirl), "Buffs").find((l) => l.reason.startsWith("Kaedehara"));
    expect(kazuha).toEqual({ rule: "Buffs", points: 10, reason: "Kaedehara Kazuha buffs Hu Tao (~+20% damage)" });
  });

  test("buffer points come from the kit's numbers: +20% damage = 10 points, no cap (#68, #90)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    const hutao = score("Hu Tao", "Furina", "Bennett", "Zhongli");
    // Furina's Fanfare averages 3/4 of its max with a healer (Bennett) here (#90): +52% DMG, ~+32% damage.
    expect(buffLine(hutao, "Furina")).toEqual({ rule: "Buffs", points: 16, reason: "Furina buffs Hu Tao (~+32% damage)" });
    expect(buffLine(hutao, "Bennett")?.points).toBe(12);
    expect(buffLine(score("Hu Tao", "Zhongli", "Xingqiu", "Yelan"), "Zhongli")?.points).toBe(8);
  });

  test("Furina's Fanfare: averaged over her Burst, higher with another healer (#90)", () => {
    const pct = (...ids: string[]) =>
      Number(score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith("Furina"))?.reason.match(/~\+(\d+)%/)?.[1] ?? 0);
    // Without a healer her Salon Members drain each member to 50% HP at most: 200 of 300 Fanfare.
    const healer = pct("Hu Tao", "Furina", "Bennett", "Zhongli");
    const noHealer = pct("Hu Tao", "Furina", "Xingqiu", "Zhongli"); // his Rain Sword heals are too small for Fanfare
    expect(healer).toBeGreaterThan(noHealer);
    expect(healer).toBeLessThan(43); // what max Fanfare all Burst gave before #90
  });

  test("kit values that depend on the team follow their conditions (#68)", () => {
    const buff = (id: string, ...ids: string[]) =>
      score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id))?.reason;
    // Escoffier's shred is 5/10/15/55% for 1/2/3/4 Hydro or Cryo members.
    expect(buff("Escoffier", "Kamisato Ayaka", "Escoffier", "Furina", "Mona")).toBe("Escoffier buffs Kamisato Ayaka (~+36% damage)");
    expect(buff("Escoffier", "Kamisato Ayaka", "Escoffier", "Furina", "Amber")).toBe("Escoffier buffs Kamisato Ayaka (~+14% damage)"); // 3 members: 15%
    // Chevreuse's shred needs every member to be Pyro or Electro.
    expect(buff("Chevreuse", "Raiden Shogun", "Chevreuse", "Xiangling", "Bennett")).toBe("Chevreuse buffs Raiden Shogun (~+28% damage)");
    expect(buff("Chevreuse", "Raiden Shogun", "Chevreuse", "Xiangling", "Xingqiu")).toBe(
      "Chevreuse: their kit's buff doesn't apply to Raiden Shogun's damage",
    );
  });

  test("Ifa's and Prune's buffs come from their kit values (#76)", () => {
    const buff = (id: string, ...ids: string[]) =>
      score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id))?.reason;
    // Ifa alone holds ~40 Rescue Essentials points (half his 80): 60% Swirl DMG, on the ~0.25 of a Swirl
    // carry's damage that Swirl hits are (#87).
    expect(buff("Ifa", "Varka", "Ifa", "Durin", "Bennett")).toBe("Ifa buffs Varka (~+9% damage)");
    // Lunar-Charged gets only 0.2% per point.
    expect(buff("Ifa", "Flins", "Ifa", "Aino", "Ineffa")).toBe("Ifa buffs Flins (~+4% damage)");
    // Prune: 0.025% per ATK point above 2,000; without a build she is assumed at 3,000 ATK.
    expect(buff("Prune", "Klee", "Prune", "Mona", "Bennett")).toBe("Prune buffs Klee (~+16% damage)");
    const stats: CharacterStats = {
      atk: 4200, hp: 15000, def: 800, critRate: 50, critDmg: 100, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 0,
    };
    const built = team("Klee", "Prune", "Mona", "Bennett").map((c) => (c.id === "Prune" ? { ...c, stats } : c));
    // At 4,200 ATK she hits the 50% cap.
    expect(scoreTeam(built).breakdown.find((l) => l.reason.startsWith("Prune"))?.reason).toBe("Prune buffs Klee (~+31% damage)");
  });

  test("Mavuika's bonus grows with the Fighting Spirit the team can build (#68)", () => {
    const mavuika = (...ids: string[]) =>
      score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith("Mavuika"))?.reason;
    // Her own Skill gives 80 and Neuvillette's Charged Attacks none: under the 100 her Burst needs, so no buff (#116).
    expect(mavuika("Neuvillette", "Mavuika", "Furina", "Escoffier")).toBe("Mavuika can't Burst: the team builds ~80 of 100 Fighting Spirit");
    // Kachina's Skill adds 60 and Hu Tao's 14 Normal Attack hits 21: 161 of 200. (Hu Tao, not Neuvillette: with
    // Kachina or Citlali + Xilonen, Mavuika out-damages Neuvillette and takes the on-field slot, #96.)
    expect(mavuika("Hu Tao", "Mavuika", "Kachina", "Xingqiu")).toBe("Mavuika buffs Hu Tao (~+20% damage)");
    // Kachina (60) and Xilonen (90): past the 200 limit, the full 40%.
    expect(mavuika("Hu Tao", "Mavuika", "Kachina", "Xilonen")).toBe("Mavuika buffs Hu Tao (~+25% damage)");
    // Normal Attack hits add 1.5 each: Clorinde's 36 make 134, Hu Tao's 14 make 101 (not the old flat 200).
    expect(mavuika("Clorinde", "Mavuika", "Bennett", "Fischl")).toBe("Mavuika buffs Clorinde (~+17% damage)");
    expect(mavuika("Hu Tao", "Mavuika", "Xingqiu", "Zhongli")).toBe("Mavuika buffs Hu Tao (~+13% damage)");
  });

  test("a sub-DPS source's `when` gates it: Jahoda's robots only at Ascendant Gleam (#100)", () => {
    const jahodaLine = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Jahoda's own hits"))?.reason;
    const pct = (r?: string) => Number(r?.match(/~\+(\d+)%/)?.[1] ?? 0);
    // Jahoda and Columbina are both Moonsign: Ascendant Gleam, so the robots' 10 hits per Burst count.
    const gleam = pct(jahodaLine("Hu Tao", "Jahoda", "Columbina", "Zhongli"));
    const none = pct(jahodaLine("Hu Tao", "Jahoda", "Xingqiu", "Zhongli"));
    expect(gleam).toBeGreaterThan(none);
  });

  test("Fighting Spirit decisions (#126): Ororon's Hydro/Electro points, Raiden's Musou Isshin hits, Skill only", () => {
    const [mav, raiden, ororon, xingqiu, bennett, neuv] = ["Mavuika", "Raiden Shogun", "Ororon", "Xingqiu", "Bennett", "Neuvillette"].map(
      (id) => byId.get(id)!,
    );
    // Ororon: 40 per Nightsoul Burst, + 50 from another Hydro/Electro member's hits, capped at his 80.
    const hutao = byId.get("Hu Tao")!; // Pyro, so only the fourth member decides
    const withOroron = (mate: ScoringCharacter) => fightingSpiritBuilt(mav, hutao, [hutao, mav, ororon, mate]);
    expect(withOroron(xingqiu) - withOroron(bennett)).toBe(40); // 40 + 50 capped at 80
    // Raiden's Musou Isshin Normal Attacks (4 + 3 + 3 in her 3[N3C] N1C) count: 80 (Mavuika's Skill) + 1.5 x 10.
    expect(fightingSpiritBuilt(mav, raiden, [raiden, mav, bennett])).toBe(95);
    // Under 100 she plays Skill only: her default combo without the Burst hit, whatever the team's reaction.
    expect(carryDamage(mav, ["melt"], [mav, byId.get("Citlali")!, bennett, xingqiu])?.combo).toBeDefined();
    expect(carryDamage(mav, [], [mav, bennett, xingqiu, neuv])?.combo).toBe("E C8F (Skill only: can't Burst)");
  });

  test("a kit buff limited to an attack type only helps carries who use it (#68)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    // Xianyun's bonus is Plunging Attack DMG: Xiao's rotation plunges, Hu Tao's doesn't.
    expect(buffLine(score("Xiao", "Xianyun", "Faruzan", "Furina"), "Xianyun")?.points).toBe(29); // uncapped since #90
    expect(buffLine(score("Hu Tao", "Xianyun", "Xingqiu", "Zhongli"), "Xianyun")).toEqual({
      rule: "Buffs",
      points: 0,
      reason: "Xianyun: their kit's buff doesn't apply to Hu Tao's damage",
    });
  });

  test("Pyro resonance only counts for a carry that scales on ATK (#51)", () => {
    const pyro = (s: ReturnType<typeof scoreTeam>) => s.breakdown.find((l) => l.reason.startsWith("Fervent Flames"));
    expect(pyro(score("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu"))?.points).toBe(10);
    expect(pyro(score("Neuvillette", "Bennett", "Xiangling", "Furina"))).toEqual({
      rule: "Resonance",
      points: 0,
      reason: "Fervent Flames (+25% ATK), but Neuvillette scales on HP",
    });
  });

  test("the strongest fitting buffers count, whatever their team order (#60)", () => {
    // Yun Jin is listed first, but Furina and Bennett are worth more, so they are the two that count.
    const s = score("Hu Tao", "Yun Jin", "Bennett", "Furina");
    const buffs = s.breakdown.filter((l) => l.rule === "Buffs").map((l) => [l.reason.split(" ")[0], l.points]);
    expect(buffs).toEqual([["Furina", 16], ["Bennett", 12]]);
  });

  test("Xiao wants Xianyun or Faruzan (#60)", () => {
    const s = score("Xiao", "Xianyun", "Faruzan", "Furina");
    expect(s.breakdown.map((l) => l.reason)).toContain("Xiao with Xianyun");
    expect(s.breakdown.find((l) => l.reason.startsWith("Faruzan buffs"))?.points).toBe(13);
  });

  test("Electro enablers partner a Dendro carry's Spread (#61)", () => {
    // Alhaitham is modeled, so his Spread counts by damage (#134).
    expect(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu").breakdown.map((l) => l.reason)).toContain(
      "Spread adds ~+99% to Alhaitham's damage",
    );
    expect(score("Tighnari", "Yae Miko", "Fischl", "Zhongli").breakdown.map((l) => l.reason)).toContain(
      "Spread: Tighnari + Yae Miko, Fischl",
    );
  });

  test("flat reaction damage is weighed against hits with the team's buffs (#157)", () => {
    const spread = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Spread adds"))?.reason;
    // Bennett's ATK raises Alhaitham's hits but not Spread's flat damage, so Spread adds a smaller share.
    expect(spread("Alhaitham", "Yae Miko", "Nahida", "Zhongli")).toBe("Spread adds ~+99% to Alhaitham's damage");
    expect(spread("Alhaitham", "Bennett", "Nahida", "Kuki Shinobu")).toBe("Spread adds ~+84% to Alhaitham's damage");
    // Lauma's flat DMG is for Bloom-type reactions, not his hits: no change.
    expect(spread("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu")).toBe("Spread adds ~+99% to Alhaitham's damage");
    // Vaporize multiplies the whole hit, so ATK buffs leave its share alone.
    const vape = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Vaporize adds"))?.reason;
    expect(vape("Hu Tao", "Xingqiu", "Bennett", "Zhongli")).toBe(vape("Hu Tao", "Xingqiu", "Yelan", "Zhongli"));
  });

  test("Hydro and Dendro resonance only count when the carry uses the stat (#59)", () => {
    const res = (s: ReturnType<typeof scoreTeam>, name: string) => s.breakdown.find((l) => l.reason.startsWith(name));
    expect(res(score("Kamisato Ayaka", "Diona", "Furina", "Mona"), "Soothing Water")).toEqual({
      rule: "Resonance",
      points: 0,
      reason: "Soothing Water, but Kamisato Ayaka scales on ATK",
    });
    expect(res(score("Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli"), "Soothing Water")?.points).toBe(5);
    expect(res(score("Alhaitham", "Nahida", "Fischl", "Kuki Shinobu"), "Sprawling Greenery")?.points).toBe(5); // EM scaler
    expect(res(score("Kinich", "Emilie", "Xiangling", "Bennett"), "Sprawling Greenery")?.points).toBe(5); // Burning uses EM
  });

  test("a carry wants the off-field sub-DPS its guide teams use (#57)", () => {
    const reasons = score("Kinich", "Emilie", "Xiangling", "Bennett").breakdown.map((l) => l.reason);
    expect(reasons).toContain("Kinich with Emilie");
    expect(score("Raiden Shogun", "Xingqiu", "Xiangling", "Bennett").breakdown.map((l) => l.reason)).toContain(
      "Raiden Shogun with Xiangling",
    );
  });

  test("a hypercarry counts a third buffer (#51)", () => {
    const buffs = (s: ReturnType<typeof scoreTeam>) => s.breakdown.filter((l) => l.rule === "Buffs" && l.points > 0).length;
    expect(buffs(score("Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli"))).toBe(3);
    expect(buffs(score("Hu Tao", "Yelan", "Zhongli", "Sucrose"))).toBe(2);
  });
});

describe("effects.json in scoring", () => {
  // The team from team(...ids), with effects given to the named members.
  const geared = (effects: Record<string, EffectTag[]>, ...ids: string[]) =>
    team(...ids).map((c) => (effects[c.id] ? { ...c, effects: effects[c.id] } : c));
  const lines = (t: ScoringCharacter[], rule: string) => scoreTeam(t).breakdown.filter((l) => l.rule === rule);
  const noblesse: EffectTag = { source: "set", id: "Noblesse Oblige", requires: 4, buffs: [{ stat: "ATK", scope: "team", affects: "ATK" }] };
  const pyroShred: EffectTag = {
    source: "constellation", id: "Xiangling", requires: 1, buffs: [{ stat: "Pyro RES shred", scope: "team", elements: ["Pyro"] }],
  };

  test("an effect buff that fits the carry adds points and names its source", () => {
    const result = lines(geared({ Xiangling: [pyroShred] }, "Hu Tao", "Xingqiu", "Xiangling", "Zhongli"), "Effects");
    expect(result).toEqual([{ rule: "Effects", points: 5, reason: "Xiangling C1: Pyro RES shred for Hu Tao" }]);
  });

  test("effect buffs use the same fit check as tag buffs", () => {
    // Pyro shred does nothing for a Hydro carry; ATK does nothing for an HP scaler.
    expect(lines(geared({ Xiangling: [pyroShred] }, "Neuvillette", "Bennett", "Xiangling", "Furina"), "Effects")).toEqual([]);
    expect(lines(geared({ Bennett: [noblesse] }, "Neuvillette", "Bennett", "Xiangling", "Furina"), "Effects")).toEqual([]);
  });

  test("the same effect on two members counts once", () => {
    const result = lines(geared({ Bennett: [noblesse], Zhongli: [noblesse] }, "Hu Tao", "Bennett", "Xingqiu", "Zhongli"), "Effects");
    expect(result.map((l) => l.reason)).toEqual(["Bennett 4pc Noblesse Oblige: ATK for Hu Tao"]);
  });

  test("the carry's own 'active' effects don't count; its team ones do", () => {
    const selfAtk: EffectTag = { source: "weapon", id: "Thrilling Tales of Dragon Slayers", buffs: [{ stat: "ATK", scope: "active", affects: "ATK" }] };
    const vape = ["Hu Tao", "Xingqiu", "Yelan", "Zhongli"];
    expect(lines(geared({ "Hu Tao": [selfAtk] }, ...vape), "Effects")).toEqual([]);
    expect(lines(geared({ "Hu Tao": [noblesse] }, ...vape), "Effects")).toHaveLength(1);
  });

  test("effect buffs are capped", () => {
    const many = Array.from({ length: 5 }, (_, i): EffectTag => ({
      source: "constellation", id: "Bennett", requires: i + 1, buffs: [{ stat: "DMG Bonus", scope: "team" }],
    }));
    expect(lines(geared({ Bennett: many }, "Hu Tao", "Bennett", "Xingqiu", "Zhongli"), "Effects")).toHaveLength(3);
  });

  test("a battery role from a weapon feeds high-cost bursts", () => {
    const favonius: EffectTag = { source: "weapon", id: "Favonius Sword", roles: ["battery"] };
    const vape = ["Hu Tao", "Xingqiu", "Yelan", "Zhongli"];
    expect(lines(team(...vape), "Energy")[0].points).toBe(-5); // two high-cost bursts, no battery
    expect(lines(geared({ Xingqiu: [favonius] }, ...vape), "Energy")[0]).toEqual({
      rule: "Energy", points: 5, reason: "Xingqiu Favonius Sword feeds high-cost bursts",
    });
  });

  test("an infusion conflicts with a melee carry of another element only", () => {
    const c6: EffectTag = { source: "constellation", id: "Bennett", requires: 6, infusion: "Pyro" };
    const conflicts = (...ids: string[]) => lines(geared({ Bennett: [c6] }, ...ids), "Conflicts");
    expect(conflicts("Kamisato Ayaka", "Bennett", "Kaedehara Kazuha", "Shenhe")).toEqual([
      { rule: "Conflicts", points: -15, reason: "Bennett C6 infuses Kamisato Ayaka's attacks with Pyro" },
    ]);
    expect(conflicts("Hu Tao", "Bennett", "Xingqiu", "Zhongli")).toEqual([]); // Pyro carry
    expect(conflicts("Neuvillette", "Bennett", "Furina", "Xiangling")).toEqual([]); // catalyst
  });

  test("only effects.json entries still marked VERIFY say draft", () => {
    const [hutao, xingqiu, xiangling, zhongli] = team("Hu Tao", "Xingqiu", "Xiangling", "Zhongli");
    const reviewed = characterEffects("Xiangling", 1); // reviewed in #23
    const withC1 = (effects: EffectTag[]) => lines([hutao, xingqiu, { ...xiangling, effects }, zhongli], "Effects");
    expect(withC1(reviewed)[0].reason).toBe("Xiangling C1: Pyro RES shred for Hu Tao");
    const drafted = reviewed.map((e) => ({ ...e, notes: "VERIFY: drafted" }));
    expect(withC1(drafted)[0].reason).toBe("Xiangling C1 (draft): Pyro RES shred for Hu Tao");
  });

  test("a holder-element buff only fits a carry of the holder's element (Celestial Gift)", () => {
    const gift: EffectTag = { source: "set", id: "Celestial Gift", requires: 4, buffs: [{ stat: "Elemental DMG Bonus", scope: "team", holderElement: true }] };
    // Bennett is Pyro: the bonus helps Hu Tao (Pyro), not Neuvillette (Hydro).
    expect(lines(geared({ Bennett: [gift] }, "Hu Tao", "Bennett", "Xingqiu", "Zhongli"), "Effects")).toHaveLength(1);
    expect(lines(geared({ Bennett: [gift] }, "Neuvillette", "Bennett", "Furina", "Zhongli"), "Effects")).toEqual([]);
  });
});

describe("findBestTeams", () => {
  const roster = team(
    "Hu Tao", "Xingqiu", "Yelan", "Zhongli", "Bennett", "Xiangling", "Kaedehara Kazuha", "Raiden Shogun",
    "Nahida", "Kuki Shinobu", "Fischl", "Kamisato Ayaka", "Shenhe", "Skirk", "Escoffier", "Furina",
  );

  test("returns teams sorted by score, up to the limit", () => {
    const top = findBestTeams(roster, { limit: 10 });
    expect(top).toHaveLength(10);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].score).toBeGreaterThanOrEqual(top[i].score);
  });

  test("respects mustInclude and exclude", () => {
    const top = findBestTeams(roster, { mustInclude: ["Hu Tao"], exclude: ["Bennett"], limit: 5 });
    for (const t of top) {
      expect(t.members).toContain("Hu Tao");
      expect(t.members).not.toContain("Bennett");
    }
  });

  test("Hu Tao's best teams use her with Hydro supports", () => {
    const [best] = findBestTeams(roster, { mustInclude: ["Hu Tao"], limit: 1 });
    expect(best.mainDps).toBe("Hu Tao");
    expect(best.activeReactions).toContain("vaporize");
  });

  test("never puts two Travelers in one team", () => {
    const travelers = all.filter((c) => c.id.startsWith("Traveler ("));
    const top = findBestTeams([...travelers, ...team("Hu Tao", "Xingqiu")], { limit: 50 });
    for (const t of top) expect(t.members.filter((m) => m.startsWith("Traveler (")).length).toBeLessThanOrEqual(1);
  });

  test("the search's top teams match scoring every team in full", () => {
    const top = findBestTeams(roster, { limit: 15 });
    const ids = roster.map((c) => c.id);
    const every: ReturnType<typeof scoreTeam>[] = [];
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++)
        for (let c = b + 1; c < ids.length; c++)
          for (let d = c + 1; d < ids.length; d++) every.push(score(ids[a], ids[b], ids[c], ids[d]));
    // The search skips teams by their points-only score, so it must always equal the full score.
    for (const t of every) expect(teamScore(team(...t.members))).toBe(t.score);
    const scores = every.map((t) => t.score).sort((x, y) => y - x).slice(0, 15);
    expect(top.map((t) => t.score)).toEqual(scores);
    for (const t of top) expect(t).toEqual(scoreTeam(team(...t.members)));
  });

  test("unknown required character is an error", () => {
    expect(() => findBestTeams(roster, { mustInclude: ["Nobody"] })).toThrow();
  });
});
