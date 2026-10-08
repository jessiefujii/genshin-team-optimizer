import type { CharacterStats } from "../../types/build";
import type { EffectTag } from "../../types/effects";
import type { CharacterTags, Element, Family, Reaction } from "../../types/tags";

// What the scorer needs per character: the hand-written tags, the element from genshin-db, and
// final stats when the player has a build for them (no stats = scored at benchmark stats), and the
// effects.json entries from their weapon, sets and constellations.
export type ScoringCharacter = CharacterTags & {
  element: Element;
  weapon: string; // weapon type from genshin-db, e.g. 'Sword'
  stats?: CharacterStats;
  effects?: EffectTag[];
};

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
  defaultBuilds: string[]; // members with no build, scored as if built to the benchmark
}

export interface ScoreOptions {
  // Hexerei only counts after the character's Witch's Homework quest; undefined = assume done.
  hexereiUnlocked?: ReadonlySet<string>;
}

export type { Element, Family, Reaction };
