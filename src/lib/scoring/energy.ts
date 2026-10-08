import { ER_TARGETS } from "../../types/tags";
import type { ScoringCharacter } from "./types";

// ER % a member wants to burst every rotation: their guide-checked erTarget (#21), or the default for
// their energy need; undefined = not checked (low energy need and no erTarget).
export const erTargetOf = (m: ScoringCharacter) =>
  m.erTarget ?? (m.energyNeed === "low" ? undefined : ER_TARGETS[m.energyNeed]);

export interface EnergyLine {
  id: string;
  cost: number; // burst Energy cost, from genshin-db
  target?: number; // ER % to burst every rotation; undefined = not checked
  er?: number; // their actual ER %, when a build is entered
}

// The team's energy check: each Energy burst's cost against the member's ER target and, with a build,
// their actual ER. Targets come from build guides for a standard team, not from counting particles in
// this rotation (a particle model is a later feature).
export function energyCheck(members: ScoringCharacter[]): EnergyLine[] {
  return members
    .filter((m) => m.burstCost)
    .map((m) => ({ id: m.id, cost: m.burstCost!, target: erTargetOf(m), er: m.stats?.energyRecharge }));
}
