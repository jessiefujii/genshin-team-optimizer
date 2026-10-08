// Types for data/effects.json: team-relevant effects of weapons, artifact sets and constellations.
// Self-only stat boosts are left out; a character's final stats already include them.
import type { Buff, Element, Role } from "./tags";

export const EFFECT_SOURCES = ["weapon", "set", "constellation"] as const;
export type EffectSource = (typeof EFFECT_SOURCES)[number];

export interface EffectTag {
  source: EffectSource;
  id: string; // genshin-db name: weapon, artifact set, or character (for constellations)
  requires?: number; // set pieces (2 | 4) or constellation level (1-6); weapons apply at any refinement
  name?: string; // the effect's in-game name, e.g. 'Windfall' or 'Fire Ventures With Me'
  buffs?: Buff[]; // buffs for the party or the active character, with the same fit rules as tags
  roles?: Role[]; // roles the item adds to its holder, e.g. Favonius weapons make a battery
  infusion?: Element; // infuses teammates' melee attacks (C6 Bennett): conflicts with other-element melee carries
  notes?: string; // 'VERIFY:' marks entries drafted from item text by scripts/draft-effects.mjs
}
