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
// Built for the stat they scale on: the first of their hand-tagged scalesOn in tags.json (Jessie, #167, from their
// KQM quick guide), else the stat their hits scale on in kit.json:
// - ATK / HP / DEF: sands of that stat %, an elemental DMG goblet, a CRIT Rate circlet.
// - EM: EM sands, goblet and circlet; EM 800 (Jessie, #158: KQMS gives 678 from artifacts, 3 x 186.5 + 6 rolls, and an
//   EM weapon substat adds the rest; estimate); no DMG bonus goblet.
// The 20 distributed rolls follow their KQM quick guide's stat priority (data/subdps-builds.json, Jessie, #164/#165),
// each stat up to its KQMS cap (2 per piece whose main stat differs); rolls left over, and characters without a
// priority, follow PR #163's split: CRIT DMG, CRIT Rate, then that stat % (10 / 8 / 2 for ATK, HP, DEF scalers).
// ER (#173): when their KQM priority starts with "ER (until requirement)", distributed ER rolls come first, until their
// ER reaches the requirement (their guide-checked erTarget, #21). If 10 ER rolls (2 per piece) can't reach it, an ER
// sands replaces the scale-stat sands (KQM guides recommend ER sands for high-requirement supports like Xiangling and
// Xingqiu; a rule, not each guide's call: flagged for Jessie). Weapon ER substats are left out, as all weapon substats.
// Their level 90 ascension stat is added (Jessie, #166, genshin-db); an elemental DMG ascension stat counts only for
// their own element. Base ATK adds the benchmark weapon's (BENCHMARK.buffer.weaponBaseAtk, an estimate); weapon
// substats are left out.
const KQMS = {
  roll: { hp: 253.94, hpPct: 0.0496, atk: 16.54, atkPct: 0.0496, def: 19.68, defPct: 0.062, em: 19.82, er: 0.0551, critRate: 0.0331, critDmg: 0.0662 },
  main: { hp: 4780, atk: 311, hpPct: 0.466, atkPct: 0.466, defPct: 0.583, em: 186.5, er: 0.518, elementalDmg: 0.466, critRate: 0.311 },
  fixed: 2, // rolls of every substat type
  distributed: 20,
};
export type ScaleStat = "atk" | "hp" | "def" | "em";
export type Substat = keyof typeof KQMS.roll;
export interface SubDpsStats {
  atk: number;
  hp: number;
  def: number;
  em: number;
  critRate: number;
  critDmg: number;
  dmgBonus: number;
  er?: number; // Energy Recharge, 1 = 100% (#173)
}
export interface SubDpsBase {
  hp: number;
  atk: number;
  def: number;
  ascension?: { stat: string; value: number }; // genshin-db substatType at level 90 (#166)
}
export interface SubDpsPriority {
  priority: Substat[][]; // groups in order; a group of several stats is a tie
  hpPctUntil?: number; // Yelan: "HP% (until 30,000 HP)" fills HP% only up to this total HP
}

// genshin-db's % ascension stats (#166).
const PCT_PROP = { hp: "FIGHT_PROP_HP_PERCENT", atk: "FIGHT_PROP_ATTACK_PERCENT", def: "FIGHT_PROP_DEFENSE_PERCENT" };
// genshin-db's elemental DMG ascension stats, by element (#166).
const ELEMENT_DMG_PROP: Record<string, string> = {
  Pyro: "FIGHT_PROP_FIRE_ADD_HURT",
  Hydro: "FIGHT_PROP_WATER_ADD_HURT",
  Electro: "FIGHT_PROP_ELEC_ADD_HURT",
  Cryo: "FIGHT_PROP_ICE_ADD_HURT",
  Anemo: "FIGHT_PROP_WIND_ADD_HURT",
  Geo: "FIGHT_PROP_ROCK_ADD_HURT",
  Dendro: "FIGHT_PROP_GRASS_ADD_HURT",
};

// Places the 20 distributed rolls (#164/#165): `erRolls` ER rolls first (#173), then each priority group in order, one roll at a time across a tie, a stat
// at most 2 per piece whose main stat differs. `hpWith(n)` is the total HP with n distributed HP% rolls, for an
// `hpPctUntil` stop on the first HP% group.
export function distributeRolls(
  scale: ScaleStat,
  order: SubDpsPriority | undefined,
  hpWith?: (hpPctRolls: number) => number,
  erRolls = 0,
  erSands = false,
): Record<Substat, number> {
  const rolls: Record<Substat, number> = { hp: 0, hpPct: 0, atk: 0, atkPct: 0, def: 0, defPct: 0, em: 0, er: 0, critRate: 0, critDmg: 0 };
  // Substat-type main stats: flower HP, plume ATK, then sands and circlet (EM build: sands, goblet and circlet EM).
  const sands: Substat = erSands ? "er" : scale === "em" ? "em" : (`${scale}Pct` as Substat);
  const mains: Substat[] = scale === "em" ? ["hp", "atk", sands, "em", "em"] : ["hp", "atk", sands, "critRate"];
  const cap = (s: Substat) => 2 * (5 - mains.filter((m) => m === s).length);
  let left = KQMS.distributed;
  const fill = (group: Substat[], stopHpAt?: number) => {
    const open = (s: Substat) => rolls[s] < cap(s) && !(s === "hpPct" && stopHpAt && hpWith && hpWith(rolls.hpPct) >= stopHpAt);
    while (left > 0 && group.some(open)) {
      for (const s of group) {
        if (left > 0 && open(s)) {
          rolls[s]++;
          left--;
        }
      }
    }
  };
  rolls.er = Math.min(erRolls, cap("er"), left);
  left -= rolls.er;
  const firstHp = order?.priority.findIndex((g) => g.includes("hpPct")) ?? -1;
  order?.priority.forEach((group, i) => fill(group, i === firstHp ? order.hpPctUntil : undefined));
  for (const s of ["critDmg", "critRate", ...(scale === "em" ? [] : [`${scale}Pct` as Substat])] as Substat[]) fill([s]);
  return rolls;
}

// `erUntil`: the ER requirement (1.8 = 180%) when their KQM priority puts ER first (#173).
export function subDpsBenchmark(base: SubDpsBase, scale: ScaleStat, order?: SubDpsPriority, element?: string, erUntil?: number): SubDpsStats {
  const { roll, main, fixed } = KQMS;
  const asc = base.ascension;
  const ascOf = (prop: string) => (asc?.stat === prop ? asc.value : 0);
  // ER before distributed rolls: base 100%, the 2 fixed rolls, their ascension stat (Venti, Kaeya, Alyosha).
  const erBase = 1 + fixed * roll.er + ascOf("FIGHT_PROP_CHARGE_EFFICIENCY");
  const rollsFor = (need: number) => Math.max(0, Math.ceil((need - erBase) / roll.er - 1e-9));
  const erSands = erUntil !== undefined && rollsFor(erUntil) > 10;
  const erRolls = erUntil === undefined ? 0 : erSands ? rollsFor(erUntil - main.er) : rollsFor(erUntil);
  const sandsOf = (stat: ScaleStat) => !erSands && scale === stat;
  const pctOf = (stat: "hp" | "atk" | "def", rolls: number) =>
    1 + (sandsOf(stat) ? main[`${stat}Pct`] : 0) + (fixed + rolls) * roll[`${stat}Pct`] + ascOf(PCT_PROP[stat]);
  const hpWith = (hpPctRolls: number) => base.hp * pctOf("hp", hpPctRolls) + main.hp + fixed * roll.hp;
  const r = distributeRolls(scale, order, hpWith, erRolls, erSands);
  const baseAtk = base.atk + BENCHMARK.buffer.weaponBaseAtk;
  // EM build: 800 EM (#158); with an ER sands, one EM main stat less.
  const em = (scale === "em" ? 800 - (erSands ? main.em : 0) : (fixed + r.em) * roll.em) + ascOf("FIGHT_PROP_ELEMENT_MASTERY");
  return {
    atk: baseAtk * pctOf("atk", r.atkPct) + main.atk + (fixed + r.atk) * roll.atk,
    hp: base.hp * pctOf("hp", r.hpPct) + main.hp + (fixed + r.hp) * roll.hp,
    def: base.def * pctOf("def", r.defPct) + (fixed + r.def) * roll.def,
    em,
    critRate: 0.05 + (scale === "em" ? 0 : main.critRate) + (fixed + r.critRate) * roll.critRate + ascOf("FIGHT_PROP_CRITICAL"),
    critDmg: 0.5 + (fixed + r.critDmg) * roll.critDmg + ascOf("FIGHT_PROP_CRITICAL_HURT"),
    dmgBonus: (scale === "em" ? 0 : main.elementalDmg) + (element ? ascOf(ELEMENT_DMG_PROP[element]) : 0),
    er: erBase + r.er * roll.er + (erSands ? main.er : 0),
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
