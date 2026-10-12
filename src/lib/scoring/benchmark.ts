// Turns a kit value into the extra damage a benchmark carry gets, and that into points (#63, #68).
// The benchmark is a rough level 90 carry with a typical build; it only has to rank values against
// each other, not predict real damage.
export const BENCHMARK = {
  carryBaseAtk: 950, // character + weapon base ATK
  carryAtk: 2200,
  carryDmgBonus: 0.6, // elemental goblet + set
  carryCritRate: 0.6,
  carryCritDmg: 1.2,
  carryEm: 100,
  enemyRes: 0.1,
  hitDamage: 7000, // one non-crit hit before flat bonuses, to weigh flat damage against
  carryHitsPerSecond: 1.5, // rough; weighs extra hits per Burst cooldown (Nicole's Arcane Projections) against the carry's own
  buffer: { weaponBaseAtk: 500, atk: 2000, hp: 35000, def: 2400, em: 800 }, // buffers without a build
  // Carry stats without a build (#101): the stat they scale on is built up, the others are about character base.
  carry: { hp: 16000, hpBuilt: 35000, def: 900, defBuilt: 2500, emBuilt: 700 },
  subDpsDmgBonus: 0.466, // an elemental DMG goblet, for an off-field sub-DPS without a build (#96)
};

// A sub-DPS's stats without a build (#158): a KQM Standards build (KQMS rev 2.0.2, compendium.keqingmains.com,
// accessed 2026-10-12: level 90 character and weapon, 5-star artifacts at max level, 40 substats: 20 fixed at 2 rolls
// of each type, 20 distributed, at most 2 distributed rolls of a type per piece whose main stat differs). Roll values
// are KQMS's; main stats are the wiki's 5-star max (Artifact/Stats); base CRIT 5% / 50% (wiki CRIT Rate, CRIT DMG).
// Built for the stat their hits scale on, read from their kit (Jessie, #158):
// - ATK / HP / DEF: sands of that stat %, an elemental DMG goblet, a CRIT Rate circlet; the 20 distributed rolls go
//   to CRIT DMG (10, the cap), CRIT Rate (8, the cap without the circlet) and that stat % (2). Estimate: KQMS says
//   "as optimally as possible", and this split favours crit.
// - EM: EM sands, goblet and circlet; EM 800 (Jessie, #158: KQMS gives 678 from artifacts, 3 x 186.5 + 6 rolls, and an
//   EM weapon substat adds the rest; estimate); distributed rolls: EM 4 (the cap: flower and plume), CRIT Rate 8,
//   CRIT DMG 8; no DMG bonus goblet.
// Base ATK adds the benchmark weapon's (BENCHMARK.buffer.weaponBaseAtk, an estimate); weapon substats are left out.
const KQMS = {
  roll: { hp: 253.94, hpPct: 0.0496, atk: 16.54, atkPct: 0.0496, def: 19.68, defPct: 0.062, em: 19.82, critRate: 0.0331, critDmg: 0.0662 },
  main: { hp: 4780, atk: 311, hpPct: 0.466, atkPct: 0.466, defPct: 0.583, em: 186.5, elementalDmg: 0.466, critRate: 0.311 },
  fixed: 2, // rolls of every substat type
};
export type ScaleStat = "atk" | "hp" | "def" | "em";
export interface SubDpsStats {
  atk: number;
  hp: number;
  def: number;
  em: number;
  critRate: number;
  critDmg: number;
  dmgBonus: number;
}
export function subDpsBenchmark(base: { hp: number; atk: number; def: number }, scale: ScaleStat): SubDpsStats {
  const { roll, main, fixed } = KQMS;
  const pct = (stat: "hp" | "atk" | "def", sandsMain: number) => {
    const rolls = fixed + (scale === stat ? 2 : 0);
    return 1 + (scale === stat ? sandsMain : 0) + rolls * roll[`${stat}Pct`];
  };
  const baseAtk = base.atk + BENCHMARK.buffer.weaponBaseAtk;
  const em = scale === "em" ? 800 : fixed * roll.em;
  const critRolls = scale === "em" ? { rate: fixed + 8, dmg: fixed + 8 } : { rate: fixed + 8, dmg: fixed + 10 };
  return {
    atk: baseAtk * pct("atk", main.atkPct) + main.atk + fixed * roll.atk,
    hp: base.hp * pct("hp", main.hpPct) + main.hp + fixed * roll.hp,
    def: base.def * pct("def", main.defPct) + fixed * roll.def,
    em,
    critRate: 0.05 + (scale === "em" ? 0 : main.critRate) + critRolls.rate * roll.critRate,
    critDmg: 0.5 + critRolls.dmg * roll.critDmg,
    dmgBonus: scale === "em" ? 0 : main.elementalDmg,
  };
}

// A value worth this much extra damage scores `points` points.
export const GAIN_FOR_POINTS = 0.2;

const resMultiplier = (res: number) => (res < 0 ? 1 - res / 2 : res < 0.75 ? 1 - res : 1 / (4 * res + 1));
const emMultiplier = (em: number) => 1 + (2.78 * em) / (em + 1400);

export const dmgBonusGain = (bonus: number) => bonus / (1 + BENCHMARK.carryDmgBonus);

export const emGain = (add: number) => emMultiplier(BENCHMARK.carryEm + add) / emMultiplier(BENCHMARK.carryEm) - 1;

// `already` is RES shred the same source applies before this value (Linnea's base 15% Geo shred).
export const resShredGain = (shred: number, already = 0) =>
  resMultiplier(BENCHMARK.enemyRes - already - shred) / resMultiplier(BENCHMARK.enemyRes - already) - 1;

export const defShredGain = (shred: number) => {
  const k = (s: number) => 190 / (190 + 200 * (1 - s)); // level 90 attacker vs level 100 enemy
  return k(shred) / k(0) - 1;
};

export const critGain = (rate: number, dmg = 0) => {
  const avg = (cr: number, cd: number) => 1 + Math.min(cr, 1) * cd;
  const { carryCritRate: cr, carryCritDmg: cd } = BENCHMARK;
  return avg(cr + rate, cd + dmg) / avg(cr, cd) - 1;
};

export const gainPoints = (gain: number, points: number) => Math.round((points * gain) / GAIN_FOR_POINTS);
