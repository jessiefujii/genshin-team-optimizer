// Final stats as shown on the in-game Attributes screen. Percent stats are in percent
// (critRate 48.9 means 48.9%), so CV = 2 × critRate + critDmg lands near the ~200 benchmark.
export interface CharacterStats {
  atk: number;
  hp: number;
  def: number;
  critRate: number;
  critDmg: number;
  energyRecharge: number;
  elementalMastery: number;
  elementalDmgBonus: number; // for the character's own element
  physicalDmgBonus?: number; // Physical DMG Bonus (#222): from imports; builds saved before it have none
  // Character + weapon base ATK: the white number on the Attributes screen. ATK % buffs are a percent of
  // this (#80). Imports take Enka's number; the build editor gets it from the levels (src/lib/build/base-atk.ts).
  // Optional: builds saved before it existed don't have it.
  baseAtk?: number;
}

// One character's build, from a UID import or (later) the build editor.
export interface CharacterBuild {
  level: number;
  // Ascension phase 0-6 (src/lib/build/ascension.ts, #82): at level 80 it says 80/80 (5) or 80/90 (6), which
  // changes base stats. Optional: builds saved before it existed count as before ascending.
  ascension?: number;
  talents: { normal: number; skill: number; burst: number }; // as shown in game, C3/C5 bonus included
  weapon: { id: string; level: number; refinement: number; ascension?: number }; // genshin-db weapon name
  artifactSets: { set: string; pieces: 2 | 4 }[]; // genshin-db set names, active bonuses only
  stats: CharacterStats;
}

// A showcase character from Enka, matched to a tags.json id.
export interface ImportedCharacter {
  id: string;
  constellation: number;
  build: CharacterBuild;
}

export interface UidImport {
  uid: string;
  nickname: string;
  fetchedAt: string; // ISO time Enka was fetched; compared with roster updatedAt
  characters: ImportedCharacter[];
  unmatched: number[]; // Enka avatar IDs with no genshin-db or tags.json match
}
