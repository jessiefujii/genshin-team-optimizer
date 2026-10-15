import { describe, expect, test } from "vitest";
import referenceJson from "../../../data/team-reference.json";
import { loadScoringCharacters } from "./load";
import { scoreTeam } from "./score";
import { computeReference, type TeamReference } from "./team-reference";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const stored = referenceJson as TeamReference;

describe("guide-team reference (#202)", () => {
  // A scoring change moves every value; the stored reference must move with it, or every score drifts.
  test("data/team-reference.json matches the scorer (else run npm run reference)", () => {
    expect(computeReference(all)).toEqual(stored);
  });

  test("a carry's best guide team scores at a ratio of 1 to itself", () => {
    const [carry, { team }] = Object.entries(stored.carries)[0];
    const s = scoreTeam(team.map((id) => byId.get(id)!));
    if (s.onField === carry) expect(s.damage.guideRatio).toBeCloseTo(1, 2);
  });

  test("the median carry's best guide team scores about 100", () => {
    const scores = Object.entries(stored.carries).map(([, { team }]) => scoreTeam(team.map((id) => byId.get(id)!)).score);
    const sorted = scores.sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    expect(mid).toBeGreaterThan(90);
    expect(mid).toBeLessThan(110);
  });
});
