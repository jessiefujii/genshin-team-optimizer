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
    expect(canTrigger("vaporize", new Set(["Pyro", "Hydro"]), new Set())).toBe(true);
    expect(canTrigger("vaporize", new Set(["Pyro", "Cryo"]), new Set())).toBe(false);
    expect(canTrigger("swirl", new Set(["Anemo", "Geo"]), new Set())).toBe(false);
  });

  test("Stellar reactions need a Stellar Linchpin, not just a Stellar member (#45)", () => {
    expect(canTrigger("stellar-conduct", new Set(["Electro", "Cryo"]), new Set(["stellar"]))).toBe(false);
    expect(canTrigger("stellar-conduct", new Set(["Electro", "Cryo"]), new Set(["stellar"]), true)).toBe(true);
    // Alyosha benefits from Stellar-Conduct but can't enable it; Sandrone can.
    expect(score("Alyosha", "Ganyu", "Bennett", "Zhongli").activeReactions).not.toContain("stellar-conduct");
    expect(score("Alyosha", "Sandrone", "Bennett", "Zhongli").activeReactions).toContain("stellar-conduct");
  });

  test("Lunar reactions need a Moonsign member", () => {
    expect(canTrigger("lunar-charged", new Set(["Electro", "Hydro"]), new Set())).toBe(false);
    expect(canTrigger("lunar-charged", new Set(["Electro", "Hydro"]), new Set(["moonsign"]))).toBe(true);
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

    const neuv = score("Neuvillette", "Bennett", "Furina", "Xiangling");
    expect(neuv.breakdown.find((l) => l.reason.startsWith("Vaporize:"))?.reason).toBe(
      "Vaporize: Neuvillette + Bennett, Xiangling",
    );
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
    expect(locked.breakdown.some((l) => l.reason.includes("Hexerei"))).toBe(false);
    const done = scoreTeam(team(...ids), { hexereiUnlocked: ids });
    expect(done.breakdown.some((l) => l.reason.includes("Hexerei"))).toBe(true);
  });

  test("a family pair only counts when it helps the team (#43)", () => {
    // Mona and Nicole are Hexerei, but Hu Tao isn't: no Secret Rite bonus for her team.
    expect(score("Hu Tao", "Mona", "Nicole", "Zhongli").breakdown.some((l) => l.rule === "Family")).toBe(false);
    // Varka is Hexerei himself, so his Hexerei teammates count.
    expect(score("Varka", "Venti", "Klee", "Durin").breakdown.some((l) => l.rule === "Family")).toBe(true);
    // Moonsign pays off once a Lunar reaction is active.
    const lunar = score("Flins", "Columbina", "Ineffa", "Zhongli");
    expect(lunar.activeReactions).toContain("lunar-charged");
    expect(lunar.breakdown.some((l) => l.rule === "Family" && l.reason.includes("Moonsign"))).toBe(true);
  });

  test("a support's own team preference counts less than the carry's (#43)", () => {
    const prefs = (s: ReturnType<typeof score>) => s.breakdown.filter((l) => l.rule === "Team preference");
    // Chevreuse wants an all Pyro/Electro team; she's a support here.
    expect(prefs(score("Raiden Shogun", "Chevreuse", "Bennett", "Xiangling")).find((l) => l.reason.startsWith("Chevreuse"))?.points).toBe(5);
    // Zibai carrying with her partner Columbina: full points.
    expect(prefs(score("Zibai", "Columbina", "Illuga", "Zhongli")).find((l) => l.reason === "Zibai with Columbina")?.points).toBe(15);
  });

  test("Witch's Revelation characters count as Stellar only once their quest is done (#45)", () => {
    const ids = ["Wriothesley", "Sandrone", "Yae Miko", "Bennett"];
    const stellarFamily = (s: ReturnType<typeof scoreTeam>) => s.breakdown.some((l) => l.rule === "Family" && l.reason.includes("Stellar"));
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
      expect(buffLine(score("Hu Tao", "Bennett", "Xingqiu", "Yelan"), "Bennett")?.points).toBe(10);
      expect(buffLine(score("Raiden Shogun", "Bennett", "Xiangling", "Xingqiu"), "Bennett")?.points).toBe(10);
    });

    test("element buffs only count for that element", () => {
      expect(buffLine(score("Hu Tao", "Shenhe", "Xingqiu", "Zhongli"), "Shenhe")?.points).toBe(0);
      expect(buffLine(score("Kamisato Ayaka", "Shenhe", "Furina", "Kaedehara Kazuha"), "Shenhe")?.points).toBe(10);
    });

    test("EM buffs need a reaction that uses EM", () => {
      // Freeze does not scale with EM; Vaporize does.
      expect(buffLine(score("Kamisato Ayaka", "Sucrose", "Furina", "Shenhe"), "Sucrose")?.points).toBe(0);
      expect(buffLine(score("Hu Tao", "Sucrose", "Xingqiu", "Yelan"), "Sucrose")?.points).toBe(10);
    });

    test("reaction buffs need that reaction in the team", () => {
      expect(buffLine(score("Alhaitham", "Baizhu", "Fischl", "Kuki Shinobu"), "Baizhu")?.points).toBe(10);
      // Pyro + Dendro, but nobody here builds Burning, so no Dendro reaction is active.
      expect(buffLine(score("Diluc", "Baizhu", "Bennett", "Zhongli"), "Baizhu")?.points).toBe(0);
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
    expect(bennett(talents(1, 1, 13))).toEqual({ rule: "Buffs", points: 12, reason: "Bennett buffs Hu Tao (burst level 13)" });
    expect(bennett(talents(13, 13, 6))?.points).toBe(7);
    expect(bennett(talents(9, 9, 9))?.points).toBe(10);
  });

  test("passive buffs don't scale", () => {
    const swirl = ["Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"];
    const kazuha = lines(leveled({ "Kaedehara Kazuha": talents(1, 1, 1) }, ...swirl), "Buffs").find((l) => l.reason.startsWith("Kaedehara"));
    expect(kazuha).toEqual({ rule: "Buffs", points: 10, reason: "Kaedehara Kazuha buffs Hu Tao" });
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
    expect(conflicts("Kamisato Ayaka", "Bennett", "Furina", "Shenhe")).toEqual([
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
