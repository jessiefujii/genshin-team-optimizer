// Timing checks, kept out of `npm test` because their result depends on machine load (#17).
// Run with `npm run bench`, which runs this file on its own.
import { expect, test } from "vitest";
import { characterEffects } from "./effects";
import { loadScoringCharacters } from "./load";
import { findBestTeams } from "./search";
import { suggestBuilds, suggestionCandidates } from "./suggest";
import type { ScoringCharacter } from "./types";

// 50 characters, every member at C6: the slowest case (most effects to check).
const big: ScoringCharacter[] = loadScoringCharacters()
  .filter((c) => !c.id.startsWith("Traveler ("))
  .slice(0, 50)
  .map((c) => ({ ...c, effects: characterEffects(c.id, 6) }));

// A fixed workload with no scoring code in it, printed before the timings: if it moves, the machine changed, not the
// code (#422). On the i7-1250U: ~115 ms on a P-core, ~190 ms on an E-core, and the search takes twice as long on an
// E-core. To compare commits, pin the run to P-cores and check this line.
function machineSpeed(): number {
  const times = Array.from({ length: 3 }, () => {
    const start = performance.now();
    const seen = new Map<number, number>();
    let sum = 0;
    for (let i = 0; i < 3_000_000; i++) {
      seen.set(i % 5000, i);
      sum += seen.get((i * 7) % 5000) ?? 0;
    }
    if (sum < 0) throw new Error("unreachable");
    return performance.now() - start;
  });
  return Math.round(Math.min(...times));
}

// Best of `n` runs in ms, printed so the numbers can be compared over time.
function bestOf(label: string, run: () => void, n = 5): number {
  const times = Array.from({ length: n }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  console.log(`${label}: best ${Math.round(Math.min(...times))} ms (runs: ${times.map(Math.round).join(", ")})`);
  return Math.min(...times);
}

// The planner searches in parts, one Web Worker each (#215), so the list arrives when the slowest part is done.
// Timed here one part after another: the slowest of PARTS is the parallel time, when each part has a core. 4 parts is
// conservative (the planner starts up to 8, one per spare core); the whole search on one thread is printed beside it.
const PARTS = 4;
function slowestPart(label: string, run: (part: { index: number; count: number }) => void, n = 3): number {
  const times = Array.from({ length: n }, () =>
    Math.max(...Array.from({ length: PARTS }, (_, index) => {
      const start = performance.now();
      run({ index, count: PARTS });
      return performance.now() - start;
    })),
  );
  console.log(`${label}: best ${Math.round(Math.min(...times))} ms (runs: ${times.map(Math.round).join(", ")})`);
  return Math.min(...times);
}

// Design doc target: a ranked list in under 2 s (#4).
test("team search for 50 characters", { timeout: 120_000 }, () => {
  console.log(`machine speed: ${machineSpeed()} ms (lower is faster)`);
  bestOf("search, 50 characters at C6, one thread", () => findBestTeams(big), 3);
  expect(slowestPart(`search, slowest of ${PARTS} parts`, (part) => findBestTeams(big, { part }))).toBeLessThan(2000);
});

// Suggestions arrive after the list (a second search), so they are timed separately with 10 unbuilt members, and have
// their own target (Jessie, 2026-11-03, #422): they score about 4x the teams, as any unbuilt member can get a suggestion,
// and scoring fewer loses suggestions.
test("build suggestions for 50 characters", { timeout: 120_000 }, () => {
  const roster = big.map((c, i) => (i % 5 === 0 ? { ...c, built: false } : c));
  const top = findBestTeams(roster);
  bestOf("suggestions, 10 of 50 not built, one thread", () => suggestBuilds(roster, top), 3);
  expect(slowestPart(`suggestions, slowest of ${PARTS} parts`, (part) => suggestionCandidates(roster, top, { part }))).toBeLessThan(5000);
});
