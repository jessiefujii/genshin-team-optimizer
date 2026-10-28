import { describe, expect, test } from "vitest";
import kitJson from "../../../data/kit.json";
import subDpsBuilds from "../../../data/subdps-builds.json";
import { distributeRolls, type ScaleStat, type SubDpsPriority } from "./benchmark";
import { canTrigger } from "./reactions";
import { carryDamage } from "./damage";
import { fightingSpiritBuilt, kitBuffValue, memberBuffStats, teamBuffStats } from "./kit";
import { loadScoringCharacters } from "./load";
import { scoreTeam, subDpsStats, teamScore, topElement } from "./score";
import { findBestTeams } from "./search";
import type { CharacterStats } from "../../types/build";
import type { EffectTag } from "../../types/effects";
import { characterEffects } from "./effects";
import type { ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
// Diluc, Keqing and Tartaglia with no damage model (#203, #232 model them): the flat-point paths for carries not
// modeled yet (reaction partners, buffer points) are tested on these copies. Same tags; only the id differs, so no
// carry kit.
for (const id of ["Diluc", "Keqing", "Tartaglia", "Lyney", "Neuvillette", "Kamisato Ayaka"]) byId.set(`${id} (no model)`, { ...byId.get(id)!, id: `${id} (no model)` });
const team = (...ids: string[]) =>
  ids.map((id) => {
    const c = byId.get(id);
    if (!c) throw new Error(`Unknown character ${id}`);
    return c;
  });
const score = (...ids: string[]) => scoreTeam(team(...ids));
// A sub-DPS's own damage per second, from their Sub-DPS line (#202).
const dps = (reason?: string) => Number(reason?.match(/~(\d+) damage per second/)?.[1] ?? 0);

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

  // The flat reaction points only apply to carries whose damage isn't modeled yet (the "(no model)" copies):
  // a modeled carry's reactions score by the damage they add (#134).
  test("double Hydro gets credit for the second Hydro support", () => {
    const double = score("Diluc (no model)", "Xingqiu", "Yelan", "Zhongli");
    expect(double.breakdown.some((l) => l.reason === "2 supports enable Vaporize")).toBe(true);
  });

  test("same-element supports are not reaction partners (#1)", () => {
    const diluc = score("Diluc (no model)", "Bennett", "Furina", "Xingqiu");
    const vape = diluc.breakdown.find((l) => l.reason.startsWith("Vaporize:"));
    expect(vape?.reason).toBe("Vaporize: Diluc (no model) + Furina, Xingqiu");

    const childe = score("Tartaglia (no model)", "Bennett", "Furina", "Xiangling");
    expect(childe.breakdown.find((l) => l.reason.startsWith("Vaporize:"))?.reason).toBe(
      "Vaporize: Tartaglia (no model) + Bennett, Xiangling",
    );
  });

  test("only the carry's main reaction gets full points (#49)", () => {
    const s = score("Keqing (no model)", "Xingqiu", "Furina", "Zhongli");
    const reasons = s.breakdown.map((l) => l.reason);
    expect(reasons.some((r) => r.startsWith("Electrocharged:"))).toBe(false);
    expect(reasons).toContain("Electrocharged as a secondary reaction");
    // Partners list in the fixed member order the team is read in (#201).
    expect(score("Keqing (no model)", "Nahida", "Baizhu", "Furina").breakdown.map((l) => l.reason)).toContain(
      "Aggravate: Keqing (no model) + Baizhu, Nahida",
    );
  });

  test("an aura feeds the carry's Vaporize or a sub-DPS's, not both (#239)", () => {
    const reasons = (...ids: string[]) => score(...ids).breakdown.map((l) => l.reason);
    // Columbina's Hydro lays the aura Klee's Pyro vaporizes on, so her own hits can't vaporize on Klee's Pyro too.
    const klee = reasons("Klee", "Albedo", "Bennett", "Columbina");
    expect(klee.some((r) => r.startsWith("Vaporize adds") && r.endsWith("to Klee's damage"))).toBe(true);
    expect(klee.find((r) => r.startsWith("Columbina's own hits"))).not.toMatch(/with Vaporize/);
    // Two Hydro sources leave Hu Tao her full share: every Charged Attack and Blood Blossom, 5 of her 14 Normal Attack
    // hits (#226: carryIcd, Thrusting Attack ICD and the Default one), with her guide's Crimson Witch: +15% Vaporize (#206).
    expect(reasons("Hu Tao", "Xingqiu", "Yelan", "Zhongli")).toContain("Vaporize adds ~+78% to Hu Tao's damage");
    // Gaming's main reaction is Melt; his Vaporize teams amplify by Vaporize (his Vaporize combo). Plunging Attacks
    // have no ICD (#226): all 7 react. Xianyun's flat Plunge DMG is on those 7, not his Burst hits (#299).
    expect(reasons("Gaming", "Furina", "Xianyun", "Bennett")).toContain("Vaporize adds ~+87% to Gaming's damage"); // his benchmark Fruitful Hook (#206), Fervent Flames in damage (#186)
  });

  test("Ocean-Hued Clam turns its wearer's healing into team damage (#345, heal rate estimated: #351)", () => {
    const stats: CharacterStats = {
      atk: 1500, hp: 30000, def: 800, critRate: 20, critDmg: 50, energyRecharge: 180, elementalMastery: 0, elementalDmgBonus: 0,
    };
    const mika = (sets: { set: string; pieces: 4 }[]) => ({ ...team("Mika")[0], stats, sets });
    const run = (sets: { set: string; pieces: 4 }[]) => scoreTeam([team("Eula")[0], mika(sets), ...team("Raiden Shogun", "Rosaria")]);
    const clam = run([{ set: "Ocean-Hued Clam", pieces: 4 }]);
    const line = clam.breakdown.find((l) => l.reason.startsWith("Mika's Ocean-Hued Clam"));
    // ~1,715 healing a second (4.13% of 30,000 HP + 476) x 83% uptime: a foam of 90% of 3s of it every 3.5s, vs 10% RES.
    expect(Number(line?.reason.match(/~(\d+) damage/)?.[1])).toBeCloseTo((1715 * 0.8333 * 3 * 0.9 * 0.9) / 3.5, -1);
    expect(run([]).breakdown.some((l) => l.reason.includes("Ocean-Hued Clam"))).toBe(false);
  });

  test("Spread and Aggravate need the Quicken aura, which Hydro eats (#303)", () => {
    const reasons = (...ids: string[]) => score(...ids).breakdown.map((l) => l.reason);
    const spread = (...ids: string[]) => Number(reasons(...ids).find((r) => r.startsWith("Spread adds"))?.match(/\+(\d+)%/)?.[1] ?? 0);
    const own = (who: string, ...ids: string[]) => dps(reasons(...ids).find((r) => r.startsWith(`${who}'s own hits`)));
    // No Hydro or Pyro: the Quicken aura is up throughout, every applying hit Spreads (as before #303; ICDs #226, sets #206).
    expect(spread("Alhaitham", "Yae Miko", "Nahida", "Zhongli")).toBe(69); // his benchmark Wolf-Fang (#206); Nahida's EM in damage (#186); Zhongli's Tenacity ATK (#338)
    // Furina's Hydro turns the Quicken aura into Bloom: Alhaitham Spreads about half the time, and Yae Aggravates less.
    // Xilonen's Crystallize takes some of the Electro and Hydro too (#342): 29.
    const furina = spread("Alhaitham", "Furina", "Xilonen", "Yae Miko");
    expect(furina).toBeGreaterThan(25);
    expect(furina).toBeLessThan(70);
    expect(own("Yae Miko", "Alhaitham", "Furina", "Xilonen", "Yae Miko")).toBeLessThan(31193); // 31193 before #303
    // Kazuha's Anemo doesn't touch Quicken: Clorinde keeps her full Aggravate there.
    expect(reasons("Clorinde", "Fischl", "Nahida", "Kaedehara Kazuha")).toContain("Aggravate, Quicken add ~+39% to Clorinde's damage, on top of the passive") // Nahida's EM in damage (#186); // ICDs (#226)
  });

  test("Dendro Cores: Electro pops them into Hyperbloom, none with a Lunar-Bloom converter (#253)", () => {
    const reasons = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Reactions").map((l) => l.reason);
    const hyper = reasons("Alhaitham", "Xingqiu", "Kuki Shinobu", "Nahida");
    expect(hyper.some((r) => r.startsWith("Hyperbloom:") && r.includes("Kuki Shinobu"))).toBe(true);
    expect(hyper.some((r) => r.startsWith("Bloom:"))).toBe(true); // the cores no Electro reached
    // Nefer's team turns Bloom into Lunar-Bloom: no cores.
    expect(reasons("Nefer", "Furina", "Lauma", "Ineffa").some((r) => /^(Bloom|Hyperbloom|Burgeon):/.test(r))).toBe(false);
  });

  test("a modeled carry's reactions are inside their damage, with a 0-point line saying what they add (#134, #202)", () => {
    const reactions = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Reactions");
    expect(reactions("Hu Tao", "Xingqiu", "Yelan", "Zhongli")).toEqual([
      { rule: "Reactions", points: 0, reason: "Vaporize adds ~+78% to Hu Tao's damage" }, // ICDs (#226), Crimson Witch (#206)
    ]);
    // Clorinde's Dark-Shattering Flame needs any Electro-related reaction (#141): its own line, at full value with
    // Overloaded alone; Aggravate then adds only what it adds on top. Overloaded's own damage is a 0-point line too (#205).
    expect(reactions("Clorinde", "Bennett", "Chevreuse", "Furina")).toEqual([
      // Bennett's Noblesse (#338) and Chevreuse's Tenacity, Noblesse taken (#348), raise her ATK, not the passive's share.
      { rule: "Reactions", points: 0, reason: "Any Electro-related reaction enables Clorinde's passive: ~+69% damage" },
      { rule: "Reactions", points: 0, reason: "Overloaded: ~1178 damage per second (Bennett ~0.1/s, Chevreuse ~0.1/s)" },
      { rule: "Reactions", points: 0, reason: "Electrocharged: ~4335 damage per second (Clorinde ~0.4/s, Furina ~0.6/s)" },
    ]);
    expect(reactions("Clorinde", "Fischl", "Nahida", "Kaedehara Kazuha")).toEqual([
      { rule: "Reactions", points: 0, reason: "Any Electro-related reaction enables Clorinde's passive: ~+77% damage" },
      // 1 in 3 of her Swift Hunt and Impale hits applies Electro (one Normal Attack ICD, #226), 2 of 5 Burst hits.
      { rule: "Reactions", points: 0, reason: "Aggravate, Quicken add ~+39% to Clorinde's damage, on top of the passive" },
      // Kazuha's Swirls on the Electro aura Quicken shares in the aura budget (#253).
      { rule: "Reactions", points: 0, reason: "Swirl: ~3213 damage per second (Kaedehara Kazuha ~0.4/s)" }, // his guide's VV: shred (#338), Swirl DMG (#344)
    ]);
    // Reactions the damage model doesn't cover yet keep the flat points: Wriothesley's Freeze. Fischl's and Furina's
    // Electro-Charged deals its own damage (#205); no Superconduct, which Sandrone turns into Stellar-Conduct.
    expect(reactions("Wriothesley", "Sandrone", "Fischl", "Furina").map((l) => l.reason)).toEqual([
      "Freeze: Wriothesley + Furina",
      "Electrocharged: ~2327 damage per second (Fischl ~0.2/s, Furina ~0.5/s)",
    ]);
  });

  test("sub-DPS add their own damage per second to the team, whatever the carry's reactions (#134, #202)", () => {
    // Nahida's Dendro lets Fischl's own hits Aggravate (#153), which adds to her damage; Chiori's Geo doesn't.
    const fischl = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Fischl's own hits"))?.reason;
    expect(fischl("Clorinde", "Fischl", "Zhongli", "Chiori")).toMatch(/^Fischl's own hits: ~\d+ damage per second$/);
    expect(fischl("Clorinde", "Fischl", "Nahida", "Zhongli")).toMatch(/^Fischl's own hits: ~\d+ damage per second, with Aggravate$/);
    expect(dps(fischl("Clorinde", "Fischl", "Nahida", "Zhongli"))).toBeGreaterThan(dps(fischl("Clorinde", "Fischl", "Zhongli", "Chiori")));
  });

  test("a sub-DPS's own hits react when a teammate brings the other element (#153)", () => {
    const line = (id: string, ...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith(`${id}'s own hits`))?.reason;
    const pct = dps;
    // Hu Tao's Pyro reacts with Xingqiu's Hydro and leaves little Pyro aura, so his swords don't vaporize (#191).
    expect(line("Xingqiu", "Hu Tao", "Xingqiu", "Yelan", "Zhongli")).not.toMatch(/with/);
    // Xiangling's Pyro vaporizes on Xingqiu's Hydro with Raiden, though neither is on field.
    expect(line("Xiangling", "Raiden Shogun", "Xiangling", "Xingqiu", "Bennett")).toMatch(/, with Vaporize$/);
    // Without a Pyro member, Xingqiu's hits don't amplify (Bloom is a transformative reaction: not counted here).
    expect(line("Xingqiu", "Alhaitham", "Xingqiu", "Nahida", "Zhongli")).not.toMatch(/with/);
    // Anemo and Geo hits never amplify or catalyze.
    expect(line("Chiori", "Clorinde", "Fischl", "Nahida", "Chiori")).not.toMatch(/with/);
    // The reaction adds to the share: Fischl with Nahida (Aggravate) beats Fischl with Chiori.
    expect(pct(line("Fischl", "Clorinde", "Fischl", "Nahida", "Zhongli"))).toBeGreaterThan(pct(line("Fischl", "Clorinde", "Fischl", "Zhongli", "Chiori")));
  });

  test("Vaporize and Melt on sub-DPS hits share one aura budget (#189, #191)", () => {
    const line = (id: string, ...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith(`${id}'s own hits`))?.reason;
    const pct = dps;
    // Durin's Pyro melts on Skirk's and Escoffier's Cryo aura, once per aura (#329), so it lays no Pyro aura for
    // Escoffier to melt on; Xingqiu's Hydro vaporizes some of that Pyro first. (Xingqiu, not Furina: her Fanfare buffs
    // Durin's hits too, #204, which would hide the lost Melt.)
    const withZhongli = line("Durin", "Skirk", "Escoffier", "Durin", "Zhongli");
    expect(withZhongli).toMatch(/, with Melt$/);
    expect(line("Escoffier", "Skirk", "Escoffier", "Durin", "Zhongli")).not.toMatch(/with/);
    expect(pct(line("Durin", "Skirk", "Escoffier", "Durin", "Xingqiu"))).toBeLessThan(pct(withZhongli));
    // Xiangling's Pyronado has no ICD (#190) and Xingqiu re-applies Hydro: most of her hits vaporize. Her benchmark
    // build spends rolls on ER for her 200% target (#173), so less ATK and crit than before.
    expect(line("Xiangling", "Raiden Shogun", "Xiangling", "Xingqiu", "Bennett")).toMatch(/, with Vaporize$/);
  });

  test("Durin plays his Darkness form where his own Vaporize or Melt is the point (#316)", () => {
    const line = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Durin's own hits"))!.reason;
    // Vaporize, no Burning/Overloaded/Swirl/Crystallize for White Flame's shred: Dark Decay, +40% Vaporize DMG. (Yelan:
    // Xilonen Crystallizes since #342, and with her he plays Purity; ~30k with her Pyro shred before.)
    expect(dps(line("Neuvillette", "Yelan", "Furina", "Durin"))).toBeGreaterThan(24000);
    // Zhongli's Crystallize keeps Purity: White Flame's shred has a reaction to use. Without it (Shenhe) he plays
    // Darkness and deals more, though Zhongli's RES shred helps his hits too.
    expect(line("Skirk", "Escoffier", "Durin", "Zhongli")).toMatch(/with Melt$/);
    expect(dps(line("Skirk", "Escoffier", "Durin", "Zhongli"))).toBeLessThan(dps(line("Skirk", "Escoffier", "Durin", "Shenhe")));
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

  test("only shields count for Arlecchino's survivability: she can't be healed in combat (#2)", () => {
    const survival = (...ids: string[]) => score(...ids).breakdown.find((l) => l.rule === "Survivability")!;
    expect(survival("Arlecchino", "Bennett", "Chevreuse", "Fischl")).toMatchObject({ points: -10, reason: "No shielder (Arlecchino can't be healed)" });
    // Zhongli's Geo crystallizes the team's auras too: Crystallize shields count as shields (#208).
    expect(survival("Arlecchino", "Bennett", "Yelan", "Zhongli").reason).toBe("Zhongli, Crystallize shields shield ~100% of an Abyss hit per rotation");
    // Other carries still count healers.
    expect(survival("Hu Tao", "Xingqiu", "Bennett", "Zhongli").reason).toBe(
      "Bennett, Xingqiu, Zhongli, Crystallize shields heal, shield or mitigate ~100% of an Abyss hit per rotation",
    );
  });

  test("Clorinde heals herself on field: her guide's Aggravate team isn't 'No healer' (#324)", () => {
    const survival = (...ids: string[]) => score(...ids).breakdown.find((l) => l.rule === "Survivability")!;
    expect(survival("Clorinde", "Fischl", "Nahida", "Kaedehara Kazuha")).toMatchObject({
      points: 10,
      reason: "Clorinde heal or shield ~100% of an Abyss hit per rotation",
    });
    // Only as the on-field carry: as a teammate she isn't anyone's healer.
    expect(survival("Raiden Shogun", "Clorinde", "Fischl", "Kaedehara Kazuha").reason).toBe("No healer or shielder");
  });

  test("a hypercarry is not penalized for a team without reactions (#49)", () => {
    const s = score("Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli");
    // His passive 1 counts by the damage it adds (#134): Swirl and Crystallize stacks; Kazuha's Swirls by their own
    // damage (#205). No flat points either way.
    expect(s.breakdown.filter((l) => l.rule === "Reactions")).toEqual([
      { rule: "Reactions", points: 0, reason: "Swirl, Crystallize add ~+20% to Neuvillette's damage" },
      { rule: "Reactions", points: 0, reason: "Swirl: ~2566 damage per second (Kaedehara Kazuha ~0.3/s)" }, // his guide's VV: shred (#338), Swirl DMG (#344)
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
    // Two Moonsign members (Aino, Ineffa) reach Ascendant Gleam: Flins's own kit upgrade (his thundercloud hit and
    // passive 1's +20%) is in his damage model (#150), so the line says what it adds with 0 points, not twice (#245);
    // so is his guide's Night of the Sky's Unveiling going from 15% to 30% CRIT Rate (#206). 71% -> 73% with Night's
    // Gleaming Moon +10% Lunar Reaction DMG in his hits (#306), the unlocked ones included.
    expect(lines("Flins", "Aino", "Ineffa", "Xilonen")).toEqual([
      { rule: "Moonsign", points: 0, reason: "Ascendant Gleam adds ~+73% to Flins's damage" },
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

  // tags.json has no team preferences since #97 (the guide-derived #57 ones were dropped once sub-DPS scoring came
  // from the kit); the mechanism stays for hand-written ones, tested with made-up preferences.
  test("no team preferences in tags.json; the mechanism still scores made-up ones (#97, #43)", () => {
    expect(all.filter((c) => c.teamPrefs?.length).map((c) => c.id)).toEqual([]);
    const withPrefs = (prefs: Record<string, ScoringCharacter["teamPrefs"]>, ...ids: string[]) =>
      scoreTeam(team(...ids).map((c) => (prefs[c.id] ? { ...c, teamPrefs: prefs[c.id] } : c))).breakdown.filter(
        (l) => l.rule === "Team preference",
      );
    // A carry's partner preference counts fully; a support's composition preference counts less.
    expect(withPrefs({ Zibai: [{ kind: "partner", ids: ["Columbina"] }] }, "Zibai", "Columbina", "Illuga", "Zhongli")).toEqual([
      { rule: "Team preference", points: 15, reason: "Zibai with Columbina" },
    ]);
    const chevreuse = withPrefs(
      { Chevreuse: [{ kind: "composition", onlyElements: ["Pyro", "Electro"], note: "only Pyro and Electro" }] },
      "Raiden Shogun", "Chevreuse", "Bennett", "Xiangling",
    );
    expect(chevreuse.find((l) => l.reason.startsWith("Chevreuse"))?.points).toBe(5);
    // A carry's onlyElements preference that the team breaks costs points.
    const skirk = { Skirk: [{ kind: "composition" as const, onlyElements: ["Hydro" as const, "Cryo" as const] }] };
    expect(withPrefs(skirk, "Skirk", "Escoffier", "Furina", "Bennett").some((l) => l.points < 0)).toBe(true);
  });

  test("survivability scores by how much of the rotation shields and heals cover (#177)", () => {
    const line = (...ids: string[]) => score(...ids).breakdown.find((l) => l.rule === "Survivability")!;
    // Zhongli's shield: 20s per 12s Hold cooldown, always up.
    expect(line("Hu Tao", "Zhongli", "Xingqiu", "Yelan")).toEqual({
      rule: "Survivability",
      points: 10,
      reason: "Xingqiu, Zhongli, Crystallize shields heal, shield or mitigate ~100% of an Abyss hit per rotation",
    });
    // Bennett's field: 12s per 15s; Bennett and Xianyun (16s per 18s) together: 1 - 0.2 x 0.11.
    expect(line("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu").points).toBe(8);
    expect(line("Xiao", "Bennett", "Xianyun", "Faruzan").reason).toBe("Bennett, Xianyun heal or shield ~98% of an Abyss hit per rotation");
    // Jean's field has no duration in the kit: she counts as full, as the healer tag did.
    expect(line("Kamisato Ayaka", "Jean", "Shenhe", "Furina").points).toBe(10);
    // Xingqiu's Rain Swords mitigate (#113): 28% of the DMG taken, 15s per 21s.
    expect(line("Hu Tao", "Xingqiu", "Yelan", "Kaedehara Kazuha")).toEqual({
      rule: "Survivability",
      points: 2,
      reason: "Xingqiu heal, shield or mitigate ~20% of an Abyss hit per rotation",
    });
    expect(line("Hu Tao", "Yelan", "Kaedehara Kazuha", "Bennett").points).toBe(8);
    expect(line("Hu Tao", "Yelan", "Kaedehara Kazuha", "Xiangling")).toEqual({ rule: "Survivability", points: -10, reason: "No healer or shielder" });
    // Albedo has no shield of his own, but his Geo crystallizes the team's auras (#208).
    expect(line("Hu Tao", "Xingqiu", "Yelan", "Albedo").reason).toBe("Xingqiu, Crystallize shields heal, shield or mitigate ~45% of an Abyss hit per rotation");
    // Dehya's Fiery Sanctum: 48% of the DMG taken, 12s per 20s; it counts for Arlecchino, who can't be healed.
    expect(line("Arlecchino", "Dehya", "Bennett", "Xilonen").reason).toBe("Dehya, Crystallize shields shield or mitigate ~51% of an Abyss hit per rotation");
  });

  test("shields are sized against the Abyss Discharge hit; Crystallize shields count (#208)", () => {
    const line = (...ids: string[]) => score(...ids).breakdown.find((l) => l.rule === "Survivability")!;
    const pct = (...ids: string[]) => Number(line(...ids).reason.match(/~(\d+)%/)![1]);
    // Diona's Hold shield (~3k at the benchmark) takes under half of a 6,699 hit: less than her 80% uptime.
    expect(pct("Ganyu", "Diona", "Kaedehara Kazuha", "Xiangling")).toBeLessThan(80);
    // Navia's Geo crystallizes Xiangling's and Xingqiu's auras: her team adds Crystallize shields to Bennett's 80%.
    expect(line("Navia", "Xiangling", "Bennett", "Xingqiu").reason).toContain("Crystallize shields");
    expect(pct("Navia", "Xiangling", "Bennett", "Xingqiu")).toBeGreaterThan(80);
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
    // Varka's own kit upgrade, plus Venti's +50% DMG after the carry's own Swirl (Bennett's Pyro to swirl; with Klee
    // instead, Klee carries since Swirl scores as damage, #205).
    // Both are in team damage since Varka's damage model (#233): his second Four Winds' Ascension, Venti's buff.
    expect(reasons("Varka", "Venti", "Bennett", "Durin")).toContain("Secret Rite enhances Varka's kit (in their damage)");
    expect(reasons("Varka", "Venti", "Bennett", "Durin")).toContain("Secret Rite: Venti: in team damage");
    // One Hexerei member: no Secret Rite.
    expect(lines("Varka", "Kaedehara Kazuha", "Bennett", "Xiangling")).toEqual([]);
    // Albedo's Silver Isotoma and Sucrose's Large Wind Spirit only reach Hexerei members, so a Hexerei carry gets more
    // DMG Bonus from them. For a modeled carry it is in their damage (#204, kit.ts familyBuffStats): 0 points.
    const bonus = (...ids: string[]) => teamBuffStats(team(...ids)[0], [], team(...ids)).dmgBonus;
    expect(bonus("Klee", "Albedo", "Sucrose", "Bennett")).toBeGreaterThan(bonus("Hu Tao", "Albedo", "Sucrose", "Bennett"));
    expect(bonus("Hu Tao", "Albedo", "Sucrose", "Bennett")).toBeGreaterThan(bonus("Hu Tao", "Albedo", "Xingqiu", "Bennett"));
    expect(lines("Hu Tao", "Albedo", "Sucrose", "Xingqiu").find((l) => l.reason === "Secret Rite: Albedo: in team damage")?.points).toBe(0);
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
    // Mualani's Wavechaser's Exploits stacks: a kit upgrade, scaled by how many stacks are up.
    expect(line("Mualani", "Xilonen", "Citlali", "Bennett")!.points).toBeGreaterThan(line("Mualani", "Xingqiu", "Furina", "Bennett")!.points);
    // Kinich's Hunter's Experience is in his Cannon damage (#288, damage.test.ts), so no flat line for it.
    expect(line("Kinich", "Xilonen", "Citlali", "Bennett")).toBeUndefined();
    expect(line("Kinich", "Emilie", "Xiangling", "Bennett")).toBeUndefined();
    // A support's own Nightsoul Burst effect (Kachina's Geo DMG) doesn't score for a non-Natlan carry, and nor
    // does the old flat Nightsoul pair.
    const geo = score("Navia", "Kachina", "Xilonen", "Zhongli").breakdown;
    expect(geo.some((l) => l.rule === "Nightsoul" || (l.rule === "Family" && l.reason.includes("Nightsoul")))).toBe(false);
  });

  test("Stellar Radiance scores what it does for this team (#63)", () => {
    const lines = (...ids: string[]) => score(...ids).breakdown.filter((l) => l.rule === "Stellar").map((l) => l.reason);
    // Sandrone converts Superconduct (Cryo + Electro) to Stellar-Conduct: her Radiance kit upgrade, plus
    // Alyosha's +20% Stellar-Conduct DMG for the on-field carry. Her Radiance hits are in her damage since her damage
    // model (#234).
    const sandrone = lines("Sandrone", "Alyosha", "Fischl", "Bennett");
    expect(sandrone).toContain("Radiance: Stellar-conduct enhances Sandrone's kit (in their damage)");
    expect(sandrone.some((r) => r.startsWith("Alyosha's Stellar buff gives Sandrone"))).toBe(true);
    // No Stellar reaction (no Electro or Anemo partner): no Radiance.
    expect(lines("Sandrone", "Bennett", "Xingqiu", "Zhongli")).toEqual([]);
    // Qiqi's Herald of Frost buffs the carry's Stellar-Conduct.
    expect(lines("Wriothesley", "Qiqi", "Sandrone", "Fischl").some((r) => r.startsWith("Qiqi's Stellar buff"))).toBe(true);
    // Stellar isn't a flat family pair any more.
    expect(score("Sandrone", "Alyosha", "Fischl", "Bennett").breakdown.some((l) => l.rule === "Family")).toBe(false);
  });

  test("Radiance and Secret Rite effects on a support's own hits (#98)", () => {
    const own = (ids: string[], who: string, options = {}) =>
      dps(scoreTeam(team(...ids), options).breakdown.find((l) => l.reason.startsWith(`${who}'s own hits`))?.reason);
    // Yae's Witch's Revelation: Superconduct enhances a strike every 2.5s; in Radiance: Stellar-Conduct each one adds a
    // Stellar-Conduct hit at 200% of her ATK.
    const stellar = ["Wriothesley", "Yae Miko", "Odette", "Qiqi"];
    const superconduct = ["Wriothesley", "Yae Miko", "Fischl", "Furina"];
    const yae = { revelationUnlocked: ["Wriothesley", "Odette", "Qiqi"] }; // all but Yae's quest
    expect(own(superconduct, "Yae Miko")).toBeGreaterThan(own(superconduct, "Yae Miko", yae) * 1.15);
    expect(own(stellar, "Yae Miko") / own(stellar, "Yae Miko", yae)).toBeGreaterThan(own(superconduct, "Yae Miko") / own(superconduct, "Yae Miko", yae));
    // Qiqi's Herald of Frost every 15s and her Burst's Stellar-Conduct hit; Odette's dance moves' Stellar hits.
    expect(own(stellar, "Qiqi")).toBeGreaterThan(own(stellar, "Qiqi", { revelationUnlocked: ["Wriothesley", "Odette", "Yae Miko"] }) * 2);
    // Odette's are her Radiance's: without Electro (Diona for Yae) there's no Stellar-Conduct.
    expect(own(stellar, "Odette")).toBeGreaterThan(own(["Wriothesley", "Diona", "Odette", "Qiqi"], "Odette") * 1.15);
    // Diona's three Icy Paws per 3.5s on the party's Superconduct and Stellar reactions.
    const diona = ["Sandrone", "Diona", "Fischl", "Bennett"];
    expect(own(diona, "Diona")).toBeGreaterThan(own(diona, "Diona", { revelationUnlocked: ["Sandrone"] }) * 1.5);
    // Venti's Stormeye at 135% under Secret Rite, while the carry Swirls: not without a second Hexerei member.
    const venti = ["Wanderer", "Venti", "Mona", "Bennett"];
    expect(own(venti, "Venti")).toBeGreaterThan(own(venti, "Venti", { hexereiUnlocked: ["Venti"] }) * 1.1);
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

  test("Witch's Revelation characters count as Stellar only once their quest is done (#45)", () => {
    const ids = ["Wriothesley", "Sandrone", "Fischl", "Furina"];
    // Wriothesley's Radiance: Stellar-Conduct upgrade counts only once his quest is done.
    const stellarFamily = (s: ReturnType<typeof scoreTeam>) => s.breakdown.some((l) => l.rule === "Stellar" && l.reason.includes("Wriothesley's kit"));
    expect(stellarFamily(scoreTeam(team(...ids)))).toBe(true); // no option: all quests assumed done
    expect(stellarFamily(scoreTeam(team(...ids), { revelationUnlocked: [] }))).toBe(false);
    expect(stellarFamily(scoreTeam(team(...ids), { revelationUnlocked: ["Wriothesley"] }))).toBe(true);
  });

  test("Wriothesley plays his Stellar-Conduct combo only with his Witch's Revelation done (#124)", () => {
    // Odette converts Superconduct either way; his Radiance combo (E 3[N5CD] N2) needs his own quest. Without it he
    // plays the default combo, which deals more (#123), so the team's damage moves.
    const t = team("Wriothesley", "Odette", "Fischl", "Furina");
    const done = scoreTeam(t, { revelationUnlocked: ["Wriothesley"] });
    const notDone = scoreTeam(t, { revelationUnlocked: [] });
    expect(done.activeReactions).toContain("stellar-conduct");
    expect(notDone.activeReactions).toContain("stellar-conduct");
    expect(notDone.damage.perSecond).not.toBeCloseTo(done.damage.perSecond, 0);
    expect(scoreTeam(t).damage.perSecond).toBeCloseTo(done.damage.perSecond, 6); // no option: quests assumed done
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

    test("ATK buffs count for carries that scale on ATK: inside a modeled carry's damage, as points otherwise (#202)", () => {
      // Hu Tao is modeled: Bennett's ATK is in her damage, so his line scores 0 and says so.
      expect(buffLine(score("Hu Tao", "Bennett", "Xingqiu", "Yelan"), "Bennett")).toEqual({
        rule: "Buffs",
        points: 0,
        reason: "Bennett buffs Hu Tao (~+24% damage, ~+24% of it in Hu Tao's damage)",
      });
      // Against a teammate with no buff on her (Diona): Zhongli's RES shred is in her damage too now (#204).
      expect(score("Hu Tao", "Bennett", "Xingqiu", "Yelan").damage.perSecond).toBeGreaterThan(score("Hu Tao", "Diona", "Xingqiu", "Yelan").damage.perSecond);
      // Diluc with no model: the same buff scores points (~+24% = 12, #68).
      expect(buffLine(score("Diluc (no model)", "Bennett", "Xingqiu", "Yelan"), "Bennett")?.points).toBe(12);
    });

    test("element buffs only count for that element", () => {
      expect(buffLine(score("Hu Tao", "Shenhe", "Xingqiu", "Zhongli"), "Shenhe")?.points).toBe(0);
      // Ayaka: the Quills' flat DMG and the Burst's Cryo RES shred (#177) are both in her damage (#204): 0 points.
      const shenhe = buffLine(score("Kamisato Ayaka", "Shenhe", "Furina", "Kaedehara Kazuha"), "Shenhe");
      expect(shenhe?.points).toBe(0);
      const [all, inDamage] = shenhe!.reason.match(/~\+\d+%/g)!;
      expect(inDamage).toBe(all);
    });

    test("EM buffs need a reaction that uses EM", () => {
      // Freeze does not scale with EM; Vaporize does. Without a damage model, as points; for a modeled carry, in their
      // damage (#186): it feeds the reactions the damage model reads.
      expect(buffLine(score("Kamisato Ayaka", "Sucrose", "Furina", "Shenhe"), "Sucrose")?.points).toBe(0);
      expect(buffLine(score("Diluc (no model)", "Sucrose", "Xingqiu", "Yelan"), "Sucrose")?.points).toBeGreaterThan(0);
      const hutao = buffLine(score("Hu Tao", "Sucrose", "Xingqiu", "Yelan"), "Sucrose")!;
      expect(hutao.points).toBe(0);
      const [all, inDamage] = hutao.reason.match(/~\+\d+%/g)!;
      expect(inDamage).toBe(all);
    });

    test("reaction buffs need that reaction in the team", () => {
      // Spread bonus: it only adds to Spread's flat damage, ~0.3 of a Spread carry's damage (#87).
      expect(buffLine(score("Alhaitham", "Baizhu", "Fischl", "Kuki Shinobu"), "Baizhu")?.points).toBe(3);
      // Pyro + Dendro, but nobody here builds Burning, so no Dendro reaction is active.
      expect(buffLine(score("Diluc (no model)", "Baizhu", "Bennett", "Zhongli"), "Baizhu")?.points).toBe(0);
    });

    test("reaction buffs need a reaction the carry deals (#58)", () => {
      // No Electro, Dendro or Geo teammate: no Lunar reaction (with Lauma, Neuvillette's Hydro would Lunar-Bloom, #178).
      const neuv = score("Neuvillette", "Furina", "Columbina", "Kaedehara Kazuha");
      expect(buffLine(neuv, "Columbina")).toEqual({
        rule: "Buffs",
        points: 0,
        reason: "Columbina: buffs Lunar-charged/Lunar-bloom/Lunar-crystallize, which this team does not trigger",
      });
      // Lunar-Bloom is Nefer's main reaction: ~0.8 of her damage (#87).
      // On the ~0.57 of Nefer's damage that her Lunar-Bloom hits are (measured, #94; the 0.8 estimate gave 9).
      expect(buffLine(score("Nefer", "Aino", "Columbina", "Baizhu"), "Columbina")?.points).toBe(7);
      // Alhaitham triggers Lunar-Bloom with Lauma and a Hydro teammate, so Lauma's buff counts for him, on the
      // ~0.3 of his damage that a side reaction is. With her guide's Silken Moon's Serenade EM (#338).
      expect(buffLine(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu"), "Lauma")?.points).toBe(7);
    });

    test("Kazuha's swirl buff does nothing for an Anemo carry (#58)", () => {
      expect(buffLine(score("Xiao", "Bennett", "Kaedehara Kazuha", "Nicole"), "Kaedehara Kazuha")?.reason).toMatch(/^Kaedehara Kazuha: /);
      // For Hu Tao it fits; his DMG bonus is inside her modeled damage (#202).
      expect(buffLine(score("Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"), "Kaedehara Kazuha")?.reason).toMatch(/^Kaedehara Kazuha buffs Hu Tao \(~\+\d+% damage/);
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

    test("the carry's crit is inside their damage, with no CV line (#202)", () => {
      const weak = scoreTeam(built({ "Hu Tao": { critRate: 30, critDmg: 60 } }, ...vape)); // CV 120
      const strong = scoreTeam(built({ "Hu Tao": { critRate: 80, critDmg: 200 } }, ...vape)); // CV 360
      expect(strong.damage.perSecond).toBeGreaterThan(weak.damage.perSecond);
      expect([...weak.breakdown, ...strong.breakdown].some((l) => l.rule === "Carry build")).toBe(false);
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
  test("party-wide kit buffs reach sub-DPS hits; on-field ones don't (#204)", () => {
    const buffsOn = (id: string, ...ids: string[]) => {
      const t = team(...ids);
      const active = score(...ids).activeReactions;
      return memberBuffStats(byId.get(id)!, t[0], active, t);
    };
    // Furina's Fanfare and Rosaria's CRIT Rate are for every party member, so Yelan's own hits get them.
    expect(buffsOn("Yelan", "Hu Tao", "Yelan", "Furina", "Zhongli").dmgBonus).toBeGreaterThan(0);
    expect(buffsOn("Xingqiu", "Hu Tao", "Xingqiu", "Rosaria", "Zhongli").critRate).toBeGreaterThan(0);
    // Bennett's field buffs whoever stands in it, the on-field carry: not Yelan's off-field hits.
    expect(buffsOn("Yelan", "Hu Tao", "Yelan", "Bennett", "Zhongli").atk).toBe(0);
    // A buffer's buff on their own hits is left out (#98): Furina's Fanfare doesn't reach her own Salon here.
    expect(buffsOn("Furina", "Hu Tao", "Yelan", "Furina", "Zhongli").dmgBonus).toBe(0);
    // And the buff shows in their damage: Yelan with Furina beside her deals more than with Zhongli in that slot.
    const yelan = (...ids: string[]) => dps(score(...ids).breakdown.find((l) => l.reason.startsWith("Yelan's own hits"))?.reason);
    expect(yelan("Hu Tao", "Yelan", "Furina", "Xingqiu")).toBeGreaterThan(yelan("Hu Tao", "Yelan", "Zhongli", "Xingqiu"));
  });

  test("checked party-wide buffs and family team bonuses reach the hits their text names (#204)", () => {
    const buffsOn = (id: string, ids: string[], talent?: string) => {
      const t = team(...ids);
      return memberBuffStats(byId.get(id)!, t[0], score(...ids).activeReactions, t, talent);
    };
    // Nicole's Grace of Kenosis and Prune's Tolling Rally are for nearby party members; Illuga's CRIT Rate is for Geo DMG.
    expect(buffsOn("Xingqiu", ["Hu Tao", "Xingqiu", "Nicole", "Zhongli"]).atk).toBeGreaterThan(0);
    expect(buffsOn("Zhongli", ["Navia", "Zhongli", "Illuga", "Xilonen"]).critRate).toBeGreaterThan(0);
    // Sigewinne's Convalescence is for off-field members' Skill DMG: Furina's Skill, not Neuvillette's hits.
    const sige = ["Neuvillette", "Furina", "Sigewinne", "Kaedehara Kazuha"];
    expect(buffsOn("Furina", sige, "skill").flat).toBeGreaterThan(0);
    const carry = teamBuffStats(team(...sige)[0], [], team(...sige));
    expect(carry.flat + (carry.byHit?.skill?.flat ?? 0)).toBe(0);
    // Secret Rite (Durin and Fischl): Durin's extra Pyro RES shred is on the enemy, so Bennett's hits get it too; Fischl's
    // ATK after Overloaded is for the active character and Fischl, not Bennett. Beidou isn't Hexerei: no Secret Rite.
    const rite = ["Arlecchino", "Durin", "Fischl", "Bennett"];
    expect(buffsOn("Bennett", rite).resShred).toBeGreaterThan(buffsOn("Bennett", ["Arlecchino", "Durin", "Beidou", "Bennett"]).resShred);
    expect(buffsOn("Fischl", rite).atkPct).toBeGreaterThan(0);
    // Fervent Flames (Arlecchino, Bennett: #186) is on both; Fischl's ATK only with Secret Rite.
    expect(buffsOn("Bennett", rite).atkPct).toBeCloseTo(buffsOn("Bennett", ["Arlecchino", "Durin", "Beidou", "Bennett"]).atkPct, 6);
  });

  test("a support who out-damages the carry is not named main DPS (#266)", () => {
    // A carry with no damage model: Escoffier's own hits out-damage him. Before #266 she was named main DPS beside every
    // carry without a model (Wanderer, Itto, Lyney, Anemo Traveler...).
    const s = score("Tartaglia (no model)", "Escoffier", "Durin", "Zhongli");
    expect(s.onField).toBe("Tartaglia (no model)");
    expect(s.mainDps).toBe("Tartaglia (no model)");
    expect(s.breakdown.some((l) => l.reason.includes("out-damages"))).toBe(false);
  });

  test("Furina's Salon bonus needs another healer to keep members above 50% HP (#130)", () => {
    const share = (...ids: string[]) => dps(score(...ids).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith("Furina"))?.reason);
    // Same carry and supports' elements; Bennett heals, Xiangling doesn't.
    expect(share("Neuvillette", "Furina", "Bennett", "Kaedehara Kazuha")).toBeGreaterThan(share("Neuvillette", "Furina", "Xiangling", "Kaedehara Kazuha"));
  });

  test("Durin's Primordial Fusion boosts 10 dragon hits per Burst by his ATK, up to 75% (#195)", () => {
    const stats = (atk: number): CharacterStats => ({
      atk, hp: 15000, def: 800, critRate: 50, critDmg: 100, energyRecharge: 200, elementalMastery: 0, elementalDmgBonus: 46.6,
    });
    // Navia's Geo team: no Vaporize or Melt on his hits, so they grow with ATK alone.
    const durin = (atk: number) =>
      dps(scoreTeam(team("Navia", "Durin", "Zhongli", "Xilonen").map((c) => (c.id === "Durin" ? { ...c, stats: stats(atk) } : c)))
        .breakdown.find((l) => l.reason.startsWith("Durin's own hits"))?.reason);
    // 3% per 100 ATK: +45% at 1,500, capped at +75% from 2,500. Twice the ATK is more than twice the damage (the boost
    // grows too), but at most by the boost's growth on 10 of the 18 dragon hits.
    const ratio = durin(3000) / durin(1500);
    expect(ratio).toBeGreaterThan(2.05);
    expect(ratio).toBeLessThan((2 * (1 + (10 / 18) * 0.75)) / (1 + (10 / 18) * 0.45));
  });

  test("a member's own RES shred reaches their own hits (#364)", () => {
    const own = (constellation: number) =>
      dps(
        scoreTeam(team("Raiden Shogun", "Beidou", "Xiangling", "Bennett").map((c) => (c.id === "Beidou" ? { ...c, constellation } : c))).breakdown.find(
          (l) => l.rule === "Sub-DPS" && l.reason.startsWith("Beidou"),
        )?.reason,
      );
    // Beidou's C6 Electro RES shred during her Burst: on her own lightning too, not only her teammates' Electro hits.
    expect(own(6)).toBeGreaterThan(own(5));
  });

  test("teammates' RES shred reaches a sub-DPS's own hits (#204)", () => {
    const own = (who: string, ...ids: string[]) => dps(score(...ids).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith(who))?.reason);
    // Zhongli's shield shreds every element's RES by 20%: Xingqiu's swords hit harder than beside Diona.
    expect(own("Xingqiu", "Raiden Shogun", "Xingqiu", "Zhongli", "Bennett")).toBeGreaterThan(own("Xingqiu", "Raiden Shogun", "Xingqiu", "Diona", "Bennett"));
  });

  test("teammates' Moonsign Benediction Base DMG bonus reaches every Lunar hit (#88)", () => {
    const stats = (atk: number): CharacterStats => ({
      atk, hp: 15000, def: 800, critRate: 50, critDmg: 100, energyRecharge: 150, elementalMastery: 100, elementalDmgBonus: 30,
    });
    // Flins' and Ineffa's bonuses grow 0.7% per 100 ATK, up to 14% at 2,000. Nothing else of theirs reaches the other's
    // or Columbina's Lunar-Charged hits (EM buffs aren't in carry damage), so only the Base DMG bonus moves them.
    const read = (who: string, atk: number) => {
      const s = scoreTeam(team("Flins", "Ineffa", "Columbina", "Aino").map((c) => (c.id === who ? { ...c, stats: stats(atk) } : c)));
      const line = (re: RegExp) => s.breakdown.find((l) => re.test(l.reason))?.reason;
      return { columbina: dps(line(/^Columbina's own hits/)), lunar: Number(line(/^Lunar-charged adds/)?.match(/~\+(\d+)%/)?.[1]) };
    };
    expect(read("Flins", 2000).columbina).toBeGreaterThan(read("Flins", 1000).columbina);
    expect(read("Ineffa", 2000).lunar).toBeGreaterThan(read("Ineffa", 1000).lunar);
  });

  test("Stellar Swirl deals damage; Mizuki's and Vesna's Radiance is in their damage (#235)", () => {
    const ids = ["Yumemizuki Mizuki", "Odette", "Traveler (Cryo)", "Faruzan"];
    const s = score(...ids);
    // Each Stellar Swirl's Anemo hit and its vortex's explosion, as 0-point Reactions lines in team damage.
    const stellar = s.breakdown.filter((l) => l.rule === "Reactions" && /^Stellar-swirl (Anemo hits|Stellar Vortex)/.test(l.reason));
    expect(stellar.map((l) => l.reason.split(":")[0])).toEqual(["Stellar-swirl Anemo hits", "Stellar-swirl Stellar Vortex Lv. 2"]);
    expect(stellar.every((l) => l.points === 0 && dps(l.reason) > 0)).toBe(true);
    // Her Radiance hits are in her damage: no flat points for them; without her Witch's Revelation they're gone.
    const radiance = (t: ReturnType<typeof scoreTeam>) => t.breakdown.find((l) => l.rule === "Stellar" && l.reason.startsWith("Radiance"));
    expect(radiance(s)?.points).toBe(0);
    expect(scoreTeam(team(...ids), { revelationUnlocked: [] }).damage.perSecond).toBeLessThan(s.damage.perSecond);
    expect(radiance(score("Vesna", "Odette", "Vodyanitsa", "Traveler (Cryo)"))?.points).toBe(0);
  });

  test("indirect Lunar damage: thunderclouds and Moondrift Harmony, not Lunar-Bloom (#145)", () => {
    const indirect = (...ids: string[]) => {
      const line = score(...ids).breakdown.find((l) => l.rule === "Reactions" && /thunderclouds|Moondrift Harmony/.test(l.reason));
      return line ? { points: line.points, dps: dps(line.reason), rate: Number(line.reason.match(/~([\d.]+)\/s\)/)![1]) } : null;
    };
    // Thunderclouds strike every 2s at most, scored as damage (0 points); Moondrift Harmony every third Lunar-Crystallize.
    const charged = indirect("Flins", "Ineffa", "Columbina", "Aino")!;
    expect(charged.points).toBe(0);
    expect(charged.dps).toBeGreaterThan(0);
    expect(charged.rate).toBeLessThanOrEqual(0.5);
    expect(indirect("Zibai", "Columbina", "Illuga", "Linnea")?.dps).toBeGreaterThan(0);
    // Lunar-Bloom has no indirect damage (wiki Damage § Indirect).
    expect(indirect("Nefer", "Lauma", "Columbina", "Furina")).toBeNull();
  });

  test("a sub-DPS's constellation picks their kit (#106): C6 Xingqiu's 2/3/5 swords, C4 Ororon, C6 Escoffier", () => {
    const own = (who: string, constellation: number | undefined, ...ids: string[]) =>
      dps(scoreTeam(team(...ids).map((c) => (c.id === who ? { ...c, constellation } : c))).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith(who))?.reason);
    const xq = ["Raiden Shogun", "Xingqiu", "Zhongli", "Bennett"];
    // 10 swords per 3 waves against 2.5 a wave: 4/3 the swords (Xingqiu's line is his Skill and swords together). From
    // C5: both have his C2 Hydro shred, which reaches his own swords (#364).
    expect(own("Xingqiu", 6, ...xq) / own("Xingqiu", 5, ...xq)).toBeGreaterThan(1.15);
    expect(own("Xingqiu", 6, ...xq) / own("Xingqiu", 5, ...xq)).toBeLessThan(4 / 3 + 0.01);
    // No constellation is C0; one below the threshold changes nothing.
    expect(own("Xingqiu", undefined, ...xq)).toBe(own("Xingqiu", 0, ...xq));
    expect(own("Xingqiu", 1, ...xq)).toBe(own("Xingqiu", 0, ...xq));
    expect(own("Xingqiu", 5, ...xq)).toBe(own("Xingqiu", 2, ...xq));
    const oro = ["Kinich", "Ororon", "Bennett", "Xingqiu"];
    expect(own("Ororon", 4, ...oro)).toBeGreaterThan(own("Ororon", 3, ...oro));
    // Escoffier's 6 Special-Grade Frosty Parfaits at 500% ATK per Skill.
    const esc = ["Kamisato Ayaka", "Escoffier", "Shenhe", "Furina"];
    expect(own("Escoffier", 6, ...esc)).toBeGreaterThan(own("Escoffier", 5, ...esc) * 1.3);
    // Candace's C6 waves on the carry's Normal Attacks; Yelan's 5 Mastermind barbs; Kaeya's 4th icicle; Rosaria's
    // longer Ice Lance.
    const arle = ["Arlecchino", "Candace", "Bennett", "Xilonen"];
    expect(own("Candace", 6, ...arle)).toBeGreaterThan(own("Candace", 5, ...arle));
    const hutao = ["Hu Tao", "Yelan", "Zhongli", "Xingqiu"];
    expect(own("Yelan", 6, ...hutao)).toBeGreaterThan(own("Yelan", 5, ...hutao));
    const melt = ["Arlecchino", "Kaeya", "Bennett", "Xilonen"];
    expect(own("Kaeya", 6, ...melt)).toBeGreaterThan(own("Kaeya", 5, ...melt));
    const mav = ["Mavuika", "Kachina", "Rosaria", "Bennett"];
    expect(own("Rosaria", 2, ...mav)).toBeGreaterThan(own("Rosaria", 1, ...mav));
  });

  test("a buffer's constellation buffs need that constellation (#106): Faruzan C6, Beidou C6, Xingqiu C2", () => {
    const teamDps = (who: string, constellation: number, ...ids: string[]) =>
      scoreTeam(team(...ids).map((c) => (c.id === who ? { ...c, constellation } : c))).damage.perSecond;
    // Faruzan's 40% CRIT DMG on Anemo DMG while her Burst is up.
    const xiao = ["Xiao", "Faruzan", "Zhongli", "Bennett"];
    expect(teamDps("Faruzan", 6, ...xiao)).toBeGreaterThan(teamDps("Faruzan", 5, ...xiao) * 1.05);
    // Beidou's Electro RES shred during her Burst reaches Electro hits; nothing below C6.
    const raiden = ["Raiden Shogun", "Beidou", "Xiangling", "Bennett"];
    expect(teamDps("Beidou", 6, ...raiden)).toBeGreaterThan(teamDps("Beidou", 5, ...raiden));
    expect(teamDps("Beidou", 5, ...raiden)).toBe(teamDps("Beidou", 0, ...raiden));
    // Xingqiu's C2 Hydro RES shred reaches a Hydro carry.
    const ayato = ["Kamisato Ayato", "Xingqiu", "Bennett", "Kaedehara Kazuha"];
    expect(teamDps("Xingqiu", 2, ...ayato)).toBeGreaterThan(teamDps("Xingqiu", 1, ...ayato));
  });

  test("Aino's Ascendant Gleam upgrade is in her sub-DPS damage: 20 water balls per Burst instead of 9 (#159)", () => {
    const own = (gleam: boolean) =>
      dps(
        scoreTeam(team("Neuvillette", "Aino", "Ineffa", "Bennett").map((c) => (c.id === "Ineffa" && !gleam ? { ...c, families: [] } : c))).breakdown.find(
          (l) => l.rule === "Sub-DPS" && l.reason.startsWith("Aino"),
        )?.reason,
      );
    // Her Skill's two stages stay; the water balls go from 9 to 20.
    expect(own(true) / own(false)).toBeGreaterThan(1.4);
  });

  test("Lunar sub-DPS hits only fire with their Lunar reaction (#151)", () => {
    const share = (who: string, ...ids: string[]) => dps(score(...ids).breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith(who))?.reason);
    // Ineffa's Overclocking Circuit needs thunderclouds (Lunar-Charged): Xingqiu's Hydro makes them, Zhongli doesn't.
    expect(share("Ineffa", "Yoimiya", "Ineffa", "Xingqiu", "Bennett")).toBeGreaterThan(share("Ineffa", "Yoimiya", "Ineffa", "Zhongli", "Bennett"));
    // Columbina's Gravity Interference needs a Lunar reaction: Ineffa's Electro-Charged turns Lunar-Charged; with
    // Chongyun instead there is none. No Pyro (her other hits' Vaporize would move with the team, #239), no Geo (Lunar-
    // Crystallize) and no party buff on her hits (Kazuha's, #219), so only the Lunar reaction differs.
    expect(share("Columbina", "Kamisato Ayaka", "Columbina", "Ineffa", "Diona")).toBeGreaterThan(share("Columbina", "Kamisato Ayaka", "Columbina", "Chongyun", "Diona"));
  });

  test("a sub-DPS without a build gets a KQM Standards build for the stat they scale on (#158, #164-#167)", () => {
    const stats = (id: string) => subDpsStats(byId.get(id)!)!;
    // Ineffa scales on ATK: level 90 base 330 + the 500 benchmark weapon, ATK% sands + the 2 fixed ATK% rolls, plume,
    // 2 ATK rolls. KQM: "ER (until requirement)* > CRIT > ATK% > EM": 8 ER rolls reach her 150% (#173), CRIT takes the rest.
    const ineffa = stats("Ineffa");
    expect(ineffa.er).toBeCloseTo(1 + 10 * 0.0551, 3);
    expect(ineffa.atk).toBeCloseTo(830 * (1 + 0.466 + 2 * 0.0496) + 311 + 2 * 16.54, 0);
    expect(ineffa.em).toBeCloseTo(2 * 19.82, 1); // only the 2 fixed EM rolls
    // CRIT Rate circlet, 2 fixed + 6 rolls, and her level 90 ascension stat, CRIT Rate 24.2% (#166).
    expect(ineffa.critRate).toBeCloseTo(0.05 + 0.311 + 8 * 0.0331 + 0.242, 3);
    expect(ineffa.critDmg).toBeCloseTo(0.5 + 8 * 0.0662, 3); // 2 fixed + 6 rolls
    // Columbina scales on HP; after 8 ER rolls, KQM "CRIT = HP%" spreads the other 12: HP% 4, CRIT Rate 4, CRIT DMG 4.
    expect(stats("Columbina").hp).toBeCloseTo(14695 * (1 + 0.466 + 6 * 0.0496) + 4780 + 2 * 253.94, 0);
    // A 200% requirement is out of reach with 10 ER rolls: ER sands (51.8%) and 7 rolls (Xingqiu, #173).
    expect(stats("Xingqiu").er).toBeCloseTo(1 + 0.518 + 9 * 0.0551, 3);
    // No ER in the KQM priority: only the 2 fixed rolls (Chiori: "CRIT > DEF% > ATK%").
    expect(stats("Chiori").er).toBeCloseTo(1 + 2 * 0.0551, 3);
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
  // Diluc with no model (above): his buffers score points for their whole kit: the buffer-point mechanics
  // (talent scaling, kit values, the cap) are tested on him; a modeled carry has those buffs in their damage (#202).
  const diluc = ["Diluc (no model)", "Bennett", "Xingqiu", "Zhongli"];
  // A Buffs reason without the part about the carry's damage, for the kit value alone.
  const kitPart = (reason?: string) => reason?.replace(/, ~\+\d+% of it in [^)]*/, "");

  test("every main DPS has a key talent and every tag buff says where it comes from", () => {
    expect(all.filter((c) => c.roles.includes("main-dps") && !c.keyTalent).map((c) => c.id)).toEqual([]);
    expect(all.filter((c) => c.buffs?.some((b) => !b.talent)).map((c) => c.id)).toEqual([]);
  });

  test("the carry's key talent scales the carry's damage, within bounds (#202)", () => {
    const low = leveled({ "Hu Tao": talents(6, 10, 10) }, ...vape);
    expect(lines(low, "Carry talent")).toEqual([{ rule: "Carry talent", points: 0, reason: "Hu Tao normal level 6 vs 9 benchmark: ×0.70 damage" }]);
    const high = leveled({ "Hu Tao": talents(13, 1, 1) }, ...vape);
    expect(lines(high, "Carry talent")[0].reason).toBe("Hu Tao normal level 13 vs 9 benchmark: ×1.15 damage"); // capped
    const dps = (t: ScoringCharacter[]) => scoreTeam(t).damage.perSecond;
    expect(dps(low)).toBeLessThan(dps(team(...vape)));
    expect(dps(high)).toBeGreaterThan(dps(team(...vape)));
  });

  test("level 9, or no build, gets no talent line", () => {
    expect(lines(leveled({ "Hu Tao": talents(9, 1, 1) }, ...vape), "Carry talent")).toEqual([]);
    expect(lines(team(...vape), "Carry talent")).toEqual([]);
  });

  test("a buffer's points scale with the talent its buff comes from", () => {
    const bennett = (levels: ReturnType<typeof talents>) =>
      lines(leveled({ Bennett: levels }, ...diluc), "Buffs").find((l) => l.reason.startsWith("Bennett"));
    expect(bennett(talents(1, 1, 13))).toEqual({ rule: "Buffs", points: 14, reason: "Bennett buffs Diluc (no model) (~+24% damage, burst level 13)" });
    expect(bennett(talents(13, 13, 6))?.points).toBe(8);
    expect(bennett(talents(9, 9, 9))?.points).toBe(12);
  });

  test("passive buffs don't scale", () => {
    const swirl = ["Diluc (no model)", "Xingqiu", "Kaedehara Kazuha", "Zhongli"];
    const kazuha = lines(leveled({ "Kaedehara Kazuha": talents(1, 1, 1) }, ...swirl), "Buffs").find((l) => l.reason.startsWith("Kaedehara"));
    expect(kazuha).toEqual({ rule: "Buffs", points: 10, reason: "Kaedehara Kazuha buffs Diluc (no model) (~+20% damage)" });
  });

  test("the #178 buffers score their kit's values (#358)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    // Base DMG converters: their bonus is in team damage, no buffer points on top.
    expect(buffLine(score("Sandrone", "Odette", "Alyosha", "Escoffier"), "Odette")).toEqual({ rule: "Buffs", points: 0, reason: "Odette's Base DMG bonus: in team damage" });
    // Chongyun's ATK SPD reaches a claymore carry, not a Pyro catalyst (and his Cryo shred no Pyro hit).
    expect(buffLine(score("Diluc", "Chongyun", "Bennett", "Zhongli"), "Chongyun")!.points).toBeGreaterThan(0);
    expect(buffLine(score("Klee", "Chongyun", "Bennett", "Zhongli"), "Chongyun")!.points).toBe(0);
    // Raiden's Eye: 0.3% Burst DMG per Energy of the carry's Burst, so a costlier Burst gains more.
    const burstCarry = (burstCost: number) => ({ ...byId.get("Diluc (no model)")!, keyTalent: "burst" as const, burstCost });
    const raiden = (cost: number) => kitBuffValue(byId.get("Raiden Shogun")!, burstCarry(cost), [], [burstCarry(cost), ...team("Raiden Shogun", "Bennett", "Zhongli")])!.gain;
    expect(raiden(80)).toBeGreaterThan(raiden(40) * 1.5);
  });

  test("buffer points come from the kit's numbers: +20% damage = 10 points, no cap (#68, #90)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    const s = score("Diluc (no model)", "Furina", "Bennett", "Zhongli");
    // Furina's Fanfare averages 3/4 of its max with a healer (Bennett) here (#90): +52% DMG, ~+32% damage.
    expect(buffLine(s, "Furina")).toEqual({ rule: "Buffs", points: 16, reason: "Furina buffs Diluc (no model) (~+32% damage)" });
    expect(buffLine(s, "Bennett")?.points).toBe(12);
    expect(buffLine(score("Diluc (no model)", "Zhongli", "Xingqiu", "Yelan"), "Zhongli")?.points).toBe(8);
    // For modeled Hu Tao, Furina's DMG bonus is in her damage (0 points); Zhongli's RES shred isn't yet (#202).
    const hutao = score("Hu Tao", "Furina", "Bennett", "Zhongli");
    // Her Burst is a little short of Energy in Hu Tao's rotation, so a little less (#207).
    expect(buffLine(hutao, "Furina")).toEqual({ rule: "Buffs", points: 0, reason: "Furina buffs Hu Tao (~+31% damage, ~+31% of it in Hu Tao's damage)" });
    // Zhongli's RES shred is in her damage too (#204).
    expect(buffLine(score("Hu Tao", "Zhongli", "Xingqiu", "Yelan"), "Zhongli")?.points).toBe(0);
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
    expect(kitPart(buff("Escoffier", "Kamisato Ayaka", "Escoffier", "Furina", "Mona"))).toBe("Escoffier buffs Kamisato Ayaka (~+36% damage)");
    expect(kitPart(buff("Escoffier", "Kamisato Ayaka", "Escoffier", "Furina", "Amber"))).toBe("Escoffier buffs Kamisato Ayaka (~+14% damage)"); // 3 members: 15%
    // Chevreuse's shred needs every member to be Pyro or Electro.
    expect(kitPart(buff("Chevreuse", "Raiden Shogun", "Chevreuse", "Xiangling", "Bennett"))).toBe("Chevreuse buffs Raiden Shogun (~+28% damage)");
    expect(buff("Chevreuse", "Raiden Shogun", "Chevreuse", "Xiangling", "Xingqiu")).toBe(
      "Chevreuse: their kit's buff doesn't apply to Raiden Shogun's damage",
    );
  });

  test("Blizzard Strayer's CRIT Rate is in the carry's damage; Freeze then scores no flat points (#206, #205)", () => {
    const stats: CharacterStats = {
      atk: 2000, hp: 18000, def: 800, critRate: 40, critDmg: 180, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 61.6,
    };
    const read = (sets?: { set: string; pieces: 2 | 4 }[]) => {
      const t = team("Ganyu", "Furina", "Escoffier", "Shenhe").map((c) => (c.id === "Ganyu" ? { ...c, stats, sets } : c));
      const s = scoreTeam(t);
      // Her own damage (the set reaches only her hits), in this team's Freeze.
      const dps = carryDamage(t[0], s.activeReactions, t)!.perSecond;
      return { dps, freeze: s.breakdown.find((l) => l.rule === "Reactions" && l.reason.startsWith("Freeze")) };
    };
    const none = read();
    const two = read([{ set: "Blizzard Strayer", pieces: 2 }]);
    const four = read([{ set: "Blizzard Strayer", pieces: 4 }]);
    // +20% vs Cryo-affected, +20% more vs Frozen: 40% -> 80% CRIT Rate in this Freeze team.
    expect(four.dps / none.dps).toBeCloseTo((1 + 0.8 * 1.8) / (1 + 0.4 * 1.8), 1);
    expect(two.dps).toBeCloseTo(none.dps, 6); // the 2pc Cryo DMG is in the imported stats already
    // Freeze is worth only the set's crit: a build without it gets nothing from Freeze (#279).
    expect(none.freeze).toMatchObject({ points: 0 });
    expect(four.freeze).toMatchObject({ points: 0 });
  });

  test("a carry without a build wears their guide's set in its reaction's teams, with a CRIT DMG circlet (#279)", () => {
    const freezeLine = (s: ReturnType<typeof scoreTeam>) => s.breakdown.find((l) => l.rule === "Reactions" && l.reason.startsWith("Freeze"));
    const freeze = team("Ganyu", "Furina", "Escoffier", "Shenhe");
    const s = scoreTeam(freeze);
    expect(freezeLine(s)).toMatchObject({ points: 0 });
    // Same as giving her 4pc Blizzard Strayer by hand.
    const worn = freeze.map((c) => (c.id === "Ganyu" ? { ...c, sets: [{ set: "Blizzard Strayer", pieces: 4 as const }] } : c));
    expect(carryDamage(freeze[0], s.activeReactions, freeze)!.perSecond).toBeCloseTo(carryDamage(worn[0], s.activeReactions, worn)!.perSecond, 6);
    // A build's own sets count: with another set, Freeze adds nothing and she keeps her 60% CRIT Rate circlet.
    const other = freeze.map((c) => (c.id === "Ganyu" ? { ...c, sets: [{ set: "Wanderer's Troupe", pieces: 4 as const }] } : c));
    const otherScore = scoreTeam(other);
    expect(freezeLine(otherScore)).toMatchObject({ points: 0 });
    expect(otherScore.score).toBeLessThan(s.score);
    // Ayaka's guide picks Marechaussee Hunter (not modeled yet): flat points.
    expect(freezeLine(score("Kamisato Ayaka", "Furina", "Escoffier", "Shenhe"))!.points).toBeGreaterThan(0);
  });

  test("a Burst short of Energy funds its buffs less often (#207)", () => {
    const stats = (er: number): CharacterStats => ({
      atk: 900, hp: 20000, def: 800, critRate: 20, critDmg: 60, energyRecharge: er, elementalMastery: 0, elementalDmgBonus: 0,
    });
    const read = (er: number) => {
      const s = scoreTeam(team("Klee", "Bennett", "Fischl", "Chevreuse").map((c) => (c.id === "Bennett" ? { ...c, stats: stats(er) } : c)));
      const line = s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith("Bennett"))!.reason;
      return { line, gain: Number(line.match(/~\+(\d+)% damage/)![1]), dps: s.damage.perSecond };
    };
    // Bennett's ATK buff is from his Burst: at 100% ER he Bursts in only part of the rotations, at 250% in all.
    const starved = read(100);
    const funded = read(250);
    expect(starved.gain).toBeLessThan(funded.gain);
    expect(starved.dps).toBeLessThan(funded.dps);
    expect(starved.line).toMatch(/Burst in ~\d+% of rotations/);
    expect(funded.line).not.toMatch(/Burst in/);
  });

  test("Ifa's and Prune's buffs come from their kit values (#76)", () => {
    const buff = (id: string, ...ids: string[]) =>
      score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id))?.reason;
    // Ifa alone holds ~40 Rescue Essentials points (half his 80): 60% Swirl DMG, on the ~0.25 of a Swirl
    // carry's damage that Swirl hits are (#87); it counts in the Swirl damage itself (#256), not as buffer points.
    expect(buff("Ifa", "Varka", "Ifa", "Durin", "Bennett")).toBe("Ifa buffs Varka (~+9% damage, ~+9% of it in Varka's damage)");
    // Lunar-Charged gets only 0.2% per point, on the ~0.52 of Flins' damage his Lunar-Charged hits are (measured, #94).
    expect(buff("Ifa", "Flins", "Ifa", "Aino", "Ineffa")).toBe("Ifa buffs Flins (~+3% damage)");
    // Prune: 0.025% per ATK point above 2,000; without a build she is assumed at 3,000 ATK.
    expect(buff("Prune", "Klee", "Prune", "Mona", "Bennett")).toBe("Prune buffs Klee (~+16% damage, ~+16% of it in Klee's damage)");
    const stats: CharacterStats = {
      atk: 4200, hp: 15000, def: 800, critRate: 50, critDmg: 100, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 0,
    };
    const built = team("Klee", "Prune", "Mona", "Bennett").map((c) => (c.id === "Prune" ? { ...c, stats } : c));
    // At 4,200 ATK she hits the 50% cap.
    expect(scoreTeam(built).breakdown.find((l) => l.reason.startsWith("Prune"))?.reason).toBe("Prune buffs Klee (~+31% damage, ~+31% of it in Klee's damage)");
  });

  test("Mavuika's bonus grows with the Fighting Spirit the team can build (#68)", () => {
    const mavuika = (...ids: string[]) =>
      kitPart(score(...ids).breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith("Mavuika"))?.reason);
    // Her own Skill gives 80 and Neuvillette's Charged Attacks none: under the 100 her Burst needs, so no buff (#116).
    expect(mavuika("Neuvillette", "Mavuika", "Furina", "Escoffier")).toBe("Mavuika can't Burst: the team builds ~80 of 100 Fighting Spirit");
    // Kachina's Skill adds 60 and Hu Tao's 14 Normal Attack hits 21: 161 of 200. (Hu Tao, not Neuvillette: with
    // Kachina or Citlali + Xilonen, Mavuika out-damages Neuvillette and takes the on-field slot, #96.)
    expect(mavuika("Hu Tao", "Mavuika", "Kachina", "Xingqiu")).toBe("Mavuika buffs Hu Tao (~+20% damage)");
    // Kachina (60) and Xilonen (90): past the 200 limit, the full 40%. (Neuvillette: with her guide's Obsidian Codex,
    // Mavuika out-damages Hu Tao here, #206.)
    expect(mavuika("Neuvillette", "Mavuika", "Kachina", "Xilonen")).toBe("Mavuika buffs Neuvillette (~+25% damage)");
    // Normal Attack hits add 1.5 each: Clorinde's 36 make 134, Hu Tao's 14 make 101 (not the old flat 200).
    expect(mavuika("Clorinde", "Mavuika", "Bennett", "Fischl")).toBe("Mavuika buffs Clorinde (~+17% damage)");
    expect(mavuika("Hu Tao", "Mavuika", "Xingqiu", "Zhongli")).toBe("Mavuika buffs Hu Tao (~+13% damage)");
  });

  test("a sub-DPS source's `when` gates it: Jahoda's robots only at Ascendant Gleam (#100)", () => {
    const jahodaLine = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Jahoda's own hits"))?.reason;
    // Jahoda and Columbina are both Moonsign: Ascendant Gleam, so the robots' 10 hits per Burst count.
    const gleam = dps(jahodaLine("Hu Tao", "Jahoda", "Columbina", "Zhongli"));
    const none = dps(jahodaLine("Hu Tao", "Jahoda", "Xingqiu", "Zhongli"));
    expect(gleam).toBeGreaterThan(none);
  });

  test("a sub-DPS source's `alternatives`: Jahoda's robots hit 12 times when Cryo leads her passive 1 (#175)", () => {
    // Most party members among Pyro, Hydro, Electro, Cryo; ties go Pyro > Hydro > Electro > Cryo.
    expect(topElement(team("Flins", "Jahoda", "Citlali", "Escoffier"))).toBe("Cryo");
    expect(topElement(team("Flins", "Jahoda", "Citlali", "Xingqiu"))).toBe("Hydro"); // 1 each: Hydro first
    expect(topElement(team("Skirk", "Jahoda", "Citlali", "Bennett"))).toBe("Cryo");
    expect(topElement(team("Jahoda", "Sucrose", "Zhongli", "Lynette"))).toBeUndefined();
    const jahodaLine = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Jahoda's own hits"))?.reason;
    // 12 robot hits with Cryo leading, 10 otherwise.
    expect(dps(jahodaLine("Flins", "Jahoda", "Citlali", "Escoffier"))).toBeGreaterThan(dps(jahodaLine("Flins", "Jahoda", "Ineffa", "Escoffier")));
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
    // Citlali's passive-1 16 only when the team can Melt or Freeze (Jessie, #126): always with Pyro Mavuika; a made-up
    // non-Pyro Mavuika with no Pyro or Hydro member loses it.
    const citlali = byId.get("Citlali")!;
    const anemoMav = { ...mav, element: "Anemo" as const };
    expect(fightingSpiritBuilt(mav, raiden, [raiden, mav, citlali]) - fightingSpiritBuilt(mav, raiden, [raiden, mav])).toBe(71);
    expect(fightingSpiritBuilt(anemoMav, raiden, [raiden, anemoMav, citlali]) - fightingSpiritBuilt(anemoMav, raiden, [raiden, anemoMav])).toBe(55);
    // Under 100 she plays Skill only: her default combo without the Burst hit, whatever the team's reaction.
    expect(carryDamage(mav, ["melt"], [mav, byId.get("Citlali")!, bennett, xingqiu])?.combo).toBeDefined();
    expect(carryDamage(mav, [], [mav, bennett, xingqiu, neuv])?.combo).toBe("E C8F (Skill only: can't Burst)");
  });

  test("a kit buff limited to an attack type only helps carries who use it (#68)", () => {
    const buffLine = (s: ReturnType<typeof score>, id: string) => s.breakdown.find((l) => l.rule === "Buffs" && l.reason.startsWith(id));
    // Xianyun's bonus is Plunging Attack DMG: Xiao's rotation plunges, Hu Tao's doesn't. Xiao is modeled, so it is in
    // his damage (#202).
    expect(kitPart(buffLine(score("Xiao", "Xianyun", "Faruzan", "Furina"), "Xianyun")?.reason)).toBe("Xianyun buffs Xiao (~+57% damage)"); // uncapped since #90
    expect(buffLine(score("Hu Tao", "Xianyun", "Xingqiu", "Zhongli"), "Xianyun")).toEqual({
      rule: "Buffs",
      points: 0,
      reason: "Xianyun: their kit's buff doesn't apply to Hu Tao's damage",
    });
  });

  test("Pyro resonance only counts for a carry that scales on ATK (#51)", () => {
    const pyro = (s: ReturnType<typeof scoreTeam>) => s.breakdown.find((l) => l.reason.startsWith("Fervent Flames"));
    // Without a damage model, as points for an ATK scaler only.
    expect(pyro(score("Diluc (no model)", "Bennett", "Xiangling", "Xingqiu"))?.points).toBe(10);
    expect(pyro(score("Neuvillette (no model)", "Bennett", "Xiangling", "Furina"))).toEqual({
      rule: "Resonance",
      points: 0,
      reason: "Fervent Flames (+25% ATK), but Neuvillette (no model) scales on HP",
    });
    // A modeled carry has its +25% ATK in team damage (#186): Raiden's ATK hits gain, Neuvillette's HP hits don't.
    expect(pyro(score("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu"))).toEqual({ rule: "Resonance", points: 0, reason: "Fervent Flames (+25% ATK): in team damage" });
    const atk = (...ids: string[]) => teamBuffStats(team(...ids)[0], [], team(...ids)).atkPct;
    expect(atk("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu") - atk("Raiden Shogun", "Bennett", "Furina", "Xingqiu")).toBeCloseTo(0.25, 6);
  });

  test("the strongest fitting buffers count, whatever their team order (#60)", () => {
    // Yun Jin is listed first, but Furina and Bennett are worth more, so they are the two that count.
    const s = score("Diluc (no model)", "Yun Jin", "Bennett", "Furina");
    const buffs = s.breakdown.filter((l) => l.rule === "Buffs").map((l) => [l.reason.split(" ")[0], l.points]);
    expect(buffs).toEqual([["Furina", 16], ["Bennett", 12]]);
    // For modeled Hu Tao all three are in her damage: none scores, all show (team damage has no cap).
    expect(score("Hu Tao", "Yun Jin", "Bennett", "Furina").breakdown.filter((l) => l.rule === "Buffs").map((l) => l.points)).toEqual([0, 0, 0]);
  });

  test("Faruzan's buff reaches Xiao (#60)", () => {
    const s = score("Xiao", "Xianyun", "Faruzan", "Furina");
    // Her DMG bonus and her Anemo RES shred are both in his damage (#204): 0 points, the whole buff in damage.
    const faruzan = s.breakdown.find((l) => l.reason.startsWith("Faruzan buffs"));
    expect(faruzan?.points).toBe(0);
    expect(faruzan?.reason).toMatch(/of it in Xiao's damage\)$/);
    const [all, inDamage] = faruzan!.reason.match(/~\+\d+%/g)!;
    expect(inDamage).toBe(all);
  });

  test("Electro enablers partner a Dendro carry's Spread (#61)", () => {
    // Alhaitham and Tighnari are modeled, so their Spread counts by damage (#134). Alhaitham's hits that apply Dendro
    // (#226): 7 of 20 Normal Attack hits, 4 of 10 Burst hits, every other Projection Attack.
    expect(score("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu").breakdown.map((l) => l.reason)).toContain(
      "Spread adds ~+78% to Alhaitham's damage", // ICDs (#226); his guide's Gilded Dreams needs a reaction (#206)
    );
    expect(score("Tighnari", "Yae Miko", "Fischl", "Zhongli").breakdown.map((l) => l.reason)).toContain(
      // 1 in 4 Clusterbloom Arrows applies Dendro (#221); his guide's Wanderer's Troupe raises his Charged Attacks (#206).
      "Spread adds ~+90% to Tighnari's damage", // Zhongli's Tenacity ATK (#338)
    );
  });

  test("flat reaction damage is weighed against hits with the team's buffs (#157)", () => {
    const spread = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Spread adds"))?.reason;
    // Bennett's ATK raises Alhaitham's hits but not Spread's flat damage, so Spread adds a smaller share.
    // (ICDs, #226; with his guide's Gilded Dreams, whose ATK and EM need a reaction, #206.)
    expect(spread("Alhaitham", "Yae Miko", "Nahida", "Zhongli")).toBe("Spread adds ~+69% to Alhaitham's damage"); // Nahida's EM in damage (#186), Zhongli's Tenacity (#338)
    expect(spread("Alhaitham", "Bennett", "Nahida", "Kuki Shinobu")).toBe("Spread adds ~+60% to Alhaitham's damage"); // Noblesse (#338)
    // Lauma's flat DMG is for Bloom-type reactions, not his hits: no change.
    expect(spread("Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu")).toBe("Spread adds ~+78% to Alhaitham's damage");
    // Vaporize multiplies the whole hit, so ATK buffs leave its share alone.
    const vape = (...ids: string[]) => score(...ids).breakdown.find((l) => l.reason.startsWith("Vaporize adds"))?.reason;
    expect(vape("Hu Tao", "Xingqiu", "Bennett", "Zhongli")).toBe(vape("Hu Tao", "Xingqiu", "Yelan", "Zhongli"));
  });

  test("Hydro and Dendro resonance only count when the carry uses the stat (#59)", () => {
    const res = (s: ReturnType<typeof scoreTeam>, name: string) => s.breakdown.find((l) => l.reason.startsWith(name));
    // Without a damage model, as points when the carry uses the stat.
    expect(res(score("Kamisato Ayaka (no model)", "Diona", "Furina", "Mona"), "Soothing Water")).toEqual({
      rule: "Resonance",
      points: 0,
      reason: "Soothing Water, but Kamisato Ayaka (no model) scales on ATK",
    });
    expect(res(score("Neuvillette (no model)", "Furina", "Kaedehara Kazuha", "Zhongli"), "Soothing Water")?.points).toBe(5);
    // A modeled carry has them in team damage (#186): HP for HP hits, EM for the reactions the damage model reads.
    const inDamage = (name: string) => ({ rule: "Resonance", points: 0, reason: `${name}: in team damage` });
    expect(res(score("Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli"), "Soothing Water")).toEqual(inDamage("Soothing Water"));
    expect(res(score("Alhaitham", "Nahida", "Fischl", "Kuki Shinobu"), "Sprawling Greenery")).toEqual(inDamage("Sprawling Greenery"));
    expect(res(score("Kinich", "Emilie", "Xiangling", "Bennett"), "Sprawling Greenery")).toEqual(inDamage("Sprawling Greenery"));
    const em = (...ids: string[]) => teamBuffStats(team(...ids)[0], [], team(...ids), undefined, score(...ids).activeReactions).em;
    expect(em("Alhaitham", "Nahida", "Fischl", "Kuki Shinobu")).toBeGreaterThanOrEqual(50 + 20); // +20 after Spread
  });

  test("a hypercarry counts a third buffer (#51)", () => {
    const buffs = (s: ReturnType<typeof scoreTeam>) => s.breakdown.filter((l) => l.rule === "Buffs" && l.points > 0).length;
    // A hypercarry with no damage model (Lyney's copy, modeled since #230) has his buffers score points (Diluc with no
    // model: a reaction carry).
    expect(buffs(score("Lyney (no model)", "Furina", "Kaedehara Kazuha", "Zhongli"))).toBe(3);
    expect(buffs(score("Diluc (no model)", "Furina", "Kaedehara Kazuha", "Zhongli"))).toBe(2);
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
    // A carry without a damage model: for a modeled one Noblesse's ATK is in team damage (#206, kit.ts partyGearStats).
    const result = lines(geared({ Bennett: [noblesse], Zhongli: [noblesse] }, "Diluc (no model)", "Bennett", "Xingqiu", "Zhongli"), "Effects");
    expect(result.map((l) => l.reason)).toEqual(["Bennett 4pc Noblesse Oblige: ATK for Diluc (no model)"]);
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

  test("a Favonius weapon's particles lower the team's ER needs (#37)", () => {
    const favonius: EffectTag = { source: "weapon", id: "Favonius Sword", roles: ["battery"] };
    // Flins carries: in Neuvillette's sourced 24.5s rotation (#119) the gain rounds away (172% either way).
    const ids = ["Flins", "Ineffa", "Columbina", "Sucrose"];
    const need = (t: ScoringCharacter[], id: string) => scoreTeam(t).energy.find((e) => e.id === id)!.need!;
    expect(need(geared({ Sucrose: [favonius] }, ...ids), "Sucrose")).toBeLessThan(need(team(...ids), "Sucrose"));
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
