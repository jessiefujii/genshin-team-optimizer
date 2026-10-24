// Buffer strength from the game's own numbers (#68): data/kit.json values turned into the damage a
// benchmark carry gains, instead of a tier list. The benchmark is a rough level 90 carry with a typical
// build; it only has to rank buffs against each other, not predict real damage.
import kitJson from "../../../data/kit.json";
import type { Element, Reaction } from "../../types/tags";
import { BENCHMARK, critGain, defShredGain, dmgBonusGain, emGain, resShredGain } from "./benchmark";
import { canTrigger, reactionElements, reactionShare, TRANSFORMATIVE } from "./reactions";
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
  threshold?: number; // dmgBonusFromExcessAtk: ATK above this counts; a perHp reactionBonus: HP above this (Nilou)
  whileOnField?: boolean; // only while this member is the on-field carry (Kaveh's Painted Dome, #256)
  perEm?: number; // a reactionBonus per this many points of the buffer's EM (Mizuki, #235)
  burst?: boolean; // comes from the Burst (or a passive it triggers): up only in the rotations its Energy funds (#207)
  steps?: { count: "members" | "elementTypes"; of?: string[]; values: number[] };
  teamOnly?: string[];
  carryReactions?: string[]; // the carry triggers one of these (Albedo's Burst EM, only where he Bursts: #186)
  lunar?: string; // lunarAdditiveFromEm: the direct Lunar reaction hits it adds to (Illuga's Lunar-Crystallize, #186)
  stacks?: number; // used one per hit of the carry's, this many per use (Illuga's Nightingale's Song, #186)
  cd?: number | null;
  unit: string;
  source: string;
  uptime: number | null;
}

interface KitCharacter {
  base: { hp: number; atk: number; def: number } | null;
  // stats to assume without a build, for a buffer built for their buff (Prune); em "built": the EM-built carry
  // benchmark's (Mizuki, #235)
  buildFor?: { atk?: number; em?: number | "built" };
  buffs: KitBuff[];
  missing?: string;
}

const KIT = kitJson.characters as Record<string, KitCharacter>;

// A character without a build reads as wearing their KQM guide's 4pc set (#279, #206; supports' party sets #338,
// extract-kit benchmarkSets): the first option that fits the team (the reaction it triggers, or one of `members` in
// it). A build's own sets always count.
type BenchmarkSet = { set: string; when?: { reaction?: Reaction; members?: string[] } };
const BENCHMARK_SETS = (kitJson as unknown as { benchmarkSets: Record<string, BenchmarkSet[]> }).benchmarkSets;
export function setsOf(c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[] = [c]): NonNullable<ScoringCharacter["sets"]> {
  if (c.stats || c.sets) return c.sets ?? [];
  const b = BENCHMARK_SETS[c.id]?.find(
    ({ when: w }) => (!w?.reaction || active.includes(w.reaction)) && (!w?.members || team.some((m) => w.members!.includes(m.id))),
  );
  return b ? [{ set: b.set, pieces: 4 }] : [];
}

// Party-wide set effects (#306, extract-kit SETS `party`): Silken Moon's Serenade's EM to all party members, and the
// Gleaming Moon sets' Lunar Reaction DMG, 10% per different Gleaming Moon effect in the party (Night's Intent, Silken's
// Devotion; a second wearer of the same set adds nothing: "Effects from Gleaming Moon cannot stack"). On every member's
// hits: the carry's (damage.ts), the sub-DPS's and the reactions' (score.ts), the buffers' EM-based buffs (bufferStats).
// `when`: moonsign (the party's level: Nascent Gleam with one Moonsign member, Ascendant with two or more; `gleam`),
// onField (the wearer is the on-field carry: Night's "if the equipping character is on the field"), lunar (the team
// triggers a Lunar reaction: Night's "when nearby party members trigger Lunar Reactions"). The Lunar bonus is Reaction
// Bonus (Genshin Impact Wiki, Damage § Reaction DMG Bonus, fetched 2026-10-21, lists both sets).
// wearerReacts (Instructor: the wearer triggers one of the team's reactions, #345). `reactionBonus` with Stellar
// reactions: Heart of the Furnace's party Stellar Glimmer reaction DMG (#345), one wearer per set.
type PartySetEffect = {
  kind: "em" | "gleamingMoon" | "reactionBonus";
  party: true;
  value: number;
  effect?: string;
  reactions?: string[];
  when?: { moonsign?: "nascent" | "ascendant"; onField?: boolean; lunar?: boolean; wearerReacts?: boolean };
};
const PARTY_SET_KINDS = new Set(["em", "gleamingMoon", "reactionBonus"]);
const PARTY_SETS = Object.fromEntries(
  Object.entries((kitJson as unknown as { sets: Record<string, { party?: boolean }[]> }).sets)
    .map(([name, effects]) => [name, effects.filter((e) => e.party && PARTY_SET_KINDS.has((e as PartySetEffect).kind)) as PartySetEffect[]])
    .filter(([, effects]) => effects.length > 0),
) as Record<string, PartySetEffect[]>;
// Whether a set has party-wide effects in damage (#306): score.ts then drops its effects.json flat points.
export const partySetModeled = (set: string) => set in PARTY_SETS;
export function partySetBuffs(
  team: readonly ScoringCharacter[],
  active: readonly Reaction[] = [],
  onField: ScoringCharacter | null = null,
  gleam = team.filter((m) => m.families?.includes("moonsign")).length >= 2,
): { em: number; lunar: number; stellar: number } {
  const moonsign = team.some((m) => m.families?.includes("moonsign"));
  const lunar = active.some((r) => r.startsWith("lunar-"));
  let em = 0;
  let stellar = 0;
  const effects = new Map<string, number>(); // Gleaming Moon effect -> its value
  const seen = new Set<string>(); // one wearer's EM per set: the same effect doesn't stack (estimate for EM)
  for (const m of team) {
    for (const { set, pieces } of setsOf(m, active, team)) {
      if (pieces < 4) continue;
      for (const b of PARTY_SETS[set] ?? []) {
        const w = b.when ?? {};
        if (w.moonsign && (!moonsign || (w.moonsign === "ascendant") !== gleam)) continue;
        if (w.onField && m !== onField) continue;
        if (w.lunar && !lunar) continue;
        if (w.wearerReacts && !m.reactions.some((r) => active.includes(r))) continue;
        if (b.kind === "gleamingMoon") effects.set(b.effect!, b.value);
        else if (b.kind === "reactionBonus") {
          if (!seen.has(set)) stellar += b.value;
          seen.add(set);
        }
        else if (!seen.has(`${set}|${w.moonsign}`)) {
          seen.add(`${set}|${w.moonsign}`);
          em += b.value;
        }
      }
    }
  }
  return { em, lunar: [...effects.values()].reduce((a, v) => a + v, 0), stellar };
}


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

// The buffer's own stats: from their build when the player has one, else the benchmark. `partyEm`: party-wide set EM
// (Silken Moon's Serenade, #306), on no one's character screen: Illuga's EM-based buffs grow with it.
// A buffer's own set DEF% (Husk's stacks, #346), of base DEF: on DEF-based buffs (Linnea's EM, Zhongli's shield). Sets
// with a team condition don't give DEF, so the wearer alone picks them.
const SET_DEF_PCT = Object.fromEntries(
  Object.entries((kitJson as unknown as { sets: Record<string, { kind: string; value: number; pieces?: number }[]> }).sets).map(([id, effects]) => [
    id,
    effects.filter((e) => e.kind === "defPct" && !e.pieces).reduce((a, e) => a + e.value, 0),
  ]),
);
const setDefPct = (s: ScoringCharacter) => setsOf(s, []).reduce((a, { set, pieces }) => a + (pieces >= 4 ? (SET_DEF_PCT[set] ?? 0) : 0), 0);
function bufferStats(s: ScoringCharacter, base: KitCharacter["base"], buildFor: KitCharacter["buildFor"], partyEm = 0) {
  const b = BENCHMARK.buffer;
  return {
    baseAtk: s.stats?.baseAtk ?? (base?.atk ?? 0) + b.weaponBaseAtk,
    atk: s.stats?.atk ?? buildFor?.atk ?? b.atk,
    hp: s.stats?.hp ?? b.hp,
    def: (s.stats?.def ?? b.def) + setDefPct(s) * (base?.def ?? 0),
    em: (s.stats?.elementalMastery ?? (buildFor?.em === "built" ? BENCHMARK.carry.emBuilt : buildFor?.em) ?? b.em) + partyEm,
  };
}

// The fraction of extra damage one buff value gives the benchmark carry, or 0 when it can't help this carry.
// What the team looks like, for values that depend on it (Escoffier, Lynette, Chevreuse, Mavuika).
interface TeamShape {
  elements: string[]; // one per member
  fightingSpirit: number;
  nightsoulOthers: number; // Nightsoul members other than the buffer
  moonsign: number; // Moonsign members: two make Ascendant Gleam, which adds carry hits (stackShare, #186)
  partyEm: number; // party-wide set EM (partySetBuffs, #306)
  healersOthers: number; // healers other than the buffer
}

// Ifa's Rescue Essentials: one point per Nightsoul point the party holds, up to the max. His Skill gives him
// `own` points that drain while he hovers, so half count; other Nightsoul members are assumed to hold about
// 40 each (their pools vary by kit).
const rescueEssentials = (p: { max: number; own: number }, team: TeamShape) => Math.min(p.max, p.own / 2 + 40 * team.nightsoulOthers);

// A reactionBonus's value: flat, or per `perHp` of the member's Max HP above `threshold` (Baizhu; Nilou above 30,000),
// capped at `max`. Ifa's Rescue Essentials scaling is applied by the caller.
function reactionBonusValue(buff: KitBuff, stats: ReturnType<typeof bufferStats>): number {
  const v = buff.perHp
    ? (buff.value * Math.max(0, stats.hp - (buff.threshold ?? 0))) / buff.perHp
    : buff.perEm
      ? (buff.value * stats.em) / buff.perEm
      : buff.value;
  return buff.max === undefined ? v : Math.min(v, buff.max);
}

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

// A modeled carry's hits per rotation (kit.json carries, default combo): the hits of their own element that land in this
// team (a `when` met: the reaction active, Ascendant Gleam at two Moonsign members), and of those the direct Lunar hits.
// Zibai's Passive 1 bonus is part of a Stride hit, not a hit of its own. Other `when` conditions are taken as met.
type CarryKitHit = { count: number; instances?: number; element?: string; lunar?: string; additive?: boolean; when?: { reaction?: string; ascendantGleam?: boolean } };
const CARRY_KITS = (kitJson as unknown as { carries: Record<string, { rotationSeconds: number; hits: CarryKitHit[] }> }).carries;
function carryHitCounts(carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape) {
  const kit = CARRY_KITS[carry.id];
  if (!kit) return null;
  const lands = (h: CarryKitHit) =>
    !h.additive && (h.element ?? carry.element) === carry.element &&
    (!h.when || ((!h.when.reaction || carryReactions.includes(h.when.reaction as Reaction)) && (!h.when.ascendantGleam || team.moonsign >= 2)));
  let all = 0;
  const lunar = new Map<string, number>();
  for (const h of kit.hits.filter(lands)) {
    all += h.count * (h.instances ?? 1);
    if (h.lunar) lunar.set(h.lunar, (lunar.get(h.lunar) ?? 0) + h.count * (h.instances ?? 1));
  }
  return { all, lunar, rotationSeconds: kit.rotationSeconds };
}

// A buff with stacks (Illuga's Nightingale's Song, #186: "Illuga gains 21 stacks", one "consumed" per Geo hit of the
// active character; Genshin Impact Wiki, Shadowless Reflection, fetched 2026-10-20) reaches only that many of the
// carry's hits: the share of their hits per rotation the stacks cover, one use per CD. Which hits get them isn't
// modeled: an even share (estimate). A carry without a damage model: 1.
function stackShare(buff: KitBuff, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): number {
  if (!buff.stacks) return 1;
  const hits = carryHitCounts(carry, carryReactions, team);
  if (!hits || hits.all === 0) return 1;
  const uses = buff.cd ? hits.rotationSeconds / Math.max(buff.cd, hits.rotationSeconds) : 1;
  return Math.min(1, (buff.stacks * uses) / hits.all);
}

// The buff as it applies to this carry and team (a stepped value read at the team's count), or null when it can't
// help them: wrong element, team makeup, attack type or reaction, or Physical.
function applicable(buff: KitBuff, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: TeamShape): KitBuff | null {
  if (buff.elements && !buff.elements.includes(carry.element)) return null;
  if (buff.teamOnly && !team.elements.every((e) => buff.teamOnly!.includes(e))) return null;
  if (buff.carryReactions && !buff.carryReactions.some((r) => carryReactions.includes(r as Reaction))) return null;
  if (buff.steps) buff = { ...buff, value: stepValue(buff, team) };
  if (buff.appliesTo && !buff.appliesTo.some((t) => (t === "plunge" ? plunges(carry) : carry.keyTalent === t))) return null;
  if (buff.reactions && !buff.reactions.some((r) => carryReactions.includes(r as Reaction))) return null;
  if (buff.physical) return null; // Physical hits are in damage (#222); Physical buffs from weapons and sets wait for #206
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
      return dmg(reactionBonusValue(buff, stats));
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
    case "lunarAdditiveFromEm": {
      // Only on a carry's direct Lunar hits of that reaction (Zibai's), as a share of their hits.
      const hits = carryHitCounts(carry, carryReactions, team);
      const share = hits && hits.all ? (hits.lunar.get(buff.lunar!) ?? 0) / hits.all : 0;
      return flat(stats.em * buff.value) * share;
    }
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
// `burst`: the share of rotations the buffer's Burst is funded in this team (#207, energy.ts); their `burst` buffs
// count that share of the time, like the Burst's own damage.
export function kitBuffValue(
  s: ScoringCharacter,
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: readonly ScoringCharacter[],
  // true: leave out what is already in damage (the carry's modeled damage, and reaction damage); "reactions": only the
  // bonuses to reactions that deal their own damage, which transformativeLines adds there for any carry (#256).
  outsideDamage: boolean | "reactions" = false,
  burst = 1,
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
    moonsign: team.filter((m) => m.families?.includes("moonsign")).length,
    partyEm: partySetBuffs(team).em,
  };
  const key = `${outsideDamage}|${burst}|${carryReactions.join(",")}|${shape.fightingSpirit}|${shape.nightsoulOthers}|${shape.healersOthers}|${shape.moonsign}|${shape.partyEm}|${[...shape.elements].sort().join(",")}`;
  if (byReactions.has(key)) return byReactions.get(key)!;
  const value = computeKitBuffValue(s, carry, carryReactions, shape, outsideDamage, burst);
  byReactions.set(key, value);
  return value;
}

function computeKitBuffValue(
  s: ScoringCharacter,
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: TeamShape,
  outsideDamage: boolean | "reactions",
  burst: number,
): KitBuffValue | null {
  const entry = KIT[s.id];
  if (!entry || entry.missing || entry.buffs.length === 0) return null;
  const stats = bufferStats(s, entry.base, entry.buildFor, team.partyEm);
  const best = new Map<string, number>();
  for (const b of entry.buffs) {
    if (outsideDamage === true && !b.reactions && IN_CARRY_DAMAGE.has(b.kind)) continue;
    if (offFieldOnly(s, b)) continue; // not the carry's (Sigewinne's Convalescence, #204)
    if (outsideDamage && b.reactions?.every((r) => TRANSFORMATIVE[r as Reaction])) continue;
    // A buff for some reactions only reaches the share of the carry's damage that is those reactions (#87).
    const share = b.reactions ? reactionShare(carry, b.reactions, carryReactions) : 1;
    const g = gain(b, stats, carry, carryReactions, team) * (b.uptime ?? 1) * share * (b.burst ? burst : 1) * stackShare(b, carry, carryReactions, team);
    best.set(b.kind, Math.max(best.get(b.kind) ?? 0, g));
  }
  let total = 1;
  for (const g of best.values()) total *= 1 + g;
  return { gain: total - 1 };
}

// The team's kit buffs as stats added to the carry's own (#157), so carry damage can be read with them: flat
// reaction damage (Aggravate, Spread, Clorinde's passive) is then weighed against buffed hits, not bare ones.
// Same buffs, conditions, uptimes and reaction shares as kitBuffValue, and the same best-per-kind choice per buffer.
// RES and DEF shred are in it too (#204): they scale the hits they reach. Left out: attack speed. Left out as they'd count twice: EM and Reaction Bonus. Their value is the extra reaction
// damage, which buffer points already score; inside this yardstick they'd raise Aggravate or Vaporize again (Nahida's
// EM took Clorinde's Aggravate line from +170% to +212%). Weapon, set and constellation effects (effects.json)
// aren't in kit.json.
export interface TeamBuffStats {
  atk: number; // flat ATK
  atkPct: number; // of the carry's base ATK
  dmgBonus: number;
  critRate: number;
  flat: number; // flat DMG per hit instance (Additive Base DMG Bonus: Shenhe)
  // Flat DMG and DMG Bonus for some attack types only (appliesTo: Yun Jin's and Candace's Normal Attacks, Xianyun's
  // plunges, Sigewinne's Skill, #299), by hit type: damage.ts adds them to those hits alone, not to `flat`/`dmgBonus`.
  byHit?: Partial<Record<string, { flat: number; dmgBonus: number }>>;
  // Reaction Additive Base DMG Bonus on the carry's direct Lunar hits, by reaction (Illuga's Lunar-Crystallize, #186):
  // per hit, added after the Lunar multipliers (damage.ts). Summed by teamBuffStats beside the numbers.
  lunarAdditive?: Partial<Record<Reaction, number>>;
  resShred: number; // enemy RES decrease on the hits it reaches (#204)
  defShred: number; // enemy DEF decrease (#204)
  em: number; // flat EM (#186: kit EM buffs and Sprawling Greenery), for the reactions the hits trigger
  hpPct: number; // of the member's base HP (#186: Soothing Water)
  // Teammates' Moonsign Benediction Base DMG bonus to the carry's direct Lunar hits, by reaction (#88; score.ts
  // teammatesLunarBase). Set by the scorer beside these sums, so teamBuffStats leaves it out.
  lunarBase?: Partial<Record<Reaction, number>>;
  // Each member's funded Burst share (#207), for buffs from their Burst; set by the scorer, like lunarBase.
  burstShares?: BurstShares;
}
// The share of rotations each member's Burst is funded in this team (#207, energy.ts energyNeeds); 1 when missing.
export type BurstShares = ReadonlyMap<ScoringCharacter, number>;

type NumericBuff = Exclude<keyof TeamBuffStats, "lunarBase" | "burstShares" | "lunarAdditive" | "byHit">;
export const NO_TEAM_BUFFS: TeamBuffStats = { atk: 0, atkPct: 0, dmgBonus: 0, critRate: 0, flat: 0, resShred: 0, defShred: 0, em: 0, hpPct: 0 };

// The buff kinds addBuffStats turns into carry stats: inside a modeled carry's damage, so not scored again (#202).
const IN_CARRY_DAMAGE = new Set([
  "atkFromBase", "atkFromAtk", "atkPct", "atkFlat", "dmgBonus", "dmgBonusPerEm", "dmgBonusFromExcessAtk", "critRate",
  "flatDmgFromAtk", "flatDmgFromDef", "flatDmgFromEm", "flatDmg", "resShred", "defShred", "lunarAdditiveFromEm",
  "em", "emFromAtk", "emFromDef", "emFromEm", "emFromTopEm", // #186: EM feeds the reactions inside damage now
]);

function addBuffStats(buff: KitBuff, stats: ReturnType<typeof bufferStats>, team: TeamShape, weight: number, into: TeamBuffStats) {
  if (buff.appliesTo) {
    const part = { ...NO_TEAM_BUFFS };
    addBuffStats({ ...buff, appliesTo: undefined }, stats, team, weight, part);
    into.atk += part.atk; // the other kinds aren't limited by attack type
    into.atkPct += part.atkPct;
    into.critRate += part.critRate;
    into.resShred += part.resShred;
    into.defShred += part.defShred;
    for (const t of buff.appliesTo) addByHit(into, t, part.flat, part.dmgBonus);
    return;
  }
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
    // RES and DEF shred (#204): on the enemy, so on every hit of the element they cover (`applicable`); uptime-weighted.
    case "resShred":
      into.resShred += v * weight;
      break;
    case "defShred":
      into.defShred += v * weight;
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
    case "lunarAdditiveFromEm": {
      const r = buff.lunar as Reaction;
      into.lunarAdditive = { ...into.lunarAdditive, [r]: (into.lunarAdditive?.[r] ?? 0) + cap(stats.em * v) * weight };
      break;
    }
    case "flatDmg":
      into.flat += cap(Math.max(0, (stats.hp - 30000) / 1000) * v) * weight;
      break;
    // EM (#186), as `gain` reads it: of the buffer's own stats; Nahida's of the party's highest EM (her own), capped.
    case "em":
      into.em += v * weight;
      break;
    case "emFromAtk":
      into.em += stats.atk * v * weight;
      break;
    case "emFromDef":
      into.em += stats.def * v * weight;
      break;
    case "emFromEm":
      into.em += stats.em * v * weight;
      break;
    case "emFromTopEm":
      into.em += Math.min(stats.em * v, 250) * weight;
      break;
  }
}

function addByHit(into: TeamBuffStats, type: string, flat: number, dmgBonus: number) {
  const h = into.byHit?.[type];
  into.byHit = { ...into.byHit, [type]: { flat: (h?.flat ?? 0) + flat, dmgBonus: (h?.dmgBonus ?? 0) + dmgBonus } };
}

// One buffer's part, cached like kitBuffValue (per buffer and carry object, then team shape), not per team: the search
// reads thousands of teams per carry.
const statsCache = new WeakMap<ScoringCharacter, WeakMap<ScoringCharacter, Map<string, TeamBuffStats>>>();
// What a buffer's conditions read from the team: its elements, Mavuika's Fighting Spirit, Ifa's and Furina's partners.
function shapeOf(s: ScoringCharacter, carry: ScoringCharacter, team: readonly ScoringCharacter[]): TeamShape {
  return {
    elements: team.map((m) => m.element),
    fightingSpirit: fightingSpirit(s, carry, team),
    nightsoulOthers: team.filter((m) => m !== s && m.families?.includes("nightsoul")).length,
    healersOthers: team.filter((m) => m !== s && m.roles.includes("healer")).length,
    moonsign: team.filter((m) => m.families?.includes("moonsign")).length,
    partyEm: partySetBuffs(team).em,
  };
}

function bufferPart(s: ScoringCharacter, carry: ScoringCharacter, carryReactions: readonly Reaction[], team: readonly ScoringCharacter[], burst: number): TeamBuffStats {
  const shape = shapeOf(s, carry, team);
  let byCarry = statsCache.get(s);
  if (!byCarry) statsCache.set(s, (byCarry = new WeakMap()));
  let byKey = byCarry.get(carry);
  if (!byKey) byCarry.set(carry, (byKey = new Map()));
  const key = `${burst}|${carryReactions.join(",")}|${shape.fightingSpirit}|${shape.nightsoulOthers}|${shape.healersOthers}|${shape.moonsign}|${shape.partyEm}|${[...shape.elements].sort().join(",")}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const out = { ...NO_TEAM_BUFFS };
  const entry = KIT[s.id];
  const stats = bufferStats(s, entry.base, entry.buildFor, shape.partyEm);
  // The buff kitBuffValue counts for each kind: the one worth most to this carry.
  const best = new Map<string, { buff: KitBuff; weight: number; g: number }>();
  for (const b of entry.buffs) {
    // A buff for some reactions only (Lauma's flat Bloom-type DMG) adds to that reaction's damage, not the carry's
    // hits: like Reaction Bonus, buffer points score it.
    if (b.reactions || offFieldOnly(s, b)) continue;
    const buff = applicable(b, carry, carryReactions, shape);
    if (!buff) continue;
    const weight = (b.uptime ?? 1) * (b.burst ? burst : 1) * stackShare(b, carry, carryReactions, shape);
    const g = gain(b, stats, carry, carryReactions, shape) * weight;
    if (g > (best.get(b.kind)?.g ?? 0)) best.set(b.kind, { buff, weight, g });
  }
  for (const { buff, weight } of best.values()) addBuffStats(buff, stats, shape, weight, out);
  byKey.set(key, out);
  return out;
}

// `active`: the team's reactions, for family bonuses that a teammate's reaction turns on (Fischl's ATK after Overloaded);
// without it, the carry's own.
export function teamBuffStats(
  carry: ScoringCharacter,
  carryReactions: readonly Reaction[],
  team: readonly ScoringCharacter[],
  shares?: BurstShares,
  active: readonly Reaction[] = carryReactions,
): TeamBuffStats {
  const out = { ...NO_TEAM_BUFFS };
  familyBuffStats(carry, carry, active, team, out);
  resonanceStats(carry, active, team, out);
  polestarStats(carry, active, out);
  partyGearStats(carry, carry, active, team, out);
  for (const s of team) {
    const entry = KIT[s.id];
    if (s === carry || !entry || entry.missing || entry.buffs.length === 0) continue;
    const part = bufferPart(s, carry, carryReactions, team, shares?.get(s) ?? 1);
    for (const k of Object.keys(NO_TEAM_BUFFS) as NumericBuff[]) out[k] += part[k];
    for (const [t, v] of Object.entries(part.byHit ?? {})) addByHit(out, t, v!.flat, v!.dmgBonus);
    for (const [r, v] of Object.entries(part.lunarAdditive ?? {}) as [Reaction, number][])
      out.lunarAdditive = { ...out.lunarAdditive, [r]: (out.lunarAdditive?.[r] ?? 0) + v };
  }
  return out;
}

const offFieldOnly = (s: ScoringCharacter, b: KitBuff) => !!PARTY_WIDE[s.id]?.offField && PARTY_WIDE[s.id].kinds.includes(b.kind);

// Kit buffs that reach every party member's hits, not only the on-field character's (#204), hand-tagged from the
// talent text. teamBuffStats gives the carry every buff; these also reach sub-DPS hits (memberBuffStats). The rest
// stay on-field only (Bennett's field, Yelan's and Iansan's active-character buffs, Xianyun's plunges, Alyosha...).
// offField: only off-field members' hits, never the on-field carry's (Sigewinne's Convalescence): kept out of the
// carry's damage and buffer points (offFieldOnly).
const PARTY_WIDE: Record<string, { kinds: string[]; elements?: Element[]; needs?: Reaction[]; offField?: boolean; note: string }> = {
  Faruzan: { kinds: ["dmgBonus"], note: "Prayerful Wind's Benefit: all nearby party members' Anemo DMG" },
  Furina: { kinds: ["dmgBonus"], note: "Let the People Rejoice: all nearby party members' DMG, by Fanfare" },
  "Kaedehara Kazuha": {
    kinds: ["dmgBonusPerEm"],
    elements: ["Pyro", "Hydro", "Electro", "Cryo"],
    needs: ["swirl", "stellar-swirl"],
    note: "Poetics of Fuubutsu: all party members' DMG of the element he swirls",
  },
  Lynette: { kinds: ["atkPct"], note: "Sophisticated Synergy: all party members' ATK" },
  Mavuika: { kinds: ["dmgBonus"], note: "Kiongozi: all nearby party members' DMG, by Fighting Spirit" },
  Mona: { kinds: ["dmgBonus"], note: "Illusory Bubble's Omen: opponents take more DMG from every hit" },
  Rosaria: { kinds: ["critRate"], note: "Shadow Samaritan: CRIT Rate of all party members but Rosaria" },
  Shenhe: { kinds: ["flatDmgFromAtk"], note: "Icy Quill: all party members' Cryo hits (the quills are shared: estimate)" },
  // Checked against the talent text (#204): Alyosha's Hunter's Precision raises ATK "when they are on the field", and
  // Illuga's Burst reaches "nearby active party members", so those stay on-field only.
  // EM (#186): Albedo's passive 2 "Elemental Mastery of nearby party members", Nilou's "all nearby characters", Sucrose's
  // passive 2 "all party members' (excluding Sucrose)". Ineffa's, Linnea's and Nahida's are the active character's.
  Albedo: { kinds: ["em"], note: "Homuncular Nature: \"increases the Elemental Mastery of nearby party members by 125\"" },
  Nilou: { kinds: ["em"], note: "Court of Dancing Petals: \"increase the Elemental Mastery of all nearby characters by 100\"" },
  Sucrose: { kinds: ["emFromEm"], note: "Mollis Favonius: \"increases all party members' (excluding Sucrose) Elemental Mastery\"" },
  Nicole: { kinds: ["atkFromAtk"], note: "Grace of Kenosis: \"bestowing the Grace of Kenosis effect on nearby party members\"" },
  Illuga: { kinds: ["critRate"], elements: ["Geo"], note: "Lightkeeper's Oath (passive 1): \"other nearby party members\", Geo DMG" },
  Prune: { kinds: ["dmgBonusFromExcessAtk"], note: "Tolling Rally (passive 2): \"other nearby party members will gain the Tolling Rally effect\"" },
  Sigewinne: {
    kinds: ["flatDmg"],
    offField: true,
    note: "Convalescence (passive 1): \"the Elemental Skills of your nearby off-field party members other than Sigewinne\"",
  },
};

// The party-wide kit buffs one member's hits get from their teammates (#204), as teamBuffStats gives the carry: same
// values, conditions and uptimes. A buffer's buff on their own hits is left out (#98). `talent`: the hit's talent, for a
// buff limited to some (appliesTo). Cached per team array object, like the scorer's other team readings.
const memberCache = new WeakMap<readonly ScoringCharacter[], Map<string, TeamBuffStats>>();
export function memberBuffStats(
  m: ScoringCharacter,
  carry: ScoringCharacter,
  active: readonly Reaction[],
  team: readonly ScoringCharacter[],
  talent?: string,
  shares?: BurstShares,
): TeamBuffStats {
  let byKey = memberCache.get(team);
  if (!byKey) memberCache.set(team, (byKey = new Map()));
  const key = `${m.id}|${carry.id}|${active.join(",")}|${talent ?? ""}|${shares ? "funded" : ""}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const out = { ...NO_TEAM_BUFFS };
  byKey.set(key, out);
  familyBuffStats(m, carry, active, team, out);
  resonanceStats(m, active, team, out);
  partyGearStats(m, carry, active, team, out);
  for (const s of team) {
    const wide = PARTY_WIDE[s.id];
    const entry = KIT[s.id];
    if (s === m || !entry || entry.missing) continue;
    // RES and DEF shred are on the enemy: every member's hits of the element they cover get them (#204).
    const shape0 = shapeOf(s, carry, team);
    for (const kind of ["resShred", "defShred"] as const) {
      const b = entry.buffs.find((x) => x.kind === kind && !x.reactions && (!x.elements || x.elements.includes(m.element)) && (!x.teamOnly || shape0.elements.every((e) => x.teamOnly!.includes(e))));
      const funded = b?.burst ? (shares?.get(s) ?? 1) : 1;
      if (b) addBuffStats(b.steps ? { ...b, value: stepValue(b, shape0) } : b, bufferStats(s, entry.base, entry.buildFor, shape0.partyEm), shape0, (b.uptime ?? 1) * funded, out);
    }
    if (!wide) continue;
    if (wide.elements && !wide.elements.includes(m.element)) continue;
    if (wide.needs && !wide.needs.some((r) => active.includes(r))) continue;
    const shape = shapeOf(s, carry, team);
    const stats = bufferStats(s, entry.base, entry.buildFor, shape.partyEm);
    const seen = new Set<string>(); // one buff per kind, as bufferPart
    for (const b of entry.buffs) {
      if (b.reactions || !wide.kinds.includes(b.kind) || seen.has(b.kind)) continue;
      if (b.elements && !b.elements.includes(m.element)) continue;
      if (b.teamOnly && !shape.elements.every((e) => b.teamOnly!.includes(e))) continue;
      if (b.carryReactions && !b.carryReactions.some((r) => carry.reactions.includes(r as Reaction) && active.includes(r as Reaction))) continue;
      if (b.appliesTo && !(talent && b.appliesTo.includes(talent))) continue;
      seen.add(b.kind);
      // Gated by this hit's talent above, so it counts in full on it.
      addBuffStats({ ...b, appliesTo: undefined, ...(b.steps ? { value: stepValue(b, shape) } : {}) }, stats, shape, (b.uptime ?? 1) * (b.burst ? (shares?.get(s) ?? 1) : 1), out);
    }
  }
  return out;
}

// Elemental Resonance as stats (#186), on every member's hits: Genshin Impact Wiki, Elemental Resonance (fetched
// 2026-10-21). Fervent Flames "Increases ATK by 25%"; Soothing Water "Increases Max HP by 25%"; Shattering Ice "Increases
// CRIT Rate against enemies that are Frozen or affected by Cryo by 15%" (two Cryo members keep an aura: taken as always);
// Enduring Rock, "when characters protected by a shield or when Moondrifts formed by Lunar-Crystallize reactions are
// nearby": "DMG dealt increased by 15%", "decrease their Geo RES by 20%" (a shielder, Crystallize's shards, or
// Lunar-Crystallize); Sprawling Greenery "Elemental Mastery increased by 50", +30 after Burning, Quicken, Bloom or
// Lunar-Bloom and +20 after Aggravate, Spread, Hyperbloom or Burgeon (kept up while the team triggers them). High Voltage
// (particles) and Impetuous Winds (stamina, CD) stay points.
export const RESONANCE_IN_DAMAGE = new Set<string>(["Pyro", "Hydro", "Cryo", "Geo", "Dendro"]);
function resonanceStats(m: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[], into: TeamBuffStats) {
  const count = (e: string) => team.filter((x) => x.element === e).length;
  if (count("Pyro") >= 2) into.atkPct += 0.25;
  if (count("Hydro") >= 2) into.hpPct += 0.25;
  if (count("Cryo") >= 2) into.critRate += 0.15;
  const shielded = team.some((x) => x.roles.includes("shielder")) || active.includes("crystallize") || active.includes("lunar-crystallize");
  if (count("Geo") >= 2 && shielded) {
    into.dmgBonus += 0.15;
    if (m.element === "Geo") into.resShred += 0.2;
  }
  if (count("Dendro") >= 2) {
    const any = (rs: Reaction[]) => rs.some((r) => active.includes(r));
    into.em += 50 + (any(["burning", "quicken", "bloom", "lunar-bloom"]) ? 30 : 0) + (any(["aggravate", "spread", "hyperbloom", "burgeon"]) ? 20 : 0);
  }
}

// The Polestar Field (#327): after a Stellar-Conduct, "Characters inside the field have their Cryo and Electro DMG Bonus
// increased by 20%. If at least 1 Cryo or Electro hit is included, Cryo and Electro DMG Bonus is instead increased by
// 28% plus an additional 1% for each recorded hit, up to a maximum of 12 hits" (Genshin Impact Wiki, Stellar-Conduct,
// fetched 2026-10-22): 40%, saturated as the Stellar-Conduct coefficient is (damage.ts LUNAR_COEFFICIENT). Only the
// on-field carry is inside the field; its Physical RES -40% is left out.
function polestarStats(carry: ScoringCharacter, active: readonly Reaction[], into: TeamBuffStats) {
  if (active.includes("stellar-conduct") && (carry.element === "Cryo" || carry.element === "Electro")) into.dmgBonus += 0.4;
}

// Family team bonuses as stats (#204): the Secret Rite, Stellar and Ascendant Gleam party values that are DMG Bonus,
// ATK % or RES shred (kit.json secretRite, stellar, ascendantGleam), on the hits they reach, with the conditions and
// uptimes their points use (score.ts partyValueGain). EM and Reaction Bonus stay points, as for kit buffs (they'd count
// twice); Nicole's Arcane Projections and Prune's own ATK are on their own hits and buff. Who a value reaches, from
// the talent text: RES shred is on the enemy, so every member's hits of its element; Albedo's Isotomas and Sucrose's
// Wind Spirits "nearby party members'"; Fischl's ATK "Fischl and other nearby active party members"; Prune's and
// Venti's, the character whose Swirl triggered it (the carry).
type FamilyValue = {
  kind: string;
  value: number;
  max?: number;
  perDef?: number;
  elements?: string[];
  reactions?: string[];
  teamReactions?: string[];
  hexereiOnly?: boolean;
  radiance?: string;
  uptime: number | null;
};
type FamilyEntry = { target: string; values?: FamilyValue[] };
const FAMILY_PARTY: { family: "hexerei" | "stellar" | "moonsign"; entries: Record<string, FamilyEntry>; members: number }[] = [
  { family: "hexerei", entries: kitJson.secretRite as Record<string, FamilyEntry>, members: 2 }, // Secret Rite
  { family: "stellar", entries: kitJson.stellar as Record<string, FamilyEntry>, members: 1 }, // Radiance: by reaction
  { family: "moonsign", entries: kitJson.ascendantGleam as unknown as Record<string, FamilyEntry>, members: 2 }, // Ascendant Gleam
];
const FAMILY_SCOPE: Record<string, "party" | "active" | "activeAndSelf"> = { Albedo: "party", Sucrose: "party", Fischl: "activeAndSelf" };
// The family value kinds in damage, so a modeled carry's family lines score the rest (score.ts).
export const FAMILY_IN_DAMAGE = new Set(["dmgBonus", "atkPct", "resShred"]);

function familyBuffStats(m: ScoringCharacter, carry: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[], into: TeamBuffStats) {
  for (const { family, entries, members } of FAMILY_PARTY) {
    if (team.filter((x) => x.families?.includes(family)).length < members) continue;
    for (const s of team) {
      const entry = entries[s.id];
      if (entry?.target !== "party" || !s.families?.includes(family)) continue;
      const stats = bufferStats(s, KIT[s.id]?.base ?? null, KIT[s.id]?.buildFor);
      for (const v of entry.values ?? []) {
        if (!FAMILY_IN_DAMAGE.has(v.kind)) continue;
        const scope = v.kind === "resShred" ? "party" : (FAMILY_SCOPE[s.id] ?? "active");
        if (scope === "active" ? m !== carry : scope === "activeAndSelf" ? m !== carry && m !== s : false) continue;
        if (v.elements && !v.elements.includes(m.element)) continue;
        if (v.reactions && !v.reactions.some((r) => carry.reactions.includes(r as Reaction) && active.includes(r as Reaction))) continue;
        if (v.teamReactions && !v.teamReactions.some((r) => active.includes(r as Reaction))) continue;
        if (v.radiance && !active.includes(v.radiance as Reaction)) continue;
        if (v.hexereiOnly && !m.families?.includes("hexerei")) continue;
        const value = (v.perDef ? Math.min(v.max ?? Infinity, (v.value * stats.def) / v.perDef) : v.value) * (v.uptime ?? 1);
        if (v.kind === "dmgBonus") into.dmgBonus += value;
        else if (v.kind === "atkPct") into.atkPct += value;
        else into.resShred += value;
      }
    }
  }
}

// Support gear's party effects as stats (#206, extract-kit SETS / WEAPONS `party`, with a `scope`): ATK %, flat ATK from
// the holder's EM, DMG Bonus (by hit type, or per 1,000 of the holder's DEF) and RES shred, on the hits they reach, from
// the members whose build has the gear (imported builds: a benchmark support has none). EM and Reaction Bonus stay
// effects.json points, as for kit buffs. Scope: party (every member, the holder too), others (all but the holder), active
// (the on-field carry, not the holder: Thrilling Tales' "new character taking the field"). One of each set or weapon,
// and one per Millennial Movement `group` and kind ("buffs of the same type will not stack"); RES shred of one element
// doesn't stack either (VV: "RES debuffs of the same elemental type do not stack"): the largest counts. `when`:
// reaction(s) (the team triggers it, one of them), holderReacts (the holder triggers one of the team's reactions), swirled
// (VV: an aura element, while the team Swirls), crystallized (Petra: the crystallized element), reactionElements (Scroll,
// Hakushin: the elements in the holder's reactions with this team), nightsoul (the holder has Nightsoul's Blessing).
// hexerei: the holder's Hexerei family (Witch's Homework done; Celestial Gift, #345); secretRite: two Hexerei members;
// wearerElement / wearerOrActiveElement: the hit's member has the holder's element / or the on-field carry's.
type GearWhen = {
  hexerei?: boolean;
  secretRite?: boolean;
  wearerElement?: boolean;
  wearerOrActiveElement?: boolean;
  reaction?: Reaction;
  reactions?: Reaction[];
  holderReacts?: boolean;
  swirled?: boolean;
  crystallized?: boolean;
  reactionElements?: boolean;
  nightsoul?: boolean;
};
type GearEffect = {
  kind: string;
  party?: boolean;
  scope?: "party" | "others" | "active";
  value?: number; // a set's
  values?: number[]; // a weapon's, by refinement
  max?: number[];
  types?: string[];
  element?: string;
  elements?: string[];
  group?: string;
  when?: GearWhen;
};
const GEAR_KINDS = new Set(["atkPct", "atkFromHolderEm", "dmgBonus", "dmgBonusPerDef", "resShred"]);
const partyGear = (all: Record<string, GearEffect[]>) =>
  Object.fromEntries(
    Object.entries(all)
      .map(([id, effects]) => [id, effects.filter((e) => e.party && GEAR_KINDS.has(e.kind))])
      .filter(([, effects]) => effects.length > 0),
  ) as Record<string, GearEffect[]>;
const GEAR_SETS = partyGear((kitJson as unknown as { sets: Record<string, GearEffect[]> }).sets);
const GEAR_WEAPONS = partyGear((kitJson as unknown as { weapons: Record<string, GearEffect[]> }).weapons);
// Whether this gear's party stats are in damage (#206): score.ts then scores only the rest of its effects.json buffs.
export const partyGearModeled = (source: string, id: string) => !!(source === "set" ? GEAR_SETS : source === "weapon" ? GEAR_WEAPONS : {})[id];

const AURA_ELEMENTS = ["Pyro", "Hydro", "Electro", "Cryo"];
// Archaic Petra's one element: the carry's when it can crystallize, else the team's first aura element.
const crystallizedElement = (carry: ScoringCharacter, team: readonly ScoringCharacter[]) =>
  AURA_ELEMENTS.includes(carry.element) ? carry.element : AURA_ELEMENTS.find((e) => team.some((x) => x.element === e));
// The elements in the holder's reactions with this team (Scroll, Hakushin): theirs and those it reacts with.
function holderReactionElements(holder: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]): string[] {
  const out = new Set<string>();
  for (const r of holder.reactions.filter((x) => active.includes(x))) {
    const els = reactionElements(r);
    if (!els.includes(holder.element)) continue;
    for (const e of els) if (e === holder.element || team.some((x) => x.element === e)) out.add(e);
  }
  return [...out];
}

function gearFits(w: GearWhen, holder: ScoringCharacter, m: ScoringCharacter, carry: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  return (
    (!w.reaction || active.includes(w.reaction)) &&
    (!w.reactions || w.reactions.some((r) => active.includes(r))) &&
    (!w.holderReacts || holder.reactions.some((r) => active.includes(r))) &&
    (!w.swirled || (active.includes("swirl") && AURA_ELEMENTS.includes(m.element))) &&
    (!w.crystallized || ((active.includes("crystallize") || active.includes("lunar-crystallize")) && m.element === crystallizedElement(carry, team))) &&
    (!w.reactionElements || holderReactionElements(holder, active, team).includes(m.element)) &&
    (!w.nightsoul || !!holder.families?.includes("nightsoul")) &&
    (!w.hexerei || !!holder.families?.includes("hexerei")) &&
    (!w.secretRite || team.filter((x) => x.families?.includes("hexerei")).length >= 2) &&
    (!w.wearerElement || m.element === holder.element) &&
    (!w.wearerOrActiveElement || m.element === holder.element || m.element === carry.element)
  );
}

function partyGearStats(m: ScoringCharacter, carry: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[], into: TeamBuffStats) {
  const seen = new Set<string>();
  const shred = new Map<string, number>(); // by element: the largest
  for (const s of team) {
    const gear: { id: string; e: GearEffect; value: number; max?: number }[] = [];
    for (const { set, pieces } of setsOf(s, active, team)) if (pieces >= 4) for (const e of GEAR_SETS[set] ?? []) gear.push({ id: set, e, value: e.value! });
    const w = s.weaponBuild;
    const r = w ? Math.min(5, Math.max(1, w.refinement)) - 1 : 0;
    for (const e of (w && GEAR_WEAPONS[w.id]) || []) gear.push({ id: w!.id, e, value: e.values![r], max: e.max?.[r] });
    if (gear.length === 0) continue;
    const stats = bufferStats(s, KIT[s.id]?.base ?? null, KIT[s.id]?.buildFor);
    for (const { id, e, value, max } of gear) {
      const scope = e.scope ?? "party";
      if ((scope === "others" && m.id === s.id) || (scope === "active" && (m.id !== carry.id || m.id === s.id))) continue;
      const elements = e.element ? [e.element] : e.elements;
      if (elements && !elements.includes(m.element)) continue;
      if (e.when && !gearFits(e.when, s, m, carry, active, team)) continue;
      if (e.kind === "resShred") {
        shred.set(m.element, Math.max(shred.get(m.element) ?? 0, value));
        continue;
      }
      const key = `${e.group ?? id}|${e.kind}|${e.types?.join(",") ?? ""}|${e.when?.nightsoul ? "nightsoul" : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.kind === "atkPct") into.atkPct += value;
      else if (e.kind === "atkFromHolderEm") into.atk += value * stats.em;
      else if (e.kind === "dmgBonusPerDef") into.dmgBonus += Math.min(max ?? Infinity, (value * stats.def) / 1000);
      else if (e.types) for (const t of e.types) addByHit(into, t, 0, value);
      else into.dmgBonus += value;
    }
  }
  for (const v of shred.values()) into.resShred += v;
}

// The team's kit bonuses to a transformative reaction's own damage (#256), for score.ts transformativeLines: Reaction
// Bonus (Baizhu per 1,000 Max HP, Nilou per 1,000 above 30,000 in an all-Dendro/Hydro team, Kaveh's Painted Dome while
// he is on field, Ifa per Rescue Essentials point) and Reaction Additive Base DMG Bonus from EM (Lauma's), each times
// its uptime. Buffer points leave them out (kitBuffValue outsideDamage).
export function reactionBonusesFor(
  r: Reaction,
  carry: ScoringCharacter,
  team: readonly ScoringCharacter[],
  shares?: BurstShares,
): { bonus: number; additive: number } {
  let bonus = 0;
  let additive = 0;
  const elements = team.map((m) => m.element);
  const partyEm = partySetBuffs(team).em; // Silken's EM on the members' EM-based bonuses (#306)
  const shape = { elements, nightsoulOthers: 0, healersOthers: 0, fightingSpirit: 0, moonsign: 0, partyEm };
  for (const m of team) {
    const entry = KIT[m.id];
    if (!entry || entry.missing) continue;
    const stats = bufferStats(m, entry.base, entry.buildFor, partyEm);
    for (const b of entry.buffs) {
      if (!b.reactions?.includes(r)) continue;
      if (b.teamOnly && !elements.every((e) => b.teamOnly!.includes(e))) continue;
      if (b.whileOnField && m !== carry) continue;
      const up = (b.uptime ?? 1) * (b.burst ? (shares?.get(m) ?? 1) : 1);
      if (b.kind === "reactionBonus") {
        const others = team.filter((x) => x !== m && x.families?.includes("nightsoul")).length;
        const essentials = () => rescueEssentials(b.points!, { ...shape, nightsoulOthers: others });
        const points = b.condition === "rescueEssentials" ? essentials() : 1;
        bonus += up * reactionBonusValue(b, stats) * points;
      }
      if (b.kind === "flatDmgFromEm") additive += up * b.value * stats.em;
    }
  }
  return { bonus, additive };
}
