import { describe, expect, test } from "vitest";
import { canTrigger } from "./reactions";
import { loadScoringCharacters } from "./load";
import { scoreTeam, teamScore } from "./score";
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
    expect(good.carry).toBe("Hu Tao");
    expect(bad.breakdown.some((l) => l.reason.includes("also wants field time"))).toBe(true);
  });

  test("double Hydro gets credit for the second Hydro support", () => {
    const double = score("Hu Tao", "Xingqiu", "Yelan", "Zhongli");
    expect(double.breakdown.some((l) => l.reason === "2 supports enable Vaporize")).toBe(true);
  });

  test("same-element supports are not reaction partners (#1)", () => {
    const hutao = score("Hu Tao", "Bennett", "Furina", "Xingqiu");
    const vape = hutao.breakdown.find((l) => l.reason.startsWith("Vaporize:"));
    expect(vape?.reason).toBe("Vaporize: Hu Tao + Furina, Xingqiu");

    const childe = score("Tartaglia", "Bennett", "Furina", "Xiangling");
    expect(childe.breakdown.find((l) => l.reason.startsWith("Vaporize:"))?.reason).toBe(
      "Vaporize: Tartaglia + Bennett, Xiangling",
    );
  });

  test("only the carry's main reaction gets full points (#49)", () => {
    const s = score("Clorinde", "Bennett", "Chevreuse", "Furina");
    const reasons = s.breakdown.map((l) => l.reason);
    expect(reasons.some((r) => r.startsWith("Overloaded:"))).toBe(false);
    expect(reasons).toContain("Overloaded as a secondary reaction");
    expect(score("Clorinde", "Nahida", "Baizhu", "Furina").breakdown.map((l) => l.reason)).toContain(
      "Aggravate: Clorinde + Nahida, Baizhu",
    );
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
    expect(s.breakdown.some((l) => l.rule === "Reactions")).toBe(false);
  });

  test("a main reaction is one of the main DPS's own reactions, or none", () => {
    for (const c of all.filter((c) => c.mainReaction)) {
      expect(c.roles, c.id).toContain("main-dps");
      if (c.mainReaction !== "none") expect(c.reactions, c.id).toContain(c.mainReaction);
    }
  });

  test("Ascendant Gleam scores what it unlocks for this team (#63)", () => {
    const lines = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Moonsign");
    // Two Moonsign members (Aino, Ineffa) reach Ascendant Gleam: Flins's own kit upgrade counts.
    expect(lines("Flins", "Aino", "Ineffa", "Xilonen")).toEqual([
      { rule: "Moonsign", points: 10, reason: "Ascendant Gleam enhances Flins's kit" },
    ]);
    // One Moonsign member is only Nascent Gleam.
    expect(lines("Flins", "Bennett", "Xingqiu", "Xilonen")).toEqual([]);
    // Raiden isn't Moonsign and Lauma's upgrade is for Lunar-Bloom, which Raiden doesn't deal.
    expect(lines("Raiden Shogun", "Aino", "Lauma", "Baizhu")).toEqual([]);
    // Lauma's Lunar-Bloom crit helps Nefer; Nefer's own upgrade counts too.
    const nefer = lines("Nefer", "Lauma", "Aino", "Yaoyao").map((l) => l.reason);
    expect(nefer).toContain("Ascendant Gleam enhances Nefer's kit");
    expect(nefer.some((r) => r.startsWith("Ascendant Gleam: Lauma gives Nefer"))).toBe(true);
    // Linnea's extra Geo shred only helps a Geo carry.
    expect(lines("Zibai", "Linnea", "Columbina", "Xilonen").some((l) => l.reason.startsWith("Ascendant Gleam: Linnea"))).toBe(true);
  });

  test("a team without a main DPS is penalized", () => {
    const s = score("Bennett", "Xingqiu", "Zhongli", "Sucrose");
    expect(s.carry).toBeNull();
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
      expect(buffLine(score("Alhaitham", "Baizhu", "Fischl", "Kuki Shinobu"), "Baizhu")?.points).toBe(9); // Spread bonus
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
      expect(buffLine(score("Nefer", "Aino", "Columbina", "Baizhu"), "Columbina")?.points).toBe(12);
      // Alhaitham triggers Lunar-Bloom with Lauma and a Hydro teammate, so Lauma's buff counts for him.
      expect(buffLine(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu"), "Lauma")?.points).toBe(15);
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

  test("buffer points come from the kit's numbers: +20% damage = 10 points, capped at 15 (#68)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    const hutao = score("Hu Tao", "Furina", "Bennett", "Zhongli");
    expect(buffLine(hutao, "Furina")).toEqual({ rule: "Buffs", points: 15, reason: "Furina buffs Hu Tao (~+43% damage)" });
    expect(buffLine(hutao, "Bennett")?.points).toBe(12);
    expect(buffLine(score("Hu Tao", "Zhongli", "Xingqiu", "Yelan"), "Zhongli")?.points).toBe(8);
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
    // Ifa alone holds ~40 Rescue Essentials points (half his 80): 60% Swirl DMG.
    expect(buff("Ifa", "Varka", "Ifa", "Durin", "Bennett")).toBe("Ifa buffs Varka (~+38% damage)");
    // Lunar-Charged gets only 0.2% per point.
    expect(buff("Ifa", "Flins", "Ifa", "Aino", "Ineffa")).toBe("Ifa buffs Flins (~+5% damage)");
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
    // Neuvillette's charged attacks build none: the 100 she needs to burst, 20%.
    expect(mavuika("Neuvillette", "Mavuika", "Furina", "Escoffier")).toBe("Mavuika buffs Neuvillette (~+13% damage)");
    // Two other Nightsoul members: 200, the full 40%.
    expect(mavuika("Neuvillette", "Mavuika", "Citlali", "Xilonen")).toBe("Mavuika buffs Neuvillette (~+25% damage)");
    // A Normal Attack carry (Clorinde's rotation is "N" attacks) also fills it.
    expect(mavuika("Clorinde", "Mavuika", "Bennett", "Fischl")).toBe("Mavuika buffs Clorinde (~+25% damage)");
  });

  test("a kit buff limited to an attack type only helps carries who use it (#68)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    // Xianyun's bonus is Plunging Attack DMG: Xiao's rotation plunges, Hu Tao's doesn't.
    expect(buffLine(score("Xiao", "Xianyun", "Faruzan", "Furina"), "Xianyun")?.points).toBe(15);
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
    expect(buffs).toEqual([["Furina", 15], ["Bennett", 12]]);
  });

  test("Xiao wants Xianyun or Faruzan (#60)", () => {
    const s = score("Xiao", "Xianyun", "Faruzan", "Furina");
    expect(s.breakdown.map((l) => l.reason)).toContain("Xiao with Xianyun");
    expect(s.breakdown.find((l) => l.reason.startsWith("Faruzan buffs"))?.points).toBe(13);
  });

  test("Electro enablers partner a Dendro carry's Spread (#61)", () => {
    expect(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu").breakdown.map((l) => l.reason)).toContain(
      "Spread: Alhaitham + Kuki Shinobu",
    );
    expect(score("Tighnari", "Yae Miko", "Fischl", "Zhongli").breakdown.map((l) => l.reason)).toContain(
      "Spread: Tighnari + Yae Miko, Fischl",
    );
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
    expect(best.carry).toBe("Hu Tao");
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
