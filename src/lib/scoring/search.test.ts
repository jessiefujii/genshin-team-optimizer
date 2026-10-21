import { describe, expect, test } from "vitest";
import { loadScoringCharacters } from "./load";
import { findBestTeams, mergeTop, PRUNE_FROM, startSearch } from "./search";
import { pickSuggestions, suggestBuilds, suggestionCandidates, suggestionGaps } from "./suggest";
import type { ScoringCharacter } from "./types";

// 24 characters plus Furina and Yelan marked not built, so build suggestions have something to find.
const all = loadScoringCharacters();
const roster: ScoringCharacter[] = [
  ...all.filter((c) => !c.id.startsWith("Traveler (") && c.id !== "Furina" && c.id !== "Yelan").slice(0, 24),
  ...all.filter((c) => c.id === "Furina" || c.id === "Yelan").map((c) => ({ ...c, built: false })),
];
const ids = (teams: { members: string[] }[]) => teams.map((t) => t.members.join("|"));

describe("searching in parts (#215)", () => {
  test("the parts' merged results are the whole search's, for any number of parts", { timeout: 30_000 }, () => {
    const whole = findBestTeams(roster, { limit: 15 });
    for (const count of [1, 2, 3, 7]) {
      const parts = Array.from({ length: count }, (_, index) => findBestTeams(roster, { limit: 15, part: { index, count } }));
      expect(ids(mergeTop(parts, 15)), `${count} parts`).toEqual(ids(whole));
    }
  });

  test("with required members too", { timeout: 30_000 }, () => {
    const options = { limit: 10, mustInclude: [roster[0].id, roster[5].id] };
    const whole = findBestTeams(roster, options);
    const parts = [0, 1, 2].map((index) => findBestTeams(roster, { ...options, part: { index, count: 3 } }));
    expect(ids(mergeTop(parts, 10))).toEqual(ids(whole));
  });

  test("build suggestions from merged candidates are the whole search's", { timeout: 30_000 }, () => {
    const top = findBestTeams(roster, { limit: 10 });
    const whole = suggestBuilds(roster, top, { limit: 10 });
    expect(whole.length).toBeGreaterThan(0);
    const parts = [0, 1, 2, 3].map((index) => suggestionCandidates(roster, top, { limit: 10, part: { index, count: 4 } }));
    const merged = pickSuggestions(suggestionGaps(roster, { limit: 10 }), mergeTop(parts, 10 + top.length), top, 10);
    expect(merged.map((s) => [s.id, s.team.members.join("|"), s.rank])).toEqual(whole.map((s) => [s.id, s.team.members.join("|"), s.rank]));
  });
});

// From PRUNE_FROM usable characters the search scores each carry's likely teams only (#215); it should find what
// scoring every team finds. 30 characters, the last 30 (newer kits, more carries) with 5 of them not built.
describe("the pruned search finds the exact search's teams (#215)", () => {
  const big: ScoringCharacter[] = all
    .filter((c) => !c.id.startsWith("Traveler ("))
    .slice(-30)
    .map((c, i) => (i % 6 === 0 ? { ...c, built: false } : c));
  const built = big.filter((c) => c.built !== false);

  test("the top 20", { timeout: 120_000 }, () => {
    expect(built.length).toBeGreaterThanOrEqual(PRUNE_FROM);
    expect(ids(findBestTeams(built))).toEqual(ids(findBestTeams(built, { exact: true })));
  });

  test("and in parts", { timeout: 120_000 }, () => {
    const parts = [0, 1, 2, 3].map((index) => findBestTeams(built, { part: { index, count: 4 } }));
    expect(ids(mergeTop(parts, 20))).toEqual(ids(findBestTeams(built, { exact: true })));
  });

  // As the planner runs it (use-team-search.ts): each part's first carry, then the rest above the merged last place.
  test("and in waves", { timeout: 120_000 }, () => {
    for (const count of [4, 8]) {
      const searches = Array.from({ length: count }, (_, index) => startSearch(built, { part: { index, count } }));
      const first = mergeTop(searches.map((s) => s.next(1)), 20);
      const rest = searches.map((s) => s.next(Infinity, first[19].score - 1e-9));
      expect(ids(mergeTop([first, ...rest], 20)), `${count} parts`).toEqual(ids(findBestTeams(built)));
    }
  });

  test("the build-suggestion search", { timeout: 120_000 }, () => {
    const top = findBestTeams(big, { limit: 10 });
    const pruned = suggestionCandidates(big, top, { limit: 10 });
    expect(pruned.length).toBeGreaterThan(0);
    expect(ids(pruned)).toEqual(ids(suggestionCandidates(big, top, { limit: 10, exact: true })));
  });
});
