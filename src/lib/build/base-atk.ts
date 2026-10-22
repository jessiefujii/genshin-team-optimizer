import genshindb from "genshin-db";
import { ascensionOf } from "./ascension";

// Server-side only: genshin-db is ~178 MB.

export interface Levelled {
  level: number;
  ascension?: number; // phase 0-6; undefined = before ascending (builds saved before #82)
}

// genshin-db gives the value before ascending unless asked for "+".
const ascended = (l: Levelled) => (l.ascension !== undefined && l.ascension > ascensionOf(l.level, false) ? "+" : undefined);

// Base ATK (character + weapon, the white number on the Attributes screen) is fixed by the character's
// level and the weapon and its level, so a build typed in by hand gets it from genshin-db instead of a
// field (#80). Imports use Enka's own number. At an ascension level (20, 40, 50, ... 80) the game has two
// values, before and after ascending; `ascension` says which (#82). undefined when genshin-db doesn't know
// the character or weapon.
// The Traveler's quest bonuses to Base ATK, which genshin-db's (game data's) growth curve doesn't include (#84; Genshin
// Impact Wiki, Traveler § Gameplay Notes, fetched 2026-10-18): +3 from Activated・Canned Knowledge in Archon Quest Ever
// So Close, +7 from Special Training in Skirk's Story Quest (which also gives +50 Base HP and +15 EM; a typed build
// enters those as panel stats). Both done by default, as on Jessie's account (Enka: 830.5 = genshin-db's 820.5 + 10);
// the build editor asks (#265).
export interface TravelerQuests {
  everSoClose: boolean;
  skirkTraining: boolean;
}
export const BOTH_QUESTS_DONE: TravelerQuests = { everSoClose: true, skirkTraining: true };
const questAtk = (q: TravelerQuests) => (q.everSoClose ? 3 : 0) + (q.skirkTraining ? 7 : 0);

export function baseAtk(
  characterId: string,
  character: Levelled,
  weaponId: string,
  weapon: Levelled,
  quests: TravelerQuests = BOTH_QUESTS_DONE,
): number | undefined {
  // The Traveler's tags.json ids are per element; Aether and Lumine have the same stats.
  const traveler = characterId.startsWith("Traveler (");
  const name = traveler ? "Aether" : characterId;
  // genshin-db matches names loosely ("Nope" finds some weapon), so only an exact name counts.
  const c = genshindb.characters(name);
  const w = genshindb.weapons(weaponId);
  const fromCharacter = c?.name === name ? c.stats(character.level, ascended(character))?.attack : undefined;
  const fromWeapon = w?.name === weaponId ? w.stats(weapon.level, ascended(weapon))?.attack : undefined;
  if (fromCharacter === undefined || fromWeapon === undefined) return undefined;
  return Math.round(fromCharacter + (traveler ? questAtk(quests) : 0) + fromWeapon);
}
