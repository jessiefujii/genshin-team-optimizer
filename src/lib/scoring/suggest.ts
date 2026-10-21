import { buildGaps } from "./score";
import { findBestTeams, type SearchOptions } from "./search";
import type { ScoredTeam, ScoringCharacter } from "./types";

export interface BuildSuggestion {
  id: string;
  gaps: string[]; // e.g. "ER 120% vs 180% target"; see buildGaps
  team: ScoredTeam; // their best team that would make the list once built, scored at benchmark
  rank: number; // where that team would land in the current list (1 = top)
  alsoNeeds: string[]; // the team's other members who fall short too, who need building as well (#284)
}

// Owned characters worth building (design doc: build suggestions): their best team would make the
// top list if they were built to the benchmark, but their actual build or a "not built" mark keeps it out.
// `top` is the regular search's result for the same roster and options.
export function suggestBuilds(roster: ScoringCharacter[], top: ScoredTeam[], options: SearchOptions = {}): BuildSuggestion[] {
  const gaps = suggestionGaps(roster, options);
  if (gaps.size === 0) return [];
  return pickSuggestions(gaps, suggestionCandidates(roster, top, options), top, options.limit ?? 20);
}

// What keeps each owned character from their benchmark build, for those with something.
export function suggestionGaps(roster: ScoringCharacter[], options: SearchOptions = {}): Map<string, string[]> {
  const gaps = new Map<string, string[]>();
  for (const c of roster) {
    // A build below the search's minimum (#133) is a gap too: they sit out of the search but can still be suggested.
    const g = [...(c.belowMinimum ?? []), ...buildGaps(c)];
    if (g.length > 0 && !options.exclude?.includes(c.id)) gaps.set(c.id, g);
  }
  return gaps;
}

// The second search: the best teams with a gappy member at benchmark (no stats or talents, counted as built; effects
// from their gear stay). Searched in parts like the first one (options.part, #215); pickSuggestions takes the merge.
export function suggestionCandidates(roster: ScoringCharacter[], top: ScoredTeam[], options: SearchOptions = {}): ScoredTeam[] {
  const gaps = suggestionGaps(roster, options);
  if (gaps.size === 0) return [];
  const potential = roster.map((c) =>
    gaps.has(c.id) ? { ...c, stats: undefined, talents: undefined, built: true, belowMinimum: undefined } : c,
  );
  // pickSuggestions only takes teams above the list's last place, so the search skips the rest (#215).
  const limit = options.limit ?? 20;
  const above = top.length < limit ? undefined : top[top.length - 1].score;
  return findBestTeams(potential, { ...options, requireAny: [...gaps.keys()], limit: limit + top.length, above });
}

// Each gappy member's best candidate team that would make the list, best first. The candidates raise every gappy
// member at once, so a team with two of them needs both built (#284): a member's team is the best one where they are
// the only gappy member, and only without one, the best that needs others too (`alsoNeeds`), listed after.
export function pickSuggestions(gaps: Map<string, string[]>, candidates: ScoredTeam[], top: ScoredTeam[], limit: number): BuildSuggestion[] {
  const floor = top.length < limit ? -Infinity : top[top.length - 1].score;
  const listed = new Set(top.map((t) => t.members.join("|")));
  const alone = new Map<string, BuildSuggestion>();
  const withOthers = new Map<string, BuildSuggestion>();
  for (const team of candidates) {
    if (team.score <= floor || listed.has(team.members.join("|"))) continue;
    const rank = top.filter((t) => t.score >= team.score).length + 1;
    const gappy = team.members.filter((id) => gaps.has(id));
    for (const id of gappy) {
      const alsoNeeds = gappy.filter((other) => other !== id);
      const out = alsoNeeds.length === 0 ? alone : withOthers;
      if (!out.has(id)) out.set(id, { id, gaps: gaps.get(id)!, team, rank, alsoNeeds });
    }
  }
  return [...alone.values(), ...[...withOthers.values()].filter((s) => !alone.has(s.id))];
}
