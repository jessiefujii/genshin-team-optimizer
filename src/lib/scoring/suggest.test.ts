import { describe, expect, test } from "vitest";
import type { CharacterStats } from "../../types/build";
import { loadScoringCharacters } from "./load";
import { buildGaps } from "./score";
import { findBestTeams } from "./search";
import { suggestBuilds } from "./suggest";
import type { ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const get = (id: string) => byId.get(id)!;
const benchmark: CharacterStats = {
  atk: 2000, hp: 30000, def: 800, critRate: 60, critDmg: 80,
  energyRecharge: 250, elementalMastery: 100, elementalDmgBonus: 46.6,
};
const talents = (normal: number, skill: number, burst: number) => ({ normal, skill, burst });

describe("buildGaps", () => {
  test("no build entered and built = no gaps (assumed at benchmark)", () => {
    expect(buildGaps(get("Xingqiu"))).toEqual([]);
  });

  test("names every shortfall against the benchmark", () => {
    const hutao = { ...get("Hu Tao"), stats: { ...benchmark, critRate: 30, critDmg: 60 }, talents: talents(6, 10, 10) };
    expect(buildGaps(hutao)).toEqual(["CV 120 vs 200", "normal level 6 vs 9"]);
    const xingqiu = { ...get("Xingqiu"), stats: { ...benchmark, energyRecharge: 120 } };
    expect(buildGaps(xingqiu)).toEqual(["ER 120% vs 200% target"]);
    const kazuha = { ...get("Kaedehara Kazuha"), stats: { ...benchmark, elementalMastery: 200 } };
    expect(buildGaps(kazuha)).toEqual(["EM 200 vs 300+"]);
  });

  test("a buffer's skill or burst talent counts; passive buffs don't", () => {
    expect(buildGaps({ ...get("Bennett"), talents: talents(1, 1, 6) })).toEqual(["burst level 6 vs 9"]);
    expect(buildGaps({ ...get("Kaedehara Kazuha"), talents: talents(1, 1, 1) })).toEqual([]);
  });

  test("marked not built", () => {
    expect(buildGaps({ ...get("Xingqiu"), built: false })).toEqual(["marked not built"]);
  });
});

describe("not built characters in the search", () => {
  const roster = ["Hu Tao", "Xingqiu", "Yelan", "Zhongli", "Bennett", "Xiangling"].map(get);
  const unbuilt = roster.map((c) => (c.id === "Xingqiu" ? { ...c, built: false } : c));

  test("sit out of the teams", () => {
    for (const t of findBestTeams(unbuilt, { limit: 15 })) expect(t.members).not.toContain("Xingqiu");
  });

  test("unless the player asked for them", () => {
    const [best] = findBestTeams(unbuilt, { mustInclude: ["Xingqiu"], limit: 1 });
    expect(best.members).toContain("Xingqiu");
  });

  // A build below the search's minimum sits out the same way, even when marked built (#133).
  const below = roster.map((c) => (c.id === "Xingqiu" ? { ...c, belowMinimum: ["weapon level 1"] } : c));
  test("so does a build below the minimum (#133)", () => {
    for (const t of findBestTeams(below, { limit: 15 })) expect(t.members).not.toContain("Xingqiu");
    expect(findBestTeams(below, { mustInclude: ["Xingqiu"], limit: 1 })[0].members).toContain("Xingqiu");
  });
});

describe("suggestBuilds", () => {
  const ids = ["Hu Tao", "Xingqiu", "Yelan", "Zhongli", "Bennett", "Xiangling", "Kaedehara Kazuha", "Fischl"];
  const roster: ScoringCharacter[] = ids.map(get);
  const search = (r: ScoringCharacter[]) => {
    const top = findBestTeams(r, { limit: 3 });
    return { top, suggestions: suggestBuilds(r, top, { limit: 3 }) };
  };

  test("nothing to suggest when nobody falls short", () => {
    expect(search(roster).suggestions).toEqual([]);
  });

  test("an unbuilt character whose team would make the list is suggested, with the gap and rank", () => {
    const r = roster.map((c) => (c.id === "Xingqiu" ? { ...c, built: false } : c));
    const { top, suggestions } = search(r);
    const xq = suggestions.find((s) => s.id === "Xingqiu");
    expect(xq).toBeDefined();
    expect(xq!.gaps).toEqual(["marked not built"]);
    expect(xq!.team.members).toContain("Xingqiu");
    expect(xq!.team.score).toBeGreaterThan(top[top.length - 1].score);
    expect(xq!.rank).toBe(top.filter((t) => t.score >= xq!.team.score).length + 1);
  });

  test("a build below the search's minimum is still suggested, with the reason (#133)", () => {
    const r = roster.map((c) => (c.id === "Xingqiu" ? { ...c, belowMinimum: ["no artifact set"] } : c));
    const xq = search(r).suggestions.find((s) => s.id === "Xingqiu");
    expect(xq?.gaps).toEqual(["no artifact set"]);
    expect(xq?.team.members).toContain("Xingqiu");
  });

  test("a weak build is suggested only when fixing it would make the list", () => {
    // Xingqiu's 100% ER costs his teams points; at benchmark they climb back into the top 3.
    const weak = roster.map((c) => (c.id === "Xingqiu" ? { ...c, stats: { ...benchmark, energyRecharge: 100 } } : c));
    const { top, suggestions } = search(weak);
    for (const s of suggestions) {
      expect(s.team.score).toBeGreaterThan(top[top.length - 1].score);
      expect(top.some((t) => t.members.join("|") === s.team.members.join("|"))).toBe(false);
    }
  });
});
