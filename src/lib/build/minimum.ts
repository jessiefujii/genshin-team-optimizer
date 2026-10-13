import type { CharacterBuild } from "../../types/build";

// Minimum requirements for the team search (#133, Jessie): a build that misses one sits out of the search, like an
// unticked Built box, but still shows under Worth building. Large rosters (80+ characters, ~1.6 million teams) stay
// fast this way. Without a build there's nothing to check: the Built box decides alone.
// `artifactSets` only lists active set bonuses, so 4 artifacts from 4 different sets also read as "no artifact set".
export function belowMinimum(build: CharacterBuild | undefined, weaponRarity: Record<string, number>): string[] {
  if (!build) return [];
  const why: string[] = [];
  if (build.artifactSets.length === 0) why.push("no artifact set");
  if (build.level <= 1) why.push("level 1");
  if (build.weapon.level <= 1) why.push("weapon level 1");
  const rarity = weaponRarity[build.weapon.id];
  if (rarity !== undefined && rarity < 3) why.push(`${rarity}-star weapon`);
  return why;
}
