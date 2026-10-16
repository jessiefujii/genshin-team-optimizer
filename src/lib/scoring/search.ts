import { scoreTeam, teamScore } from "./score";
import type { ScoreOptions, ScoredTeam, ScoringCharacter } from "./types";

export interface SearchOptions extends ScoreOptions {
  mustInclude?: string[];
  exclude?: string[];
  requireAny?: string[]; // only teams with at least one of these (the build-suggestion search)
  limit?: number; // how many teams to return (default 20)
  // One of `count` parts of the search, for searching in parallel (#215): the teams whose first open member is every
  // count-th of the roster, starting at `index`. mergeTop of all the parts' results equals the whole search.
  part?: { index: number; count: number };
}

// Higher score first; equal scores by member ids, so the parts merge into the same order as the whole search.
const order = (a: ScoredTeam, b: ScoredTeam) => b.score - a.score || (a.members.join("|") < b.members.join("|") ? -1 : 1);

// The best `limit` of several parts' results.
export function mergeTop(parts: ScoredTeam[][], limit: number): ScoredTeam[] {
  return parts.flat().sort(order).slice(0, limit);
}

const isTraveler = (c: ScoringCharacter) => c.id.startsWith("Traveler (");

// Only one Traveler element can be in a party at a time.
function validTeam(team: ScoringCharacter[]): boolean {
  return team.filter(isTraveler).length <= 1;
}

// Tries every 4-character team from the roster and returns the best `limit`, highest score first.
export function findBestTeams(roster: ScoringCharacter[], options: SearchOptions = {}): ScoredTeam[] {
  const limit = options.limit ?? 20;
  const excluded = new Set(options.exclude ?? []);
  const required = options.mustInclude ?? [];
  // Characters marked not built, or whose build misses the minimum (#133), sit out unless the player asked for them.
  const usable = (c: ScoringCharacter) => c.built !== false && !c.belowMinimum?.length;
  const pool = roster.filter((c) => !excluded.has(c.id) && (usable(c) || required.includes(c.id)));
  const anyOf = options.requireAny && new Set(options.requireAny);
  const fixed = required.map((id) => {
    const c = pool.find((p) => p.id === id);
    if (!c) throw new Error(`${id} is not in the roster`);
    return c;
  });
  if (fixed.length > 4) throw new Error("At most 4 characters can be required");
  const rest = pool.filter((c) => !required.includes(c.id));
  const open = 4 - fixed.length;

  const top: ScoredTeam[] = [];
  const consider = (team: ScoringCharacter[]) => {
    if (!validTeam(team) || (anyOf && !team.some((c) => anyOf.has(c.id)))) return;
    // Score first; build the breakdown only for teams that make the list.
    // A tie with the last place still gets in when its ids sort first (order), as when the parts merge.
    if (top.length === limit && teamScore(team, options) < top[top.length - 1].score) return;
    const scored = scoreTeam(team, options);
    const at = top.findIndex((t) => order(scored, t) < 0);
    if (at === -1 && top.length === limit) return;
    top.splice(at === -1 ? top.length : at, 0, scored);
    if (top.length > limit) top.pop();
  };

  const part = options.part ?? { index: 0, count: 1 };
  const pick = (start: number, chosen: ScoringCharacter[]) => {
    if (chosen.length === open) return consider([...fixed, ...chosen]);
    for (let i = start; i <= rest.length - (open - chosen.length); i++) {
      if (chosen.length === 0 && i % part.count !== part.index) continue;
      chosen.push(rest[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  if (open > 0 || part.index === 0) pick(0, []); // with every member fixed, the one team belongs to part 0
  return top;
}
