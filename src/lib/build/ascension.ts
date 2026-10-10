// Ascension (#82): at these levels a character or weapon can be before ascending ("80/80") or after
// ("80/90"), and base stats differ. The game's ascension phase counts the caps passed: 0 at level 1-20,
// 6 at level 90. Plain data, so the build editor can use it in the browser.
export const ASCENSION_LEVELS = [20, 40, 50, 60, 70, 80] as const;
const CAPS = [...ASCENSION_LEVELS, 90];

export const isAscensionLevel = (level: number) => (ASCENSION_LEVELS as readonly number[]).includes(level);

// The phase for a level; `ascended` only matters at an ascension level.
export function ascensionOf(level: number, ascended: boolean): number {
  const passed = ASCENSION_LEVELS.filter((cap) => cap < level).length;
  return passed + (isAscensionLevel(level) && ascended ? 1 : 0);
}

// The level cap at a phase, as the game shows it after the slash: 80/90 is phase 6.
export const levelCap = (ascension: number) => CAPS[Math.min(ascension, CAPS.length - 1)];
