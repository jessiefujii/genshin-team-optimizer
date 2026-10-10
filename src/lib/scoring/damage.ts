// A carry's own damage per second over one rotation, from data/kit.json `carries` (#101). #96 measures sub-DPS
// damage against it. Like the rest of the benchmark it only has to rank teams, not predict real numbers: no crit or
// enemy RES/DEF (left out on both sides of the comparison), talent level 9, C0.
import kitJson from "../../../data/kit.json";
import { BENCHMARK } from "./benchmark";
import { mainReactionOf } from "./reactions";
import type { Element, Reaction, ScoringCharacter } from "./types";

type HitType = "normal" | "charged" | "plunge" | "skill" | "burst";
interface CarryHit {
  label: string;
  type: HitType;
  scaling: { atk?: number; hp?: number; def?: number; em?: number };
  count: number;
  instances?: number;
  tag?: string;
}
type CarryBuff =
  | { kind: "atkFromHp"; value: number; capOfBase: number }
  | { kind: "addPerStack"; value: number; stacks: number; tag: string }
  | { kind: "dmgBonus"; value: number; types: HitType[]; hitsCap?: number }
  | { kind: "factor"; value: number; types: HitType[] }
  | { kind: "atkPct"; value: number }
  | { kind: "dmgBonusFromEr"; perPercent: number }
  | { kind: "dmgBonusPerEm"; perEm: number; max: number; types: HitType[]; labels: string[] }
  | { kind: "masque"; ratio: number; start: number; use: number }
  | { kind: "flatAtk"; value: number; cap: number; types: HitType[]; reactions: Reaction[] };
interface CarryKit {
  rotationSeconds: number;
  hits: CarryHit[];
  buffs: CarryBuff[];
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
const AMPLIFY_SHARE = 0.7; // reactions.ts: amplifying, main reaction
function reactionFactor(c: ScoringCharacter, em: number, active: readonly Reaction[]): number {
  const main = mainReactionOf(c);
  if (!main || main === "none" || !active.includes(main)) return 1;
  const amp = AMPLIFY[main]?.[c.element];
  if (!amp) return 1; // other reactions: later (#101)
  const emBonus = (2.78 * em) / (em + 1400);
  return 1 + AMPLIFY_SHARE * (amp * (1 + emBonus) - 1);
}

export interface CarryDamage {
  perSecond: number;
  rotationSeconds: number;
  missing: string[]; // hits left out for lack of a source
}

// The carry's damage per second, or null when kit.json has no entry for them yet (carriesTodo).
// `active` is the team's active reactions: the main reaction only counts when the team can trigger it.
export function carryDamage(c: ScoringCharacter, active: readonly Reaction[] = []): CarryDamage | null {
  const kit = CARRIES[c.id];
  if (!kit) return null;
  const s = carryStats(c);
  let atk = s.atk;
  for (const b of kit.buffs) {
    if (b.kind === "atkFromHp") atk += Math.min(b.value * s.hp, b.capOfBase * s.baseAtk);
    if (b.kind === "atkPct") atk += b.value * s.baseAtk;
  }
  const instancesOf = (types: HitType[]) =>
    kit.hits.filter((h) => types.includes(h.type)).reduce((a, h) => a + h.count * (h.instances ?? 1), 0);
  let total = 0;
  for (const h of kit.hits) {
    let perHit = (h.scaling.atk ?? 0) * atk + (h.scaling.hp ?? 0) * s.hp + (h.scaling.def ?? 0) * s.def + (h.scaling.em ?? 0) * s.em;
    let bonus = s.dmgBonus;
    let factor = 1;
    for (const b of kit.buffs) {
      if (b.kind === "addPerStack" && b.tag === h.tag) perHit += b.value * b.stacks * (h.instances ?? 1) * atk;
      if (b.kind === "flatAtk" && b.types.includes(h.type) && b.reactions.some((r) => active.includes(r)))
        perHit += Math.min(b.value * atk, b.cap);
      if (b.kind === "dmgBonus" && b.types.includes(h.type)) {
        const share = b.hitsCap ? Math.min(1, b.hitsCap / instancesOf(b.types)) : 1;
        bonus += b.value * share;
      }
      if (b.kind === "dmgBonusFromEr") bonus += b.perPercent * Math.max(0, (s.er - 1) * 100);
      if (b.kind === "dmgBonusPerEm" && b.labels.includes(h.label)) bonus += Math.min(b.max, b.perEm * s.em);
      if (b.kind === "factor" && b.types.includes(h.type)) factor *= b.value;
    }
    total += perHit * h.count * (1 + bonus) * factor;
  }
  // Masque of the Red Death: each Normal Attack hit adds ATK x ratio x Bond of Life %, and uses `use` of it.
  for (const b of kit.buffs) {
    if (b.kind !== "masque") continue;
    const n = instancesOf(["normal"]);
    const bondSum = (b.start * (1 - Math.pow(1 - b.use, n))) / b.use;
    total += b.ratio * bondSum * atk * (1 + s.dmgBonus);
  }
  total *= reactionFactor(c, s.em, active);
  return { perSecond: total / kit.rotationSeconds, rotationSeconds: kit.rotationSeconds, missing: kit.missing ?? [] };
}
