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
export function baseAtk(characterId: string, character: Levelled, weaponId: string, weapon: Levelled): number | undefined {
  // The Traveler's tags.json ids are per element; Aether and Lumine have the same stats.
  const name = characterId.startsWith("Traveler (") ? "Aether" : characterId;
  // genshin-db matches names loosely ("Nope" finds some weapon), so only an exact name counts.
  const c = genshindb.characters(name);
  const w = genshindb.weapons(weaponId);
  const fromCharacter = c?.name === name ? c.stats(character.level, ascended(character))?.attack : undefined;
  const fromWeapon = w?.name === weaponId ? w.stats(weapon.level, ascended(weapon))?.attack : undefined;
  return fromCharacter === undefined || fromWeapon === undefined ? undefined : Math.round(fromCharacter + fromWeapon);
}
