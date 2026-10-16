import { describe, expect, test } from "vitest";
import { loadScoringCharacters } from "./load";
import { findBestTeams, mergeTop } from "./search";
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
