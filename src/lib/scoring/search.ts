import { carryTeamValue, scoreTeam, teamScore } from "./score";
import type { ScoreOptions, ScoredTeam, ScoringCharacter } from "./types";

export interface SearchOptions extends ScoreOptions {
  mustInclude?: string[];
  exclude?: string[];
  requireAny?: string[]; // only teams with at least one of these (the build-suggestion search)
  limit?: number; // how many teams to return (default 20)
  // One of `count` parts of the search, for searching in parallel (#215): the teams whose first open member is every
  // count-th of the roster, starting at `index` (pruned: the carries that are). mergeTop of all the parts' results
  // equals the whole search.
  part?: { index: number; count: number };
  exact?: boolean; // score every team, even in a large roster (no carryPlans pruning)
  above?: number; // only teams scoring above this (the build-suggestion search: the list's last place, #215)
}

// Higher score first; equal scores by member ids, so the parts merge into the same order as the whole search.
const order = (a: ScoredTeam, b: ScoredTeam) => b.score - a.score || (a.members.join("|") < b.members.join("|") ? -1 : 1);

// The best `limit` of several parts' results. A pruned search can find the same team in two parts (two of its
// members are carries), so a team counts once.
export function mergeTop(parts: ScoredTeam[][], limit: number): ScoredTeam[] {
  const seen = new Set<string>();
  return parts
    .flat()
    .sort(order)
    .filter((t) => {
      const key = t.members.join("|");
      return !seen.has(key) && !!seen.add(key);
    })
    .slice(0, limit);
}

// A large roster has too many teams to score every one (50 characters: 230,300, #215), so above PRUNE_FROM usable
// characters the search scores each carry's likely teams: the carry with 3 of their SUPPORTS_PER_CARRY best supports.
// A support's rank is the best value it reached with that carry while a team for them is built by swaps (supportRanks).
// Carries go strongest first (by that team's score), and a carry whose team, CARRY_SLACK up, can't reach the list's
// last place is skipped with every carry after them: on two 50-character rosters a carry's best team was at most 18.6%
// above their swapped team (Wriothesley). Checked against the exact search (search.test.ts, search.perf.test.ts): the
// 50-character bench's top 20 use at most their carry's 13th best support. Below PRUNE_FROM, and with a required
// member, every team is scored.
export const PRUNE_FROM = 25;
const SUPPORTS_PER_CARRY = 20;
const SWAP_ROUNDS = 3;
const CARRY_SLACK = 1.3;

// The carry's supports, best first, and the best team found: from a starting team (the carry and the first three
// others), each round tries every other character in each of the three support slots, reading the carry on field
// (carryTeamValue), and keeps the best team; it stops when a round finds nothing better. A support's value is the best
// of its tries. Later rounds try many of the same teams again, so each team is read once (#215).
function supportRanks(carry: ScoringCharacter, others: ScoringCharacter[], options: ScoreOptions) {
  const best = new Map<ScoringCharacter, number>();
  const values = new Map<string, number>();
  const read = (team: ScoringCharacter[]) => {
    const key = team.map((m) => m.id).sort().join("|");
    let v = values.get(key);
    if (v === undefined) values.set(key, (v = validTeam(team) ? carryTeamValue(team, carry.id, options) : -Infinity));
    for (const s of team) if (s !== carry && v > (best.get(s) ?? -Infinity)) best.set(s, v);
    return v;
  };
  let team = [carry, ...others.slice(0, 3)];
  let value = read(team);
  for (let round = 0; round < SWAP_ROUNDS; round++) {
    let next = team;
    let nextValue = value;
    for (let slot = 1; slot <= 3; slot++) {
      for (const s of others) {
        if (team.includes(s)) continue;
        const tried = team.map((m, i) => (i === slot ? s : m));
        const v = read(tried);
        if (v > nextValue) [next, nextValue] = [tried, v];
      }
    }
    if (next === team) break;
    [team, value] = [next, nextValue];
  }
  return { ranked: [...others].sort((a, b) => (best.get(b) ?? -Infinity) - (best.get(a) ?? -Infinity)), team };
}

// A pruned search's carries in this part, strongest first: each with their swapped team's score (`estimate`) and the
// supports their teams take, their best SUPPORTS_PER_CARRY plus every character the search requires one of
// (requireAny), so suggestions still see them.
function carryPlans(pool: ScoringCharacter[], options: SearchOptions, part: { index: number; count: number }) {
  const anyOf = new Set(options.requireAny ?? []);
  return pool
    .filter((c) => c.roles.includes("main-dps"))
    .filter((_, i) => i % part.count === part.index)
    .map((carry) => {
      const others = pool.filter((c) => c !== carry);
      const { ranked, team } = supportRanks(carry, others, options);
      const picks = [...new Set([...ranked.slice(0, SUPPORTS_PER_CARRY), ...others.filter((c) => anyOf.has(c.id))])];
      return { carry, picks, estimate: teamScore(team, options) };
    })
    .sort((a, b) => b.estimate - a.estimate);
}

const isTraveler = (c: ScoringCharacter) => c.id.startsWith("Traveler (");

// Only one Traveler element can be in a party at a time.
function validTeam(team: ScoringCharacter[]): boolean {
  return team.filter(isTraveler).length <= 1;
}

// Tries every 4-character team from the roster and returns the best `limit`, highest score first.
export function findBestTeams(roster: ScoringCharacter[], options: SearchOptions = {}): ScoredTeam[] {
  const limit = options.limit ?? 20;
  const above = options.above ?? -Infinity;
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
    if (top.length === limit || above > -Infinity) {
      const score = teamScore(team, options);
      if (score <= above || (top.length === limit && score < top[top.length - 1].score)) return;
    }
    const scored = scoreTeam(team, options);
    const at = top.findIndex((t) => order(scored, t) < 0);
    if (at === -1 && top.length === limit) return;
    top.splice(at === -1 ? top.length : at, 0, scored);
    if (top.length > limit) top.pop();
  };

  const part = options.part ?? { index: 0, count: 1 };
  if (!options.exact && fixed.length === 0 && rest.length >= PRUNE_FROM) {
    // Members in roster order, as the exact search builds them; each team once, though two of its members carry.
    const at = new Map(rest.map((c, i) => [c, i]));
    const seen = new Set<string>();
    for (const { carry, picks, estimate } of carryPlans(rest, options, part)) {
      const bar = Math.max(above, top.length === limit ? top[limit - 1].score : -Infinity);
      if (estimate * CARRY_SLACK < bar) break;
      for (let a = 0; a < picks.length; a++)
        for (let b = a + 1; b < picks.length; b++)
          for (let c = b + 1; c < picks.length; c++) {
            const team = [carry, picks[a], picks[b], picks[c]].sort((x, y) => at.get(x)! - at.get(y)!);
            const key = team.map((m) => m.id).join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            consider(team);
          }
    }
    return top;
  }
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
