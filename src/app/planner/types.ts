import type { ScoringCharacter } from "@/lib/scoring/types";

// What the planner receives from the server: scoring data plus display fields from genshin-db.
export type PlannerCharacter = ScoringCharacter & { weapon: string; rarity: number };
