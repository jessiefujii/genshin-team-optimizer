import type { CharacterBuild, CharacterStats } from "../../types/build";
import type { EffectTag } from "../../types/effects";
import type { EnergyLine } from "./energy";
import type { RotationStep } from "./rotation";
import type { CharacterTags, Element, Family, Reaction } from "../../types/tags";

// What the scorer needs per character: the hand-written tags, the element from genshin-db, and
// final stats when the player has a build for them (no stats = scored at benchmark stats), and the
// effects.json entries from their weapon, sets and constellations.
export type ScoringCharacter = CharacterTags & {
  element: Element;
  weapon: string; // weapon type from genshin-db, e.g. 'Sword'
  burstCost?: number; // Energy for the Elemental Burst, from genshin-db; undefined = no Energy burst
  stats?: CharacterStats;
  talents?: CharacterBuild["talents"]; // from the same build as stats
  effects?: EffectTag[];
  built?: boolean; // false = the player marked them not built: left out of the search, suggested for building
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
  rotation: RotationStep[]; // generated from the members' rotation tags
  energy: EnergyLine[]; // the energy check for that rotation
}

export interface ScoreOptions {
  // Hexerei only counts after the character's Witch's Homework quest; undefined = assume done.
  hexereiUnlocked?: ReadonlySet<string>;
}

export type { Element, Family, Reaction };
