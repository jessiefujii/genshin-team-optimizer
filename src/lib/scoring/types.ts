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
  belowMinimum?: string[]; // why their build misses the search's minimum (#133): left out like built: false
};

export interface ScoreLine {
  rule: string;
  points: number;
  reason: string;
}

export interface ScoredTeam {
  members: [string, string, string, string];
  mainDps: string | null; // who deals the most damage: the on-field carry, or an off-field DPS who out-damages them (#96)
  onField: string | null; // the on-field carry the rotation and buffs are built around
  score: number; // team damage against the guide-team reference: 100 = the median carry's best guide team (#202)
  damage: { perSecond: number; factor: number; guideRatio: number | null }; // guideRatio: vs this carry's best guide team
  breakdown: ScoreLine[];
  activeReactions: Reaction[];
  defaultBuilds: string[]; // members with no build, scored as if built to the benchmark
  rotation: RotationStep[]; // generated from the members' rotation tags
  energy: EnergyLine[]; // the energy check for that rotation
}

export interface ScoreOptions {
  // Hexerei only counts after the character's Witch's Homework quest: the ids whose quest is done.
  // An array, not a Set, so the options survive JSON (the search hook and worker). Undefined = assume all done.
  hexereiUnlocked?: readonly string[];
  // Characters who gained Stellar Glimmer in an update count for the Stellar family only after their
  // Witch's Revelation quest: the ids whose quest is done. Undefined = assume all done.
  revelationUnlocked?: readonly string[];
}

export type { Element, Family, Reaction };
