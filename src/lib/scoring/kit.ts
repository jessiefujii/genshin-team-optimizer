// Buffer strength from the game's own numbers (#68): data/kit.json values turned into the damage a
// benchmark carry gains, instead of a tier list. The benchmark is a rough level 90 carry with a typical
// build; it only has to rank buffs against each other, not predict real damage.
import kitJson from "../../../data/kit.json";
import type { Reaction } from "../../types/tags";
import type { ScoringCharacter } from "./types";

export interface KitBuff {
  kind: string;
  value: number;
  max?: number;
  perHp?: number;
  elements?: string[];
  appliesTo?: string[];
  reactions?: string[];
  physical?: boolean;
  unit: string;
  source: string;
  uptime: number | null;
}

interface KitCharacter {
  base: { hp: number; atk: number; def: number } | null;
  buffs: KitBuff[];
  missing?: string;
}

const KIT = kitJson.characters as Record<string, KitCharacter>;

export const BENCHMARK = {
  carryBaseAtk: 950, // character + weapon base ATK
  carryAtk: 2200,
  carryDmgBonus: 0.6, // elemental goblet + set
  carryCritRate: 0.6,
  carryCritDmg: 1.2,
  carryEm: 100,
  enemyRes: 0.1,
  hitDamage: 7000, // one non-crit hit before flat bonuses, to weigh flat damage against
  buffer: { weaponBaseAtk: 500, atk: 2000, hp: 35000, def: 2400, em: 800 }, // buffers without a build
};

// Plunging carries say so in their rotation tags (Xiao "plunge x10", Gaming "E plunge x4").
const plunges = (c: ScoringCharacter) => c.rotation.actions.some((a) => /plunge/i.test(a));

const resMultiplier = (res: number) => (res < 0 ? 1 - res / 2 : res < 0.75 ? 1 - res : 1 / (4 * res + 1));
const emMultiplier = (em: number) => 1 + (2.78 * em) / (em + 1400); // amplifying reactions

// The buffer's own stats: from their build when the player has one, else the benchmark.
function bufferStats(s: ScoringCharacter, base: KitCharacter["base"]) {
  const b = BENCHMARK.buffer;
  return {
    baseAtk: (base?.atk ?? 0) + b.weaponBaseAtk,
    atk: s.stats?.atk ?? b.atk,
    hp: s.stats?.hp ?? b.hp,
    def: s.stats?.def ?? b.def,
    em: s.stats?.elementalMastery ?? b.em,
  };
}

// The fraction of extra damage one buff value gives the benchmark carry, or 0 when it can't help this carry.
function gain(buff: KitBuff, stats: ReturnType<typeof bufferStats>, carry: ScoringCharacter, carryReactions: readonly Reaction[]): number {
  if (buff.elements && !buff.elements.includes(carry.element)) return 0;
  if (buff.appliesTo && !buff.appliesTo.some((t) => (t === "plunge" ? plunges(carry) : carry.keyTalent === t))) return 0;
  if (buff.reactions && !buff.reactions.some((r) => carryReactions.includes(r as Reaction))) return 0;
  if (buff.physical) return 0; // the scorer has no Physical carries tagged as such
  const B = BENCHMARK;
  const cap = (n: number) => (buff.max === undefined ? n : Math.min(n, buff.max));
  const dmg = (bonus: number) => bonus / (1 + B.carryDmgBonus);
  const flat = (n: number) => cap(n) / B.hitDamage;
  const em = (add: number) => emMultiplier(B.carryEm + add) / emMultiplier(B.carryEm) - 1;
  switch (buff.kind) {
    case "atkFromBase":
      return (stats.baseAtk * buff.value) / B.carryAtk;
    case "atkFromAtk":
      return cap(stats.atk * buff.value) / B.carryAtk;
    case "atkPct":
      return (B.carryBaseAtk * buff.value) / B.carryAtk;
    case "atkFlat":
      return buff.value / B.carryAtk;
    case "dmgBonus":
      return dmg(buff.value);
    case "dmgBonusPerEm":
      return dmg(buff.value * stats.em);
    case "reactionBonus":
      return dmg(cap(buff.perHp ? (buff.value * stats.hp) / buff.perHp : buff.value));
    case "resShred":
      return resMultiplier(B.enemyRes - buff.value) / resMultiplier(B.enemyRes) - 1;
    case "defShred": {
      const k = (s: number) => 190 / (190 + 200 * (1 - s)); // level 90 attacker vs level 100 enemy
      return k(buff.value) / k(0) - 1;
    }
    case "critRate": {
      const avg = (cr: number) => 1 + Math.min(cr, 1) * B.carryCritDmg;
      return avg(B.carryCritRate + buff.value) / avg(B.carryCritRate) - 1;
    }
    case "atkSpd":
      return buff.value * 0.5; // more hits, but only the attacks the speed applies to
    case "em":
      return em(buff.value);
    case "emFromAtk":
      return em(stats.atk * buff.value);
    case "emFromDef":
      return em(stats.def * buff.value);
    case "emFromEm":
      return em(stats.em * buff.value);
    case "emFromTopEm":
      return em(Math.min(stats.em * buff.value, 250)); // Nahida's passive caps at 250 EM
    case "flatDmgFromAtk":
      return flat(stats.atk * buff.value);
    case "flatDmgFromDef":
      return flat(stats.def * buff.value);
    case "flatDmgFromEm":
      return flat(stats.em * buff.value);
    case "flatDmg":
      return flat(Math.max(0, (stats.hp - 30000) / 1000) * buff.value); // Sigewinne: per 1,000 HP above 30,000
    case "defFlat":
      return 0; // only matters for DEF carries, which the benchmark isn't
    default:
      throw new Error(`Unknown kit buff kind ${buff.kind}`);
  }
}

export interface KitBuffValue {
  gain: number; // extra damage for the benchmark carry, weighted by uptime (0.2 = +20%)
}

// What a buffer's kit is worth to this carry, or null when kit.json has no value for them (Ifa, Prune).
// Different kinds stack multiplicatively; values of the same kind are alternatives (Lauma's Bloom or
// Lunar-Bloom bonus), so the best one counts.
// The search asks for the same buffer and carry many times, so values are cached per object pair and the
// carry's reactions (objects, not ids: a test or a build can give the same id other stats).
const cache = new WeakMap<ScoringCharacter, WeakMap<ScoringCharacter, Map<string, KitBuffValue | null>>>();

export function kitBuffValue(s: ScoringCharacter, carry: ScoringCharacter, carryReactions: readonly Reaction[]): KitBuffValue | null {
  let byCarry = cache.get(s);
  if (!byCarry) cache.set(s, (byCarry = new WeakMap()));
  let byReactions = byCarry.get(carry);
  if (!byReactions) byCarry.set(carry, (byReactions = new Map()));
  const key = carryReactions.join(",");
  if (byReactions.has(key)) return byReactions.get(key)!;
  const value = computeKitBuffValue(s, carry, carryReactions);
  byReactions.set(key, value);
  return value;
}

function computeKitBuffValue(s: ScoringCharacter, carry: ScoringCharacter, carryReactions: readonly Reaction[]): KitBuffValue | null {
  const entry = KIT[s.id];
  if (!entry || entry.missing || entry.buffs.length === 0) return null;
  const stats = bufferStats(s, entry.base);
  const best = new Map<string, number>();
  for (const b of entry.buffs) {
    const g = gain(b, stats, carry, carryReactions) * (b.uptime ?? 1);
    best.set(b.kind, Math.max(best.get(b.kind) ?? 0, g));
  }
  let total = 1;
  for (const g of best.values()) total *= 1 + g;
  return { gain: total - 1 };
}
