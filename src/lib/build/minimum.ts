import type { CharacterBuild } from "../../types/build";
import type { Talent } from "../../types/tags";

// Minimum requirements for the team search (#133, Jessie): a build that misses one sits out of the search, like an
// unticked Built box, but still shows under Worth building. Large rosters (80+ characters, ~1.6 million teams) stay
// fast this way. Without a build there's nothing to check: the Built box decides alone.
export const MINIMUM = {
  // Jessie (2026-10-12): "level 60 and below isn't built".
  level: 61,
  // An unascended weapon (level 20 or below, the first ascension cap). Kept below the character floor on purpose: a
  // weapon at 40-60 still gives most of its stat line, and Jessie's built Barbara, Cyno and Kaeya use level 46-50 ones.
  weaponLevel: 21,
  weaponRarity: 3,
  // A main DPS's key talent (tags keyTalent) never levelled. Lenient on purpose: supports often leave Normal Attack at 1.
  keyTalentLevel: 2,
};

const talentName: Record<Talent, string> = { normal: "Normal Attack", skill: "Skill", burst: "Burst" };

export function belowMinimum(
  build: CharacterBuild | undefined,
  weaponRarity: Record<string, number>,
  keyTalent?: Talent,
): string[] {
  if (!build) return [];
  const why: string[] = [];
  // `artifactSets` only lists active set bonuses, so 4 artifacts from 4 different sets read the same as none.
  if (build.artifactSets.length === 0) why.push("no artifact set bonus (no 2- or 4-piece set)");
  if (build.level < MINIMUM.level) why.push(`level ${build.level}: below the level ${MINIMUM.level} minimum`);
  if (build.weapon.level < MINIMUM.weaponLevel) {
    why.push(`weapon level ${build.weapon.level}: below the level ${MINIMUM.weaponLevel} minimum (not ascended)`);
  }
  const rarity = weaponRarity[build.weapon.id];
  if (rarity !== undefined && rarity < MINIMUM.weaponRarity) why.push(`${rarity}-star weapon: below the 3-star minimum`);
  const talent = keyTalent && build.talents[keyTalent];
  if (keyTalent && talent !== undefined && talent < MINIMUM.keyTalentLevel) {
    why.push(`${talentName[keyTalent]} (key talent) level ${talent}: not levelled`);
  }
  return why;
}
