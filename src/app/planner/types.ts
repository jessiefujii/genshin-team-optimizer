import type { ScoringCharacter } from "@/lib/scoring/types";

// What the planner receives from the server: scoring data plus display fields from genshin-db.
// icon: genshin-db's icon file name ("UI_AvatarIcon_Hutao"), served by Enka (#179).
export type PlannerCharacter = ScoringCharacter & { rarity: number; icon?: string };

// A built member's weapon (#180) and artifact sets (#181) with their icons, for the team detail.
export interface MemberGear {
  name: string;
  icon?: string;
  refinement: number;
  sets: { set: string; pieces: 2 | 4; icon?: string }[];
}

// Choices for the build editor, from genshin-db: weapon names by weapon type, and artifact set names.
export interface BuildCatalog {
  weapons: Record<string, string[]>; // best rarity first
  sets: string[];
  weaponRarity: Record<string, number>; // every weapon, 1-2 stars too: the search's minimum checks it (#133)
  weaponIcons: Record<string, string>; // genshin-db's icon file name per weapon ("UI_EquipIcon_Pole_Homa"), from Enka (#180)
  setIcons: Record<string, string>; // per artifact set: its flower's icon, else its circlet's (one-piece sets) (#181)
}
