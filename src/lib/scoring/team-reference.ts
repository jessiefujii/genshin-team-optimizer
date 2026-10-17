// The guide-team reference for the team score (#202, Jessie 2026-10-15): each carry's best guide team (known-teams.ts
// and meta-teams.ts, read with that carry on field at benchmark builds) and the median of their values. Teams score
// against the median, so stronger carries rank higher; each carry's own best guide team gives the per-carry ratio.
// data/team-reference.json holds the result: `npm run reference` rewrites it after a scoring change, and
// team-reference.test.ts fails while it is stale. Carries with no guide team get one sourced first (#210).
import { GUIDE_TEAMS } from "./guide-teams";
import { KNOWN_TEAMS } from "./known-teams";
import { META_TEAMS } from "./meta-teams";
import { carryTeamValue } from "./score";
import type { ScoringCharacter } from "./types";

export interface TeamReference {
  median: number;
  carries: Record<string, { team: string[]; value: number }>;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function computeReference(all: readonly ScoringCharacter[]): TeamReference {
  const byId = new Map(all.map((c) => [c.id, c]));
  const guide = new Map<string, (readonly string[])[]>();
  for (const k of KNOWN_TEAMS) guide.set(k.carry, [...k.teams]);
  for (const m of META_TEAMS) guide.set(m.carry, [...(guide.get(m.carry) ?? []), m.topPick, ...m.teams]);
  for (const g of GUIDE_TEAMS) guide.set(g.carry, [...(guide.get(g.carry) ?? []), ...g.teams]);

  const carries: TeamReference["carries"] = {};
  for (const carry of [...guide.keys()].sort()) {
    let best: { team: string[]; value: number } | null = null;
    for (const ids of guide.get(carry)!) {
      const value = round(carryTeamValue(ids.map((id) => byId.get(id)!), carry));
      if (!best || value > best.value) best = { team: [...ids], value };
    }
    carries[carry] = best!;
  }
  const values = Object.values(carries).map((c) => c.value).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : round((values[mid - 1] + values[mid]) / 2);
  return { median, carries };
}
