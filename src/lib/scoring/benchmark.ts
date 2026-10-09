// Turns a kit value into the extra damage a benchmark carry gets, and that into points (#63, #68).
// The benchmark is a rough level 90 carry with a typical build; it only has to rank values against
// each other, not predict real damage.
export const BENCHMARK = {
  carryDmgBonus: 0.6, // elemental goblet + set
  carryCritRate: 0.6,
  carryCritDmg: 1.2,
  carryEm: 100,
  enemyRes: 0.1,
};

// A value worth this much extra damage scores `points` points.
export const GAIN_FOR_POINTS = 0.2;

const resMultiplier = (res: number) => (res < 0 ? 1 - res / 2 : res < 0.75 ? 1 - res : 1 / (4 * res + 1));
const emMultiplier = (em: number) => 1 + (2.78 * em) / (em + 1400);

export const dmgBonusGain = (bonus: number) => bonus / (1 + BENCHMARK.carryDmgBonus);

export const emGain = (add: number) => emMultiplier(BENCHMARK.carryEm + add) / emMultiplier(BENCHMARK.carryEm) - 1;

// `already` is RES shred the same source applies before this value (Linnea's base 15% Geo shred).
export const resShredGain = (shred: number, already = 0) =>
  resMultiplier(BENCHMARK.enemyRes - already - shred) / resMultiplier(BENCHMARK.enemyRes - already) - 1;

export const critGain = (rate: number, dmg: number) => {
  const avg = (cr: number, cd: number) => 1 + Math.min(cr, 1) * cd;
  const { carryCritRate: cr, carryCritDmg: cd } = BENCHMARK;
  return avg(cr + rate, cd + dmg) / avg(cr, cd) - 1;
};

export const gainPoints = (gain: number, points: number) => Math.round((points * gain) / GAIN_FOR_POINTS);
