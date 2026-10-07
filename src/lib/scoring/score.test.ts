import { describe, expect, test } from "vitest";
import { canTrigger } from "./reactions";
import { loadScoringCharacters } from "./load";
import { scoreTeam } from "./score";
import { findBestTeams } from "./search";
import type { CharacterStats } from "../../types/build";
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
    const locked = scoreTeam(team(...ids), { hexereiUnlocked: new Set(["Varka"]) });
    expect(locked.breakdown.some((l) => l.reason.includes("Hexerei"))).toBe(false);
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

  test("a 50-character roster finishes quickly", () => {
    const big: ScoringCharacter[] = all.filter((c) => !c.id.startsWith("Traveler (")).slice(0, 50);
    const start = performance.now();
    findBestTeams(big);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  test("unknown required character is an error", () => {
    expect(() => findBestTeams(roster, { mustInclude: ["Nobody"] })).toThrow();
  });
});
