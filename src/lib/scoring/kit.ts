// Buffer strength from the game's own numbers (#68): data/kit.json values turned into the damage a
// benchmark carry gains, instead of a tier list. The benchmark is a rough level 90 carry with a typical
// build; it only has to rank buffs against each other, not predict real damage.
import kitJson from "../../../data/kit.json";
import type { Reaction } from "../../types/tags";
import { BENCHMARK, critGain, defShredGain, dmgBonusGain, emGain, resShredGain } from "./benchmark";
import { reactionShare } from "./reactions";
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
  condition?: "fightingSpirit" | "rescueEssentials" | "fanfare";
  maxFanfare?: number; // fanfare: Furina's Fanfare cap
  drainFloor?: number; // fanfare: her Salon Members only drain characters above this share of HP
  points?: { max: number; own: number }; // rescueEssentials: the cap, and Ifa's own Nightsoul points from his Skill
  threshold?: number; // dmgBonusFromExcessAtk: ATK above this counts
  steps?: { count: "members" | "elementTypes"; of?: string[]; values: number[] };
  teamOnly?: string[];
  unit: string;
  source: string;
  uptime: number | null;
}

interface KitCharacter {
  base: { hp: number; atk: number; def: number } | null;
  buildFor?: { atk?: number }; // stats to assume without a build, for a buffer built for their buff (Prune)
  buffs: KitBuff[];
  missing?: string;
}

const KIT = kitJson.characters as Record<string, KitCharacter>;


// Mavuika's Fighting Spirit per rotation (#116), from data/kit.json `fightingSpirit` (her Burst text and each Nightsoul
// member's points, sources there): her own Skill's points, plus each teammate's Nightsoul points, plus 1.5 per Normal
// Attack hit (at most one per 0.1s) of the carry, up to the 200 limit.
// The Normal Attack hits are the carry's `type: "normal"` hits x instances in kit.json `carries`, so Raiden's Musou
// Isshin (Burst DMG) and Kinich's Loop Shots (Skill DMG) don't count. A carry not in `carries` yet counts 0 (not the
// old "200 for a Normal Attack rotation"): it only undercounts until that carry gets an entry. Teammates' own Normal
// Attacks (Xilonen's N x2) are left out, and every rotation is taken as one of Mavuika's Bursts (no rescaling by length).
// Her Burst needs at least 100 (50% of the limit). Below that she can't Burst (KQM's "E only" teams): returns 0, so her
// passive 2 buff and the Burst's own damage drop out, and only her Skill (Flamestrider) damage counts.
interface FightingSpiritKit {
  limit: number;
  burstMin: number;
  perNormalHit: number;
  normalHitEvery: number;
  own: { points: number };
  teammates: Record<string, { points: number }>;
}
const FIGHTING_SPIRIT = (kitJson as unknown as { fightingSpirit: FightingSpiritKit }).fightingSpirit;
export const FIGHTING_SPIRIT_LIMIT = FIGHTING_SPIRIT.limit;

type CarryHits = { rotationSeconds: number; hits: { type: string; count: number; instances?: number }[] };
const CARRY_HITS = (kitJson as unknown as { carries: Record<string, CarryHits> }).carries;

// Normal Attack hits in one rotation of the carry, at most one per normalHitEvery seconds.
function normalAttackHits(carry: ScoringCharacter): number {
  const kit = CARRY_HITS[carry.id];
  if (!kit) return 0;
  const hits = kit.hits.filter((h) => h.type === "normal").reduce((a, h) => a + h.count * (h.instances ?? 1), 0);
  return Math.min(hits, kit.rotationSeconds / FIGHTING_SPIRIT.normalHitEvery);
}

// The Fighting Spirit Mavuika (s) bursts with in this team, or 0 when the team can't build the minimum.
export function fightingSpirit(s: ScoringCharacter, carry: ScoringCharacter, team: readonly ScoringCharacter[]): number {
  const fs = FIGHTING_SPIRIT;
  const points = team.filter((m) => m !== s).reduce((a, m) => a + (fs.teammates[m.id]?.points ?? 0), fs.own.points);
  const total = Math.min(fs.limit, points + fs.perNormalHit * normalAttackHits(carry));
  return total >= fs.burstMin ? total : 0;
}

// Plunging carries say so in their rotation tags (Xiao "plunge x10", Gaming "E plunge x4", KQM "P" as in Varesa's "ECP").
const plunges = (c: ScoringCharacter) => c.rotation.actions.some((a) => /plunge/i.test(a) || /(^|\s)[A-Z]*P(\s|$)/.test(a));

// Base ATK (character + weapon), which ATK % buffs are a percent of (#80): the build's when it has one, else
// the character's level 90 base plus a benchmark weapon (or the benchmark carry's, for a carry not in kit.json).
export function baseAtkOf(m: ScoringCharacter): number {
  if (m.stats?.baseAtk) return m.stats.baseAtk;
  const base = KIT[m.id]?.base;
  return base ? base.atk + BENCHMARK.buffer.weaponBaseAtk : BENCHMARK.carryBaseAtk;
}

// What +pct ATK % is worth to the carry: a percent of their base ATK, against their total ATK.
export function atkPctGain(carry: ScoringCharacter, pct: number): number {
  const atk = carry.stats?.atk ?? BENCHMARK.carryAtk;
  return ((carry.stats?.baseAtk ?? BENCHMARK.carryBaseAtk) * pct) / atk;
}

// The buffer's own stats: from their build when the player has one, else the benchmark.
function bufferStats(s: ScoringCharacter, base: KitCharacter["base"], buildFor: KitCharacter["buildFor"]) {
  const b = BENCHMARK.buffer;
  return {
    baseAtk: s.stats?.baseAtk ?? (base?.atk ?? 0) + b.weaponBaseAtk,
    atk: s.stats?.atk ?? buildFor?.atk ?? b.atk,
    hp: s.stats?.hp ?? b.hp,
    def: s.stats?.def ?? b.def,
    em: s.stats?.elementalMastery ?? b.em,
  };
}

// The fraction of extra damage one buff value gives the benchmark carry, or 0 when it can't help this carry.
// What the team looks like, for values that depend on it (Escoffier, Lynette, Chevreuse, Mavuika).
interface TeamShape {
  elements: string[]; // one per member
  fightingSpirit: number;
  nightsoulOthers: number; // Nightsoul members other than the buffer
  healersOthers: number; // healers other than the buffer
}

// Ifa's Rescue Essentials: one point per Nightsoul point the party holds, up to the max. His Skill gives him
// `own` points that drain while he hovers, so half count; other Nightsoul members are assumed to hold about
// 40 each (their pools vary by kit).
const rescueEssentials = (p: { max: number; own: number }, team: TeamShape) => Math.min(p.max, p.own / 2 + 40 * team.nightsoulOthers);

// Furina's Fanfare (#90): 1 point per 1% of Max HP any party member gains or loses during her Burst, cleared when
// it ends. Her Salon Members drain HP only down to drainFloor, so without another healer each member gives at most
// (1 - floor) x 100 points; with one, healing adds the rest, up to the max. It builds up during the Burst: assumed
// to reach that ceiling halfway through (genshin-db has no Salon attack intervals), so it averages 3/4 of it.
const FANFARE_RAMP = 0.5;
function fanfareShare(buff: KitBuff, team: TeamShape): number {
  const fromDrain = ((1 - buff.drainFloor!) * 100 * team.elements.length) / buff.maxFanfare!;
  const ceiling = team.healersOthers > 0 ? 1 : Math.min(1, fromDrain);
  return ceiling * (1 - FANFARE_RAMP / 2);
}

// A stepped value at this team's count (Escoffier: 1-4 Hydro/Cryo members; Lynette: 1-4 element types).
function stepValue(buff: KitBuff, team: TeamShape): number {
  const steps = buff.steps!;
  const n = steps.count === "elementTypes" ? new Set(team.elements).size : team.elements.filter((e) => steps.of!.includes(e)).length;
  return n === 0 ? 0 : steps.values[Math.min(n, steps.values.length) - 1];
}

function gain(buff: KitBuff, stats: ReturnType<typeof bufferStats>, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): number {
  if (buff.elements && !buff.elements.includes(carry.element)) return 0;
  if (buff.teamOnly && !team.elements.every((e) => buff.teamOnly!.includes(e))) return 0;
  if (buff.steps) buff = { ...buff, value: stepValue(buff, team) };
  const fs = team.fightingSpirit;
  if (buff.appliesTo && !buff.appliesTo.some((t) => (t === "plunge" ? plunges(carry) : carry.keyTalent === t))) return 0;
  if (buff.reactions && !buff.reactions.some((r) => carryReactions.includes(r as Reaction))) return 0;
  if (buff.physical) return 0; // the scorer has no Physical carries tagged as such
  const B = BENCHMARK;
  const cap = (n: number) => (buff.max === undefined ? n : Math.min(n, buff.max));
  const dmg = dmgBonusGain;
  const flat = (n: number) => cap(n) / B.hitDamage;
  const em = emGain;
  switch (buff.kind) {
    case "atkFromBase":
      return (stats.baseAtk * buff.value) / B.carryAtk;
    case "atkFromAtk":
      return cap(stats.atk * buff.value) / B.carryAtk;
    case "atkPct":
      return atkPctGain(carry, buff.value);
    case "atkFlat":
      return buff.value / B.carryAtk;
    case "dmgBonus":
      if (buff.condition === "fanfare") return dmg(buff.value * fanfareShare(buff, team));
      return dmg(buff.condition === "fightingSpirit" ? (buff.value * fs) / FIGHTING_SPIRIT_LIMIT : buff.value);
    case "dmgBonusPerEm":
      return dmg(buff.value * stats.em);
    case "reactionBonus":
      if (buff.condition === "rescueEssentials") return dmg(buff.value * rescueEssentials(buff.points!, team));
      return dmg(cap(buff.perHp ? (buff.value * stats.hp) / buff.perHp : buff.value));
    case "dmgBonusFromExcessAtk":
      return dmg(cap(buff.value * Math.max(0, stats.atk - buff.threshold!)));
    case "resShred":
      return resShredGain(buff.value);
    case "defShred":
      return defShredGain(buff.value);
    case "critRate":
      return critGain(buff.value);
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

export function kitBuffValue(
  s: ScoringCharacter,
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: readonly ScoringCharacter[],
): KitBuffValue | null {
  let byCarry = cache.get(s);
  if (!byCarry) cache.set(s, (byCarry = new WeakMap()));
  let byReactions = byCarry.get(carry);
  if (!byReactions) byCarry.set(carry, (byReactions = new Map()));
  const shape: TeamShape = {
    elements: team.map((m) => m.element),
    fightingSpirit: fightingSpirit(s, carry, team),
    nightsoulOthers: team.filter((m) => m !== s && m.families?.includes("nightsoul")).length,
    healersOthers: team.filter((m) => m !== s && m.roles.includes("healer")).length,
  };
  const key = `${carryReactions.join(",")}|${shape.fightingSpirit}|${shape.nightsoulOthers}|${shape.healersOthers}|${[...shape.elements].sort().join(",")}`;
  if (byReactions.has(key)) return byReactions.get(key)!;
  const value = computeKitBuffValue(s, carry, carryReactions, shape);
  byReactions.set(key, value);
  return value;
}

function computeKitBuffValue(s: ScoringCharacter, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): KitBuffValue | null {
  const entry = KIT[s.id];
  if (!entry || entry.missing || entry.buffs.length === 0) return null;
  const stats = bufferStats(s, entry.base, entry.buildFor);
  const best = new Map<string, number>();
  for (const b of entry.buffs) {
    // A buff for some reactions only reaches the share of the carry's damage that is those reactions (#87).
    const share = b.reactions ? reactionShare(carry, b.reactions, carryReactions) : 1;
    const g = gain(b, stats, carry, carryReactions, team) * (b.uptime ?? 1) * share;
    best.set(b.kind, Math.max(best.get(b.kind) ?? 0, g));
  }
  let total = 1;
  for (const g of best.values()) total *= 1 + g;
  return { gain: total - 1 };
}
