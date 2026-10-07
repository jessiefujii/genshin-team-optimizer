import { scoreTeam } from "./score";
import type { ScoreOptions, ScoredTeam, ScoringCharacter } from "./types";

export interface SearchOptions extends ScoreOptions {
  mustInclude?: string[];
  exclude?: string[];
  limit?: number; // how many teams to return (default 20)
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
  const pool = roster.filter((c) => !excluded.has(c.id));
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
    if (!validTeam(team)) return;
    const scored = scoreTeam(team, options);
    if (top.length === limit && scored.score <= top[top.length - 1].score) return;
    const at = top.findIndex((t) => scored.score > t.score);
    top.splice(at === -1 ? top.length : at, 0, scored);
    if (top.length > limit) top.pop();
  };

  const pick = (start: number, chosen: ScoringCharacter[]) => {
    if (chosen.length === open) return consider([...fixed, ...chosen]);
    for (let i = start; i <= rest.length - (open - chosen.length); i++) {
      chosen.push(rest[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return top;
}
