import genshindb from "genshin-db";

// Server-side only: genshin-db is ~178 MB.

// Base ATK (character + weapon, the white number on the Attributes screen) is fixed by the character's
// level and the weapon and its level, so a build typed in by hand gets it from genshin-db instead of a
// field (#80). Imports use Enka's own number. At an ascension level (20, 40, 50, ... 80) the game has two
// values; without knowing which, this takes the one before ascending (genshin-db's default), which matched
// Enka for a level 80 Ayaka. undefined when genshin-db doesn't know the character or weapon.
export function baseAtk(characterId: string, level: number, weaponId: string, weaponLevel: number): number | undefined {
  // The Traveler's tags.json ids are per element; Aether and Lumine have the same stats.
  const name = characterId.startsWith("Traveler (") ? "Aether" : characterId;
  // genshin-db matches names loosely ("Nope" finds some weapon), so only an exact name counts.
  const c = genshindb.characters(name);
  const w = genshindb.weapons(weaponId);
  const character = c?.name === name ? c.stats(level)?.attack : undefined;
  const weapon = w?.name === weaponId ? w.stats(weaponLevel)?.attack : undefined;
  return character === undefined || weapon === undefined ? undefined : Math.round(character + weapon);
}
