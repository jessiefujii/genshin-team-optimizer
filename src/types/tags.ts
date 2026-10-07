// Types for data/tags.json, the hand-maintained character tags used by the scorer.

export const ROLES = ['main-dps', 'sub-dps', 'buffer', 'healer', 'shielder', 'battery', 'enabler'] as const;
export type Role = (typeof ROLES)[number];

export const REACTIONS = [
  'vaporize', 'melt', 'freeze', 'superconduct', 'electrocharged', 'overloaded', 'burning',
  'bloom', 'hyperbloom', 'burgeon', 'quicken', 'aggravate', 'spread', 'swirl', 'crystallize',
  // Moonsign (Nod-Krai) reactions: converted from Electro-Charged, Bloom and Hydro Crystallize
  'lunar-charged', 'lunar-bloom', 'lunar-crystallize',
  // Stellar reactions: converted from Superconduct and Cryo Swirl
  'stellar-conduct', 'stellar-swirl',
] as const;
export type Reaction = (typeof REACTIONS)[number];

// "Stellar Glimmer" is the umbrella term for both Stellar reactions, not a reaction of its own
export const STELLAR_GLIMMER: readonly Reaction[] = ['stellar-conduct', 'stellar-swirl'];

// Team mechanics that only work with other members of the same family.
// 'hexerei' counts only after the player finishes that character's Witch's Homework quest.
export const FAMILIES = ['moonsign', 'nightsoul', 'stellar', 'hexerei'] as const;
export type Family = (typeof FAMILIES)[number];

export const ELEMENTS = ['Pyro', 'Hydro', 'Electro', 'Cryo', 'Anemo', 'Geo', 'Dendro'] as const;
export type Element = (typeof ELEMENTS)[number];

// What makes a team better for this character, beyond roles and reactions.
// All fields of a composition must hold; counts include the character itself.
export interface CompositionPref {
  kind: 'composition';
  minElements?: Partial<Record<Element, number>>; // e.g. { Anemo: 2 }
  othersShareElement?: boolean; // members not covered by minElements are all one element
  onlyElements?: Element[]; // every member is one of these elements
  family?: { family: Family; min: number }; // at least `min` members from the family
  note?: string;
}

export interface PartnerPref {
  kind: 'partner';
  ids: string[]; // any one of these characters
  note?: string;
}

export type TeamPref = CompositionPref | PartnerPref;

export const SCALING_STATS = ['ATK', 'HP', 'DEF', 'EM'] as const;
export type ScalingStat = (typeof SCALING_STATS)[number];

// A buff counts for a carry only if every constraint it lists matches; a buff with none helps anyone.
export interface Buff {
  stat: string; // human-readable description
  scope: 'team' | 'active';
  affects?: ScalingStat; // carry must scale on this stat (EM also counts for reaction carries)
  elements?: Element[]; // carry must be one of these elements (elemental DMG bonus or RES shred)
  reactions?: Reaction[]; // one of these reactions must be active in the team
}

export interface CharacterTags {
  id: string; // genshin-db name, e.g. 'Kaedehara Kazuha'; Traveler uses 'Traveler (<Element>)'
  roles: Role[];
  fieldTime: 'on' | 'off' | 'flex';
  reactions: Reaction[]; // reactions this character enables or wants
  energyNeed: 'low' | 'medium' | 'high';
  buffs?: Buff[];
  scalesOn?: ScalingStat[]; // main DPS only: stats their damage scales on
  families?: Family[];
  teamPrefs?: TeamPref[];
  rotation: {
    slot: 'setup' | 'buffer' | 'carry';
    actions: string[]; // KQM notation, e.g. ['Q', 'E'] or ['E', 'N2C x8']
    buffSeconds?: number; // how long this character's buff or aura lasts
  };
  notes?: string; // entries starting with 'VERIFY:' text were drafted from talent text only
}
