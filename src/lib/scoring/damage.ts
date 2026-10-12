// A carry's own damage per second over one rotation, from data/kit.json `carries` (#101). #96 measures sub-DPS
// damage against it. Like the rest of the benchmark it only has to rank teams, not predict real numbers: no crit or
// enemy RES/DEF (left out on both sides of the comparison), talent level 9, C0.
import kitJson from "../../../data/kit.json";
import { BENCHMARK } from "./benchmark";
import { FIGHTING_SPIRIT_LIMIT, fightingSpirit } from "./kit";
import { mainReactionOf } from "./reactions";
import type { Element, Reaction, ScoringCharacter } from "./types";

type HitType = "normal" | "charged" | "plunge" | "skill" | "burst";
interface CarryHit {
  label: string;
  type: HitType;
  scaling: { atk?: number; hp?: number; def?: number; em?: number };
  count: number;
  instances?: number;
  reacting?: number; // how many of `count` trigger the combo's amplifying reaction, where the source says (#114)
  tag?: string;
  lunar?: LunarReaction; // direct Lunar reaction DMG (#135)
  when?: { reaction?: Reaction; ascendantGleam?: boolean }; // the hit only lands with these
}
type LunarReaction = "lunar-charged" | "lunar-bloom" | "lunar-crystallize";
type CarryBuff =
  | { kind: "atkFromHp"; value: number; capOfBase: number }
  | { kind: "addPerStack"; value: number; stacks: number; tag: string; fightingSpirit?: boolean }
  | { kind: "dmgBonus"; value: number; types: HitType[]; hitsCap?: number; fightingSpirit?: boolean }
  | { kind: "factor"; value: number; types: HitType[] }
  | { kind: "factorByReactions"; values: number[]; types: HitType[]; reactions: Reaction[] }
  | { kind: "atkPct"; value: number }
  | { kind: "dmgBonusFromEr"; perPercent: number }
  | { kind: "dmgBonusPerEm"; perEm: number; max: number; types: HitType[]; labels: string[] }
  | { kind: "masque"; ratio: number; start: number; use: number }
  | { kind: "flatAtk"; value: number; cap: number; types: HitType[]; reactions: Reaction[] }
  | { kind: "emFromAtk"; value: number; max: number }
  | { kind: "lunarBaseBonus"; stat: "atk" | "def" | "em"; perPoint: number; max: number };
// When a combo fits a team (#114): one of the team's active reactions, a teammate from each `members` list, and
// exactly that many teammates of each element in `elements`.
interface ComboWhen {
  reaction?: Reaction;
  members?: string[][];
  elements?: Partial<Record<Element, number>>;
}
interface CarryCombo {
  combo: string;
  when: ComboWhen[]; // alternatives
  hits: CarryHit[];
  buffs?: CarryBuff[]; // default: the carry's
}
interface CarryKit {
  rotationSeconds: number;
  combo?: string; // the default combo (KQM notation), when the carry has others
  hits: CarryHit[];
  buffs: CarryBuff[];
  combos?: CarryCombo[];
  missing?: string[];
}
const CARRIES = (kitJson as unknown as { carries: Record<string, CarryKit> }).carries;

export const hasCarryKit = (id: string) => id in CARRIES;

// A carry's stats: their build's, else a benchmark carry built for the stat they scale on.
function carryStats(c: ScoringCharacter) {
  const on = (stat: string) => !!c.scalesOn?.includes(stat as never);
  const b = BENCHMARK.carry;
  return {
    atk: c.stats?.atk ?? BENCHMARK.carryAtk,
    baseAtk: c.stats?.baseAtk ?? BENCHMARK.carryBaseAtk,
    hp: c.stats?.hp ?? (on("HP") ? b.hpBuilt : b.hp),
    def: c.stats?.def ?? (on("DEF") ? b.defBuilt : b.def),
    em: c.stats?.elementalMastery ?? (on("EM") ? b.emBuilt : BENCHMARK.carryEm),
    er: (c.stats?.energyRecharge ?? c.erTarget ?? 100) / 100,
    dmgBonus: c.stats ? c.stats.elementalDmgBonus / 100 : BENCHMARK.carryDmgBonus,
  };
}

// Vaporize and Melt multiply the hits that react: 2x for Hydro on Pyro / Pyro on Cryo, 1.5x the other way, plus EM.
// The share of the carry's hits that react is the #87 estimate for their main reaction.
const AMPLIFY: Partial<Record<Reaction, Partial<Record<Element, number>>>> = {
  vaporize: { Hydro: 2, Pyro: 1.5 },
  melt: { Pyro: 2, Cryo: 1.5 },
};
// A combo picked for a reaction (#114) amplifies by that reaction, and its hits with a sourced `reacting` count use
// that share instead of the flat one.
const AMPLIFY_SHARE = 0.7; // reactions.ts: amplifying, main reaction
// The extra damage a hit that reacts gains (2x Melt with EM: about 1.5 more), or 0 when the reaction doesn't amplify.
function amplifyGain(c: ScoringCharacter, em: number, active: readonly Reaction[], reaction: Reaction | "none" | undefined): number {
  if (!reaction || reaction === "none" || !active.includes(reaction)) return 0;
  const amp = AMPLIFY[reaction]?.[c.element];
  if (!amp) return 0; // other reactions: later (#101)
  const emBonus = (2.78 * em) / (em + 1400);
  return amp * (1 + emBonus) - 1;
}
// Spread and Aggravate add flat damage to each hit that reacts (Genshin Impact Wiki, Damage § Catalyze Damage Bonus,
// fetched 2026-10-12): 1.25 (Spread) or 1.15 (Aggravate) x the level 90 Level Multiplier, 1446.85, x (1 + 5 x EM /
// (EM + 1200)), then the hit's DMG bonuses. Which hits react: the same share as Vaporize and Melt (#129).
const CATALYZE: Partial<Record<Reaction, { element: Element; coefficient: number }>> = {
  spread: { element: "Dendro", coefficient: 1.25 },
  aggravate: { element: "Electro", coefficient: 1.15 },
};
const LEVEL_MULTIPLIER_90 = 1446.85;
function catalyzeDamage(c: ScoringCharacter, em: number, active: readonly Reaction[], reaction: Reaction | "none" | undefined): number {
  if (!reaction || reaction === "none" || !active.includes(reaction)) return 0;
  const r = CATALYZE[reaction];
  if (!r || r.element !== c.element) return 0;
  return r.coefficient * LEVEL_MULTIPLIER_90 * (1 + (5 * em) / (em + 1200));
}
// Direct Lunar reaction DMG (Genshin Impact Wiki, Damage § Lunar and Stellar Glimmer Reaction Damage, Direct, fetched
// 2026-10-12): coefficient x the talent's % x the stat x (1 + Reaction Base DMG Bonus) x (1 + 6 x EM / (EM + 2000)
// + Reaction Bonus). It has no DMG Bonus term: Elemental and other DMG % bonuses don't apply (KeqingMains' Flins
// guide: Lunar-Charged "does not scale with Electro DMG"). Indirect Lunar DMG (thunderclouds, Moondrifts) is the
// team's reaction, not the carry's hits: left to the scorer.
const LUNAR_COEFFICIENT: Record<LunarReaction, number> = { "lunar-charged": 3, "lunar-bloom": 1, "lunar-crystallize": 1.6 };
const lunarEmBonus = (em: number) => (6 * em) / (em + 2000);
const reactingShare = (h: CarryHit) => (h.reacting === undefined ? AMPLIFY_SHARE : h.count ? h.reacting / h.count : 0);

// The carry's combo for this team (#114): the first of kit.json's combos whose `when` fits, else the default.
// `reaction` is the reaction the picked combo is built around (undefined for the default).
function pickCombo(kit: CarryKit, c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  const mates = team.filter((m) => m.id !== c.id);
  const fits = (w: ComboWhen) =>
    (!w.reaction || active.includes(w.reaction)) &&
    (w.members ?? []).every((ids) => mates.some((m) => ids.includes(m.id))) &&
    Object.entries(w.elements ?? {}).every(([e, n]) => mates.filter((m) => m.element === e).length === n);
  for (const k of kit.combos ?? []) {
    const w = k.when.find(fits);
    if (w) return { kit: { ...kit, hits: k.hits, buffs: k.buffs ?? kit.buffs }, combo: k.combo, reaction: w.reaction };
  }
  return { kit, combo: kit.combo, reaction: undefined };
}

export interface CarryDamage {
  perSecond: number;
  combo?: string; // the combo picked for this team, when the carry has several (#114)
  rotationSeconds: number;
  missing: string[]; // hits left out for lack of a source
}

// Mavuika's Fighting Spirit buffs are read at its limit (200); her team decides how much she has when she bursts,
// the same value as her buff to other carries (kit.ts). Under the 100 her Burst needs it is 0: no Burst that
// rotation (KQM's "E only"), so her Burst hits drop out too and only her Skill's Flamestrider damage counts (#116).

// The carry's damage per second, or null when kit.json has no entry for them yet (carriesTodo).
// `active` is the team's active reactions: the main reaction only counts when the team can trigger it.
// `team` (the carry included) sets team-dependent resources (Mavuika's Fighting Spirit) and picks the combo (#114);
// default: the carry alone. Cached per character, reactions and team: the team search scores each carry in thousands
// of teams.
const cache = new WeakMap<ScoringCharacter, Map<string, CarryDamage | null>>();
export function carryDamage(c: ScoringCharacter, active: readonly Reaction[] = [], team: readonly ScoringCharacter[] = [c]): CarryDamage | null {
  let byKey = cache.get(c);
  if (!byKey) cache.set(c, (byKey = new Map()));
  const key = `${active.join("|")}#${team.map((m) => m.id).sort().join("|")}`;
  if (!byKey.has(key)) byKey.set(key, computeCarryDamage(c, active, team));
  return byKey.get(key)!;
}

function computeCarryDamage(c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]): CarryDamage | null {
  if (!CARRIES[c.id]) return null;
  const { kit, combo, reaction } = pickCombo(CARRIES[c.id], c, active, team);
  const s = carryStats(c);
  const fsShare = kit.buffs.some((b) => "fightingSpirit" in b && b.fightingSpirit) ? fightingSpirit(c, c, team) / FIGHTING_SPIRIT_LIMIT : 1;
  let atk = s.atk;
  for (const b of kit.buffs) {
    if (b.kind === "atkFromHp") atk += Math.min(b.value * s.hp, b.capOfBase * s.baseAtk);
    if (b.kind === "atkPct") atk += b.value * s.baseAtk;
  }
  const instancesOf = (types: HitType[]) =>
    kit.hits.filter((h) => types.includes(h.type)).reduce((a, h) => a + h.count * (h.instances ?? 1), 0);
  // EM from ATK (Flins' passive 2) only without a build: an imported build's EM is read as it is.
  let em = s.em;
  for (const b of kit.buffs) if (b.kind === "emFromAtk" && !c.stats) em += Math.min(b.max, b.value * atk);
  const amp = amplifyGain(c, em, active, reaction ?? mainReactionOf(c));
  const catalyze = catalyzeDamage(c, em, active, reaction ?? mainReactionOf(c));
  // Ascendant Gleam: two Moonsign members (each Moonsign Benediction raises the party's Moonsign by a level).
  const gleam = team.filter((m) => m.families?.includes("moonsign")).length >= 2;
  const lands = (h: CarryHit) => !h.when || ((!h.when.reaction || active.includes(h.when.reaction)) && (!h.when.ascendantGleam || gleam));
  const stat = { atk, def: s.def, em };
  let lunarBase = 0;
  for (const b of kit.buffs) if (b.kind === "lunarBaseBonus") lunarBase += Math.min(b.max, b.perPoint * stat[b.stat]);
  let total = 0;
  for (const h of kit.hits) {
    if (fsShare === 0 && h.type === "burst") continue; // can't Burst without the Fighting Spirit
    if (!lands(h)) continue;
    let perHit = (h.scaling.atk ?? 0) * atk + (h.scaling.hp ?? 0) * s.hp + (h.scaling.def ?? 0) * s.def + (h.scaling.em ?? 0) * em;
    if (h.lunar) {
      total += LUNAR_COEFFICIENT[h.lunar] * perHit * h.count * (1 + lunarBase) * (1 + lunarEmBonus(em));
      continue;
    }
    perHit += catalyze * (h.instances ?? 1) * reactingShare(h);
    let bonus = s.dmgBonus;
    let factor = 1;
    for (const b of kit.buffs) {
      if (b.kind === "addPerStack" && b.tag === h.tag) perHit += b.value * b.stacks * (b.fightingSpirit ? fsShare : 1) * (h.instances ?? 1) * atk;
      if (b.kind === "flatAtk" && b.types.includes(h.type) && b.reactions.some((r) => active.includes(r)))
        perHit += Math.min(b.value * atk, b.cap) * (h.instances ?? 1); // per hit instance (Clorinde's Impale: 3)
      if (b.kind === "dmgBonus" && b.types.includes(h.type)) {
        const share = b.hitsCap ? Math.min(1, b.hitsCap / instancesOf(b.types)) : 1;
        bonus += b.value * share * (b.fightingSpirit ? fsShare : 1);
      }
      if (b.kind === "dmgBonusFromEr") bonus += b.perPercent * Math.max(0, (s.er - 1) * 100);
      if (b.kind === "dmgBonusPerEm" && b.labels.includes(h.label)) bonus += Math.min(b.max, b.perEm * em);
      if (b.kind === "factor" && b.types.includes(h.type)) factor *= b.value;
      if (b.kind === "factorByReactions" && b.types.includes(h.type)) {
        const stacks = Math.min(b.values.length, b.reactions.filter((r) => active.includes(r)).length);
        if (stacks > 0) factor *= b.values[stacks - 1]; // Neuvillette's passive 1: one stack per kind of reaction
      }
    }
    total += perHit * h.count * (1 + bonus) * factor * (1 + reactingShare(h) * amp);
  }
  // Masque of the Red Death: each Normal Attack hit adds ATK x ratio x Bond of Life %, and uses `use` of it.
  for (const b of kit.buffs) {
    if (b.kind !== "masque") continue;
    const n = instancesOf(["normal"]);
    const bondSum = (b.start * (1 - Math.pow(1 - b.use, n))) / b.use;
    total += b.ratio * bondSum * atk * (1 + s.dmgBonus) * (1 + AMPLIFY_SHARE * amp);
  }
  return { perSecond: total / kit.rotationSeconds, ...(combo ? { combo } : {}), rotationSeconds: kit.rotationSeconds, missing: kit.missing ?? [] };
}
