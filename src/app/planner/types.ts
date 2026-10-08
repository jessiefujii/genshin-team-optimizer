import type { ScoringCharacter } from "@/lib/scoring/types";

// What the planner receives from the server: scoring data plus display fields from genshin-db.
export type PlannerCharacter = ScoringCharacter & { rarity: number };

// Choices for the build editor, from genshin-db: weapon names by weapon type, and artifact set names.
export interface BuildCatalog {
  weapons: Record<string, string[]>; // best rarity first
  sets: string[];
}
