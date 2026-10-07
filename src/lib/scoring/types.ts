import type { CharacterTags, Element, Family, Reaction } from "../../types/tags";

// What the scorer needs per character: the hand-written tags plus the element from genshin-db.
export type ScoringCharacter = CharacterTags & { element: Element };

export interface ScoreLine {
  rule: string;
  points: number;
  reason: string;
}

export interface ScoredTeam {
  members: [string, string, string, string];
  carry: string | null;
  score: number;
  breakdown: ScoreLine[];
  activeReactions: Reaction[];
}

export interface ScoreOptions {
  // Hexerei only counts after the character's Witch's Homework quest; undefined = assume done.
  hexereiUnlocked?: ReadonlySet<string>;
}

export type { Element, Family, Reaction };
