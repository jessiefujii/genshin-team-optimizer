import { buildGaps } from "./score";
import { findBestTeams, type SearchOptions } from "./search";
import type { ScoredTeam, ScoringCharacter } from "./types";

export interface BuildSuggestion {
  id: string;
  gaps: string[]; // e.g. "ER 120% vs 180% target"; see buildGaps
  team: ScoredTeam; // their best team that would make the list once built, scored at benchmark
  rank: number; // where that team would land in the current list (1 = top)
}

// Owned characters worth building (design doc: build suggestions): their best team would make the
// top list if they were built to the benchmark, but their actual build or a "not built" mark keeps it out.
// `top` is the regular search's result for the same roster and options.
export function suggestBuilds(roster: ScoringCharacter[], top: ScoredTeam[], options: SearchOptions = {}): BuildSuggestion[] {
  const limit = options.limit ?? 20;
  const gaps = new Map<string, string[]>();
  for (const c of roster) {
    const g = buildGaps(c);
    if (g.length > 0 && !options.exclude?.includes(c.id)) gaps.set(c.id, g);
  }
  if (gaps.size === 0) return [];

  // Gappy members at benchmark: no stats or talents, counted as built. Effects from their gear stay.
  const potential = roster.map((c) => (gaps.has(c.id) ? { ...c, stats: undefined, talents: undefined, built: true } : c));
  const candidates = findBestTeams(potential, { ...options, requireAny: [...gaps.keys()], limit: limit + top.length });

  const floor = top.length < limit ? -Infinity : top[top.length - 1].score;
  const listed = new Set(top.map((t) => t.members.join("|")));
  const out = new Map<string, BuildSuggestion>();
  for (const team of candidates) {
    if (team.score <= floor || listed.has(team.members.join("|"))) continue;
    const rank = top.filter((t) => t.score >= team.score).length + 1;
    for (const id of team.members) {
      if (gaps.has(id) && !out.has(id)) out.set(id, { id, gaps: gaps.get(id)!, team, rank });
    }
  }
  return [...out.values()]; // best team first
}
