// Buffer strength from the game's own numbers (#68): data/kit.json values turned into the damage a
// benchmark carry gains, instead of a tier list. The benchmark is a rough level 90 carry with a typical
// build; it only has to rank buffs against each other, not predict real damage.
import kitJson from "../../../data/kit.json";
import type { Reaction } from "../../types/tags";
import { BENCHMARK, critGain, defShredGain, dmgBonusGain, emGain, resShredGain } from "./benchmark";
import { canTrigger, reactionShare } from "./reactions";
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


// Whether the carry's rotation has Normal Attacks (KQM "N", e.g. Hu Tao's "N2C x8", Clorinde's "6[N3E]"; not
// Neuvillette's charged attack, Mavuika's "C8F" or Xiao's plunges): Xingqiu's, Yelan's and Beidou's hits need them.
export const normalAttacks = (c: ScoringCharacter) => c.rotation.actions.some((a) => /(^|[\s[])N(\d|\s|$)/.test(a));

// Mavuika's Fighting Spirit per rotation (#116), from data/kit.json `fightingSpirit` (her Burst text and each Nightsoul
// member's points, sources there): her own Skill's points, plus each teammate's Nightsoul points, plus 1.5 per Normal
// Attack hit (at most one per 0.1s) of the carry, up to the 200 limit.
// The Normal Attack hits are the on-field carry's Normal Attack hits x instances in kit.json `carries`: `type:
// "normal"` hits, plus Raiden's Musou Isshin Normal Attacks (Burst DMG, labelled "1-Hit DMG" etc. in her Burst
// table) (Jessie, #126). Kinich's Loop Shots (Skill DMG) don't count. A carry not in `carries` yet counts 0 (#126: it
// gets its count with a damage model, #137). Teammates' own Normal Attacks (Xilonen's N x2) are left out: they're
// off-field. Every rotation is taken as one of Mavuika's Bursts (no rescaling by length).
// A teammate entry can add points when another member has one of `fromTeammates.elements` (Ororon: other members'
// Hydro/Electro hits), up to its `cap` (#126), and when the team can trigger one of `fromReactions.reactions` (Citlali's
// passive 1 after a Melt or Frozen; Jessie, #126).
// Her Burst needs at least 100 (50% of the limit). Below that she can't Burst (KQM's "E only" teams): returns 0, so her
// passive 2 buff and the Burst's own damage drop out, and only her Skill (Flamestrider) damage counts.
interface FightingSpiritKit {
  limit: number;
  burstMin: number;
  perNormalHit: number;
  normalHitEvery: number;
  own: { points: number };
  teammates: Record<
    string,
    { points: number; fromTeammates?: { elements: string[]; points: number }; fromReactions?: { reactions: Reaction[]; points: number }; cap?: number }
  >;
}
const FIGHTING_SPIRIT = (kitJson as unknown as { fightingSpirit: FightingSpiritKit }).fightingSpirit;
export const FIGHTING_SPIRIT_LIMIT = FIGHTING_SPIRIT.limit;

type CarryHits = { rotationSeconds: number; hits: { type: string; label: string; count: number; instances?: number }[] };
const CARRY_HITS = (kitJson as unknown as { carries: Record<string, CarryHits> }).carries;

// Normal Attack hits in one rotation of the carry, at most one per normalHitEvery seconds.
function normalAttackHits(carry: ScoringCharacter): number {
  const kit = CARRY_HITS[carry.id];
  if (!kit) return 0;
  const isNormal = (h: CarryHits["hits"][number]) => h.type === "normal" || (h.type === "burst" && /^\d-Hit DMG$/.test(h.label));
  const hits = kit.hits.filter(isNormal).reduce((a, h) => a + h.count * (h.instances ?? 1), 0);
  return Math.min(hits, kit.rotationSeconds / FIGHTING_SPIRIT.normalHitEvery);
}

// The Fighting Spirit Mavuika (s) bursts with in this team, or 0 when the team can't build the minimum.
export function fightingSpirit(s: ScoringCharacter, carry: ScoringCharacter, team: readonly ScoringCharacter[]): number {
  const total = fightingSpiritBuilt(s, carry, team);
  return total >= FIGHTING_SPIRIT.burstMin ? total : 0;
}

// The Fighting Spirit the team builds for Mavuika (s) in one rotation, before the 100 her Burst needs.
export function fightingSpiritBuilt(s: ScoringCharacter, carry: ScoringCharacter, team: readonly ScoringCharacter[]): number {
  const fs = FIGHTING_SPIRIT;
  const elements = new Set(team.map((m) => m.element));
  const teammatePoints = (m: ScoringCharacter) => {
    const t = fs.teammates[m.id];
    if (!t) return 0;
    const fed = t.fromTeammates && team.some((o) => o !== m && t.fromTeammates!.elements.includes(o.element));
    const reacts = t.fromReactions && t.fromReactions.reactions.some((r) => canTrigger(r, elements));
    return Math.min(t.cap ?? Infinity, t.points + (fed ? t.fromTeammates!.points : 0) + (reacts ? t.fromReactions!.points : 0));
  };
  const points = team.filter((m) => m !== s).reduce((a, m) => a + teammatePoints(m), fs.own.points);
  return Math.min(fs.limit, points + fs.perNormalHit * normalAttackHits(carry));
}
export const FIGHTING_SPIRIT_MIN = FIGHTING_SPIRIT.burstMin;

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

// The buff as it applies to this carry and team (a stepped value read at the team's count), or null when it can't
// help them: wrong element, team makeup, attack type or reaction, or Physical.
function applicable(buff: KitBuff, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): KitBuff | null {
  if (buff.elements && !buff.elements.includes(carry.element)) return null;
  if (buff.teamOnly && !team.elements.every((e) => buff.teamOnly!.includes(e))) return null;
  if (buff.steps) buff = { ...buff, value: stepValue(buff, team) };
  if (buff.appliesTo && !buff.appliesTo.some((t) => (t === "plunge" ? plunges(carry) : carry.keyTalent === t))) return null;
  if (buff.reactions && !buff.reactions.some((r) => carryReactions.includes(r as Reaction))) return null;
  if (buff.physical) return null; // the scorer has no Physical carries tagged as such
  return buff;
}

function gain(raw: KitBuff, stats: ReturnType<typeof bufferStats>, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): number {
  const buff = applicable(raw, carry, carryReactions, team);
  if (!buff) return 0;
  const fs = team.fightingSpirit;
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

// `outsideDamage`: only the buffs a modeled carry's damage doesn't already read through teamBuffStats (#202): EM,
// Reaction Bonus, RES and DEF shred, attack speed, and buffs for some reactions only.
export function kitBuffValue(
  s: ScoringCharacter,
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: readonly ScoringCharacter[],
  outsideDamage = false,
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
  const key = `${outsideDamage}|${carryReactions.join(",")}|${shape.fightingSpirit}|${shape.nightsoulOthers}|${shape.healersOthers}|${[...shape.elements].sort().join(",")}`;
  if (byReactions.has(key)) return byReactions.get(key)!;
  const value = computeKitBuffValue(s, carry, carryReactions, shape, outsideDamage);
  byReactions.set(key, value);
  return value;
}

function computeKitBuffValue(
  s: ScoringCharacter,
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: TeamShape,
  outsideDamage: boolean,
): KitBuffValue | null {
  const entry = KIT[s.id];
  if (!entry || entry.missing || entry.buffs.length === 0) return null;
  const stats = bufferStats(s, entry.base, entry.buildFor);
  const best = new Map<string, number>();
  for (const b of entry.buffs) {
    if (outsideDamage && !b.reactions && IN_CARRY_DAMAGE.has(b.kind)) continue;
    // A buff for some reactions only reaches the share of the carry's damage that is those reactions (#87).
    const share = b.reactions ? reactionShare(carry, b.reactions, carryReactions) : 1;
    const g = gain(b, stats, carry, carryReactions, team) * (b.uptime ?? 1) * share;
    best.set(b.kind, Math.max(best.get(b.kind) ?? 0, g));
  }
  let total = 1;
  for (const g of best.values()) total *= 1 + g;
  return { gain: total - 1 };
}

// The team's kit buffs as stats added to the carry's own (#157), so carry damage can be read with them: flat
// reaction damage (Aggravate, Spread, Clorinde's passive) is then weighed against buffed hits, not bare ones.
// Same buffs, conditions, uptimes and reaction shares as kitBuffValue, and the same best-per-kind choice per buffer.
// Left out, as they don't change how flat damage compares with a hit: RES and DEF shred (they scale every hit
// alike), attack speed. Left out as they'd count twice: EM and Reaction Bonus. Their value is the extra reaction
// damage, which buffer points already score; inside this yardstick they'd raise Aggravate or Vaporize again (Nahida's
// EM took Clorinde's Aggravate line from +170% to +212%). Weapon, set and constellation effects (effects.json)
// aren't in kit.json.
export interface TeamBuffStats {
  atk: number; // flat ATK
  atkPct: number; // of the carry's base ATK
  dmgBonus: number;
  critRate: number;
  flat: number; // flat DMG per hit instance (Additive Base DMG Bonus: Shenhe, Yun Jin)
}

export const NO_TEAM_BUFFS: TeamBuffStats = { atk: 0, atkPct: 0, dmgBonus: 0, critRate: 0, flat: 0 };

// The buff kinds addBuffStats turns into carry stats: inside a modeled carry's damage, so not scored again (#202).
const IN_CARRY_DAMAGE = new Set([
  "atkFromBase", "atkFromAtk", "atkPct", "atkFlat", "dmgBonus", "dmgBonusPerEm", "dmgBonusFromExcessAtk", "critRate",
  "flatDmgFromAtk", "flatDmgFromDef", "flatDmgFromEm", "flatDmg",
]);

function addBuffStats(buff: KitBuff, stats: ReturnType<typeof bufferStats>, team: TeamShape, weight: number, into: TeamBuffStats) {
  const cap = (n: number) => (buff.max === undefined ? n : Math.min(n, buff.max));
  const v = buff.value;
  switch (buff.kind) {
    case "atkFromBase":
      into.atk += stats.baseAtk * v * weight;
      break;
    case "atkFromAtk":
      into.atk += cap(stats.atk * v) * weight;
      break;
    case "atkPct":
      into.atkPct += v * weight;
      break;
    case "atkFlat":
      into.atk += v * weight;
      break;
    case "dmgBonus": {
      const fs = team.fightingSpirit / FIGHTING_SPIRIT_LIMIT;
      const share = buff.condition === "fanfare" ? fanfareShare(buff, team) : buff.condition === "fightingSpirit" ? fs : 1;
      into.dmgBonus += v * share * weight;
      break;
    }
    case "dmgBonusPerEm":
      into.dmgBonus += v * stats.em * weight;
      break;
    case "dmgBonusFromExcessAtk":
      into.dmgBonus += cap(v * Math.max(0, stats.atk - buff.threshold!)) * weight;
      break;
    case "critRate":
      into.critRate += v * weight;
      break;
    case "flatDmgFromAtk":
      into.flat += cap(stats.atk * v) * weight;
      break;
    case "flatDmgFromDef":
      into.flat += cap(stats.def * v) * weight;
      break;
    case "flatDmgFromEm":
      into.flat += cap(stats.em * v) * weight;
      break;
    case "flatDmg":
      into.flat += cap(Math.max(0, (stats.hp - 30000) / 1000) * v) * weight;
      break;
  }
}

// One buffer's part, cached like kitBuffValue (per buffer and carry object, then team shape), not per team: the search
// reads thousands of teams per carry.
const statsCache = new WeakMap<ScoringCharacter, WeakMap<ScoringCharacter, Map<string, TeamBuffStats>>>();
function bufferPart(s: ScoringCharacter, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: readonly ScoringCharacter[]): TeamBuffStats {
  const shape: TeamShape = {
    elements: team.map((m) => m.element),
    fightingSpirit: fightingSpirit(s, carry, team),
    nightsoulOthers: team.filter((m) => m !== s && m.families?.includes("nightsoul")).length,
    healersOthers: team.filter((m) => m !== s && m.roles.includes("healer")).length,
  };
  let byCarry = statsCache.get(s);
  if (!byCarry) statsCache.set(s, (byCarry = new WeakMap()));
  let byKey = byCarry.get(carry);
  if (!byKey) byCarry.set(carry, (byKey = new Map()));
  const key = `${carryReactions.join(",")}|${shape.fightingSpirit}|${shape.nightsoulOthers}|${shape.healersOthers}|${[...shape.elements].sort().join(",")}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const out = { ...NO_TEAM_BUFFS };
  const entry = KIT[s.id];
  const stats = bufferStats(s, entry.base, entry.buildFor);
  // The buff kitBuffValue counts for each kind: the one worth most to this carry.
  const best = new Map<string, { buff: KitBuff; weight: number; g: number }>();
  for (const b of entry.buffs) {
    // A buff for some reactions only (Lauma's flat Bloom-type DMG) adds to that reaction's damage, not the carry's
    // hits: like Reaction Bonus, buffer points score it.
    if (b.reactions) continue;
    const buff = applicable(b, carry, carryReactions, shape);
    if (!buff) continue;
    const weight = b.uptime ?? 1;
    const g = gain(b, stats, carry, carryReactions, shape) * weight;
    if (g > (best.get(b.kind)?.g ?? 0)) best.set(b.kind, { buff, weight, g });
  }
  for (const { buff, weight } of best.values()) addBuffStats(buff, stats, shape, weight, out);
  byKey.set(key, out);
  return out;
}

// Cached per team array object (#215): the scorer asks for the same carry's buffs several times per team, and
// damage.ts caches carry readings by this object, so the same buffs must come back as the same object.
const teamBuffsCache = new WeakMap<readonly ScoringCharacter[], Map<string, TeamBuffStats>>();
export function teamBuffStats(carry: ScoringCharacter, carryReactions: readonly Reaction[], team: readonly ScoringCharacter[]): TeamBuffStats {
  let byKey = teamBuffsCache.get(team);
  if (!byKey) teamBuffsCache.set(team, (byKey = new Map()));
  const key = `${carry.id}#${carryReactions.join("|")}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const out = { ...NO_TEAM_BUFFS };
  byKey.set(key, out);
  for (const s of team) {
    const entry = KIT[s.id];
    if (s === carry || !entry || entry.missing || entry.buffs.length === 0) continue;
    const part = bufferPart(s, carry, carryReactions, team);
    for (const k of Object.keys(out) as (keyof TeamBuffStats)[]) out[k] += part[k];
  }
  return out;
}
