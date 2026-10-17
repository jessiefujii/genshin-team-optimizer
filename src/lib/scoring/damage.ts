// A carry's own damage per second over one rotation, from data/kit.json `carries` (#101). #96 measures sub-DPS
// damage against it. Like the rest of the benchmark it only has to rank teams, not predict real numbers: no enemy
// RES/DEF (left out on both sides of the comparison), talent level 9, C0. Hits count at expected crit (#152).
import kitJson from "../../../data/kit.json";
import { BENCHMARK, defShredGain, resShredGain } from "./benchmark";
import { burstShare } from "./energy";
import { FIGHTING_SPIRIT_LIMIT, NO_TEAM_BUFFS, fightingSpirit, teamBuffStats, type TeamBuffStats } from "./kit";
import { mainReactionOf, TRANSFORMATIVE } from "./reactions";
export { TRANSFORMATIVE };
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
  additive?: boolean; // a Reaction Additive Base DMG Bonus to a Lunar hit: added as is (Zibai's passive 1, #146)
  element?: Element | "Physical" | "teammates"; // the hit's own damage type when it isn't the carry's element (Eula's, #222)
  // "teammates" (#233): the elements of the teammates of `byTeammates.elements` (Chasca's Shining Shells), split evenly
  // over the types present. byTeammates adds to `count` by how many such teammates (members) and types (types) the
  // team has, each a list indexed by that number (its last value past the end).
  byTeammates?: { elements: Element[]; members?: number[]; types?: number[] };
  addOn?: boolean; // more DMG on hits counted elsewhere (Cyno's passive 2): no Catalyze or teammates' flat DMG of its own
  when?: When; // the hit only lands with these
}
// secretRite: two Hexerei members (Klee's Boom-Boom Strikes from her third Normal Attack, #241).
// noHealer: no teammate heals the on-field character in play (healsInPlay; Hu Tao's passive 2, #2).
type When = { reaction?: Reaction; ascendantGleam?: boolean; secretRite?: boolean; noHealer?: boolean };
// A teammate whose heals reach the on-field character in play (#2): a tagged healer, but not Furina: her damage profile
// plays her in Ousia, where her Salon Members drain HP; only Pneuma's Singer of Many Waters heals.
export const healsInPlay = (m: ScoringCharacter) => m.roles.includes("healer") && m.id !== "Furina";
export type LunarReaction = "lunar-charged" | "lunar-bloom" | "lunar-crystallize";
type CarryBuff =
  | { kind: "atkFromHp"; value: number; capOfBase: number }
  | { kind: "atkFromDef"; value: number }
  | { kind: "addPerStack"; value: number; stacks: number; tag: string; stat?: "hp"; fightingSpirit?: boolean }
  | { kind: "dmgBonus"; value: number; types: HitType[]; hitsCap?: number; fightingSpirit?: boolean }
  | { kind: "factor"; value: number; types: HitType[]; when?: When }
  | { kind: "critRate"; value: number; labels: string[] }
  | { kind: "dmgBonusByTypes"; values: number[]; elements: Element[]; labels: string[] } // by teammates' types (#233)
  | { kind: "resShred"; value: number; elements: (Element | "Physical")[]; labels: string[] } // their own (Eula's Skill, #204)
  | { kind: "factorByReactions"; values: number[]; types: HitType[]; reactions: Reaction[] }
  | { kind: "atkPct"; value: number }
  | { kind: "dmgBonusFromEr"; perPercent: number }
  | { kind: "dmgBonusPerEm"; perEm: number; max: number; types: HitType[]; labels: string[] }
  | { kind: "masque"; ratio: number; start: number; use: number }
  | { kind: "flatAtk"; value: number; cap: number; types: HitType[]; reactions: Reaction[] }
  | { kind: "emFromAtk"; value: number; max: number }
  | { kind: "lunarBaseBonus"; stat: "atk" | "def" | "em"; perPoint: number; max: number }
  | { kind: "lunarReactionBonus"; value: number; reaction: LunarReaction; when?: When }
  | { kind: "baseDmgMultiplier"; value: number; labels: string[]; when?: When }
  | { kind: "emBonus"; value: number; when?: When };
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
  goblet?: "Physical"; // default: the carry's (Freminet's Physical combo, #231)
}
interface CarryKit {
  rotationSeconds: number; // sourced default, else the Burst cooldown (#103)
  rotationTeams?: { when: ComboWhen[]; seconds: number }[]; // sourced lengths for teams that fit (#103)
  combo?: string; // the default combo (KQM notation), when the carry has others
  hits: CarryHit[];
  buffs: CarryBuff[];
  combos?: CarryCombo[];
  missing?: string[];
  goblet?: "Physical"; // a Physical DMG goblet and set on the benchmark build (#222); else the carry's element
}
const CARRIES = (kitJson as unknown as { carries: Record<string, CarryKit> }).carries;

// Whether the carry's damage is modeled: a kit with no unsourced (missing) hit. The scorer reads a carry with one as not
// modeled (modeledCarryDps), so this does too: model checks then treat them alike (#227).
export const hasCarryKit = (id: string) => id in CARRIES && !CARRIES[id].missing?.length;

// Whether the carry's damage model has their own Ascendant Gleam upgrade (a hit or buff that needs it: Zibai's N4
// hit, Flins' passive 1, Nefer's Veil of Falsehood). For these carries the scorer counts the upgrade by the damage it
// adds (carryDamage with vs without Ascendant Gleam) instead of the flat "enhances X's kit" line (#150).
export function modelsAscendantGleam(id: string): boolean {
  return modelsWhen(id, "ascendantGleam");
}

// Whether the carry's damage model has their own Secret Rite upgrade (Klee's Boom-Boom Strikes and Boom Badges): the
// scorer then reads it as inside the damage, not as flat "enhances X's kit" points on top (#241).
export function modelsSecretRite(id: string): boolean {
  return modelsWhen(id, "secretRite");
}

function modelsWhen(id: string, flag: "ascendantGleam" | "secretRite"): boolean {
  const kit = CARRIES[id];
  if (!kit) return false;
  const all = [kit, ...(kit.combos ?? [])];
  return all.some(
    (k) => k.hits.some((h) => h.when?.[flag]) || (k.buffs ?? []).some((b) => "when" in b && b.when?.[flag]),
  );
}

// A carry's stats: their build's, else a benchmark carry built for the stat they scale on.
function carryStats(c: ScoringCharacter, goblet?: "Physical") {
  const on = (stat: string) => !!c.scalesOn?.includes(stat as never);
  const b = BENCHMARK.carry;
  return {
    atk: c.stats?.atk ?? BENCHMARK.carryAtk,
    baseAtk: c.stats?.baseAtk ?? BENCHMARK.carryBaseAtk,
    hp: c.stats?.hp ?? (on("HP") ? b.hpBuilt : b.hp),
    def: c.stats?.def ?? (on("DEF") ? b.defBuilt : b.def),
    em: c.stats?.elementalMastery ?? (on("EM") ? b.emBuilt : BENCHMARK.carryEm),
    er: (c.stats?.energyRecharge ?? c.erTarget ?? 100) / 100,
    dmgBonus: c.stats ? c.stats.elementalDmgBonus / 100 : goblet ? 0 : BENCHMARK.carryDmgBonus,
    // Physical DMG Bonus (#222): an import's (Enka), else the benchmark's Physical goblet and set; builds saved before
    // it was read have none until re-imported.
    physicalDmgBonus: c.stats ? (c.stats.physicalDmgBonus ?? 0) / 100 : goblet ? BENCHMARK.carryPhysicalDmgBonus : 0,
  };
}

// Expected crit (#152): 1 + Crit Rate (at most 100%) x Crit DMG, from the build, else the benchmark carry's. Every
// hit in carry and sub-DPS damage crits, flat additions included: Catalyze's bonus is added to the hit's base DMG
// before crit and DMG bonuses (Genshin Impact Wiki, Damage § Catalyze Damage Bonus), and Vaporize/Melt multiply a hit
// that has already crit. Pure EM characters too (Nefer: her own hits crit; usesCrit only skips their CV line).
// `extraRate` is Crit Rate from teammates' buffs (#157), as a fraction.
export function expectedCrit(c: ScoringCharacter, extraRate = 0): number {
  if (c.stats) return 1 + Math.min(c.stats.critRate / 100 + extraRate, 1) * (c.stats.critDmg / 100);
  return 1 + Math.min(BENCHMARK.carryCritRate + extraRate, 1) * BENCHMARK.carryCritDmg;
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
export function amplifyGain(c: ScoringCharacter, em: number, active: readonly Reaction[], reaction: Reaction | "none" | undefined): number {
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
// Transformative reaction DMG (#205; Genshin Impact Wiki, Damage § Transformative Reaction Damage, fetched 2026-10-18):
// coefficient x the level 90 Level Multiplier x (1 + 16 x EM / (EM + 2000) + Reaction Bonus), then the target's RES;
// no DEF, no crit, no DMG Bonus, and only the triggering member's EM counts. Swirl 0.6 (868.11 at level 90, wiki
// Swirl), Overloaded 2.75 (3978.85, wiki Overloaded). `perSecond`: the most instances one attacker deals a target per
// second (Damage Sequence: Swirl 2 per 0.5s, Overloaded 1 per 0.5s, Superconduct 2 per 0.5s). Superconduct 1.5 (wiki
// Superconduct). Electro-Charged 2.0 (wiki Electro-Charged): one tick per second while the target holds both auras, each
// tick 0.4U of each (score.ts reads its ticks from the aura budget, at most 1 per second in all). Freeze counts only
// through crit and Crystallize under survival (Jessie, 2026-10-18).
// `additive`: Reaction Additive Base DMG Bonus (Lauma's), added after that, before RES (wiki, same section; #256).
// TRANSFORMATIVE (the coefficients and caps) lives in reactions.ts, so kit.ts can read it (#256).
export const transformativeHit = (r: Reaction, em: number, bonus = 0, additive = 0) =>
  (TRANSFORMATIVE[r]?.coefficient ?? 0) * LEVEL_MULTIPLIER_90 * (1 + (16 * em) / (em + 2000) + bonus) + additive;

export function catalyzeDamage(c: ScoringCharacter, em: number, active: readonly Reaction[], reaction: Reaction | "none" | undefined): number {
  if (!reaction || reaction === "none" || !active.includes(reaction)) return 0;
  const r = CATALYZE[reaction];
  if (!r || r.element !== c.element) return 0;
  return r.coefficient * LEVEL_MULTIPLIER_90 * (1 + (5 * em) / (em + 1200));
}
// Whether the carry's modeled damage changes with reaction `r` (#134): their main reaction or a combo's when it
// amplifies (Vaporize, Melt) or catalyzes (Spread, Aggravate) their element, or a kit buff that needs it (Clorinde's
// Dark-Shattering Flame, Neuvillette's passive 1), or any reaction a combo is picked for or a hit or buff needs (#205):
// Nefer's Phantasm Performance needs Lunar-Bloom and Flins' Thunderous Symphony Additional DMG thunderclouds (#200);
// Navia's Crystallize shards, Freminet's Superconduct combo, Wriothesley's Stellar-Conduct combo, Heizou's Swirl hit.
// What the reaction does for them is then in their damage, so their flat reaction points go. Zibai's Lunar-Crystallize
// too: 2 of her 4 Strides need the team's Phase Shift Radiance from it (#248). The reaction's own damage, when it deals
// any, is score.ts transformativeLines'.
export function modelsReaction(c: ScoringCharacter, r: Reaction): boolean {
  const kit = CARRIES[c.id];
  if (!kit) return false;
  const own = r === mainReactionOf(c) || (kit.combos ?? []).some((k) => k.when.some((w) => w.reaction === r));
  if (own && (AMPLIFY[r]?.[c.element] || CATALYZE[r]?.element === c.element)) return true;
  if ((kit.combos ?? []).some((k) => k.when.some((w) => w.reaction === r))) return true;
  const needs = (w?: When) => w?.reaction === r;
  const needed = (k: Pick<CarryKit, "hits"> & { buffs?: CarryBuff[] }) =>
    k.hits.some((h) => needs(h.when)) || (k.buffs ?? []).some((b) => "when" in b && needs(b.when));
  if ([kit, ...(kit.combos ?? [])].some(needed)) return true;
  const buffs = [...kit.buffs, ...(kit.combos ?? []).flatMap((k) => k.buffs ?? [])];
  return buffs.some((b) => (b.kind === "flatAtk" || b.kind === "factorByReactions") && b.reactions.includes(r));
}

// A carry passive that any one of several reactions switches on (Clorinde's Dark-Shattering Flame: "an Electro-related
// reaction"; KQM: "very easy to reach max stacks" with any of them, #141): when the team has one of them, a stand-in
// reaction from that list which the damage model uses for nothing else (not amplifying, not catalyzing, not a combo
// or hit condition), so carryDamage with it reads the passive alone. Null when no such passive is on.
export function passiveEnabler(c: ScoringCharacter, active: readonly Reaction[]): Reaction | null {
  const kit = CARRIES[c.id];
  if (!kit) return null;
  const used = new Set<Reaction>([
    ...(kit.combos ?? []).flatMap((k) => k.when.map((w) => w.reaction).filter((r): r is Reaction => !!r)),
    ...kit.hits.map((h) => h.when?.reaction).filter((r): r is Reaction => !!r),
  ]);
  for (const b of kit.buffs) {
    if (b.kind !== "flatAtk" || !b.reactions.some((r) => active.includes(r))) continue;
    const stand = b.reactions.find((r) => !AMPLIFY[r] && !CATALYZE[r] && !(r in LUNAR_COEFFICIENT) && !used.has(r));
    if (stand) return stand;
  }
  return null;
}

// Direct Lunar reaction DMG (Genshin Impact Wiki, Damage § Lunar and Stellar Glimmer Reaction Damage, Direct, fetched
// 2026-10-12): (coefficient x the talent's % x the stat x Base DMG Multiplier x (1 + Reaction Base DMG Bonus)
// x (1 + 6 x EM / (EM + 2000) + Reaction Bonus) + Reaction Additive Base DMG Bonus). It has no DMG Bonus term: Elemental and other DMG % bonuses don't apply (KeqingMains' Flins
// guide: Lunar-Charged "does not scale with Electro DMG"). Indirect Lunar DMG (thunderclouds, Moondrifts) is the
// team's reaction, not the carry's hits: left to the scorer.
const LUNAR_COEFFICIENT: Record<LunarReaction, number> = { "lunar-charged": 3, "lunar-bloom": 1, "lunar-crystallize": 1.6 };
const lunarEmBonus = (em: number) => (6 * em) / (em + 2000);
// One direct Lunar hit from its talent value (multiplier x stat), for sub-DPS hits too (#151).
export const lunarHit = (reaction: LunarReaction, talentValue: number, em: number, baseBonus = 0) =>
  LUNAR_COEFFICIENT[reaction] * talentValue * (1 + baseBonus) * (1 + lunarEmBonus(em));
const reactingShare = (h: CarryHit) => (h.reacting === undefined ? AMPLIFY_SHARE : h.count ? h.reacting / h.count : 0);

// The carry's combo for this team (#114): the first of kit.json's combos whose `when` fits, else the default.
// `reaction` is the reaction the picked combo is built around (undefined for the default).
function teamFits(c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  const mates = team.filter((m) => m.id !== c.id);
  return (w: ComboWhen) =>
    (!w.reaction || active.includes(w.reaction)) &&
    (w.members ?? []).every((ids) => mates.some((m) => ids.includes(m.id))) &&
    Object.entries(w.elements ?? {}).every(([e, n]) => mates.filter((m) => m.element === e).length === n);
}
// The rotation's length (#103): a sourced length for a team that fits (kit.json rotationTeams, first match), else
// the carry's sourced default, else their Burst cooldown (both in rotationSeconds).
function rotationFor(kit: CarryKit, c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  const fits = teamFits(c, active, team);
  return kit.rotationTeams?.find((t) => t.when.some(fits))?.seconds ?? kit.rotationSeconds;
}
// The carry's rotation length for this team (#103), for the energy model (#37); undefined without a damage model.
export function carryRotationSeconds(c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  const kit = CARRIES[c.id];
  return kit ? rotationFor(kit, c, active, team) : undefined;
}
function pickCombo(kit: CarryKit, c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  const fits = teamFits(c, active, team);
  for (const k of kit.combos ?? []) {
    const w = k.when.find(fits);
    if (w) return { kit: { ...kit, hits: k.hits, buffs: k.buffs ?? kit.buffs, goblet: k.goblet ?? kit.goblet }, combo: k.combo, reaction: w.reaction };
  }
  return { kit, combo: kit.combo, reaction: undefined };
}

export interface CarryDamage {
  perSecond: number;
  combo?: string; // the combo picked for this team, when the carry has several (#114)
  rotationSeconds: number;
  missing: string[]; // hits left out for lack of a source
  em: number; // the carry's EM in this combo (kit EM buffs included), for the reactions they trigger (score.ts, #205)
}

// The carry's hits per second in this team's combo and rotation, and how many of them react (each hit's reacting
// share, as in carryDamage), for the sub-DPS aura budget (score.ts, #189/#191); null when the carry isn't modeled.
// Every hit is taken as elemental, and `when`-gated hits are counted as landing (estimate).
export function carryHitRates(c: ScoringCharacter, active: readonly Reaction[], team: readonly ScoringCharacter[]) {
  if (!CARRIES[c.id]) return null;
  const { kit, reaction } = pickCombo(CARRIES[c.id], c, active, team);
  const seconds = rotationFor(kit, c, active, team);
  let hits = 0;
  let reacting = 0;
  for (const h of kit.hits) {
    const n = h.count * (h.instances ?? 1);
    hits += n;
    reacting += h.count * reactingShare(h) * (h.instances ?? 1);
  }
  return { hitsPerSecond: hits / seconds, reactingPerSecond: reacting / seconds, reaction: reaction ?? mainReactionOf(c) };
}

// Mavuika's Fighting Spirit buffs are read at its limit (200); her team decides how much she has when she bursts,
// the same value as her buff to other carries (kit.ts). Under the 100 her Burst needs it is 0: no Burst that
// rotation, so she plays Skill only (KQM: "viable" for teams that can't build enough; Jessie, #126): her default
// combo (E Q C8F) without the Burst hit, not a Q combo picked for the team's reaction. KQM gives no Skill-only combo,
// so the Flamestrider Charged Attacks are her default combo's (estimate).

// The carry's damage per second, or null when kit.json has no entry for them yet (carriesTodo).
// `active` is the team's active reactions: the main reaction only counts when the team can trigger it.
// `team` (the carry included) sets team-dependent resources (Mavuika's Fighting Spirit) and picks the combo (#114);
// default: the carry alone. Cached per character, reactions and team: the team search scores each carry in thousands
// of teams. `noGleam` reads it as if the party weren't at Ascendant Gleam, so the scorer can measure what the carry's
// own Ascendant Gleam upgrade adds (#150).
// `buffs` adds the team's kit buffs to the carry's stats (#157, kit.ts teamBuffStats); default: none.
const cache = new WeakMap<ScoringCharacter, Map<string, CarryDamage | null>>();
export function carryDamage(
  c: ScoringCharacter,
  active: readonly Reaction[] = [],
  team: readonly ScoringCharacter[] = [c],
  buffs: TeamBuffStats = NO_TEAM_BUFFS,
  noGleam = false,
  // The share of the carry's Vaporize or Melt hits the team's aura can feed (score.ts auraShares, #239); 1 alone.
  ampShare = 1,
): CarryDamage | null {
  // Readings with team buffs aren't cached: they're cheap, and one more entry per team ran the compare out of memory.
  if (buffs !== NO_TEAM_BUFFS) return computeCarryDamage(c, active, team, buffs, noGleam, ampShare);
  let byKey = cache.get(c);
  if (!byKey) cache.set(c, (byKey = new Map()));
  const key = `${active.join("|")}#${team.map((m) => m.id).sort().join("|")}${noGleam ? "#noGleam" : ""}#${ampShare}`;
  if (!byKey.has(key)) byKey.set(key, computeCarryDamage(c, active, team, buffs, noGleam, ampShare));
  return byKey.get(key)!;
}

function computeCarryDamage(
  c: ScoringCharacter,
  active: readonly Reaction[],
  team: readonly ScoringCharacter[],
  teamBuffs: TeamBuffStats,
  noGleam: boolean,
  ampShare = 1,
): CarryDamage | null {
  if (!CARRIES[c.id]) return null;
  const base = CARRIES[c.id];
  const usesFs = base.buffs.some((b) => "fightingSpirit" in b && b.fightingSpirit);
  const skillOnly = usesFs && fightingSpirit(c, c, team) === 0; // Mavuika can't Burst: Skill only (#126)
  const picked = pickCombo(base, c, active, team);
  const { kit, combo, reaction } = skillOnly ? { ...picked, kit: base, combo: `${(base.combo ?? "").replace(" Q", "")} (Skill only: can't Burst)` } : picked;
  const own = carryStats(c, kit.goblet);
  // Team buffs (#157): ATK (flat, and % of base ATK) and DMG bonus on top of the carry's own stats.
  const s = { ...own, atk: own.atk + teamBuffs.atk + teamBuffs.atkPct * own.baseAtk, dmgBonus: own.dmgBonus + teamBuffs.dmgBonus };
  const fsShare = kit.buffs.some((b) => "fightingSpirit" in b && b.fightingSpirit) ? fightingSpirit(c, c, team) / FIGHTING_SPIRIT_LIMIT : 1;
  let atk = s.atk;
  for (const b of kit.buffs) {
    if (b.kind === "atkFromHp") atk += Math.min(b.value * s.hp, b.capOfBase * s.baseAtk);
    if (b.kind === "atkPct") atk += b.value * s.baseAtk;
    if (b.kind === "atkFromDef") atk += b.value * s.def; // Noelle's Burst
  }
  const instancesOf = (types: HitType[]) =>
    kit.hits.filter((h) => types.includes(h.type)).reduce((a, h) => a + h.count * (h.instances ?? 1), 0);
  // Ascendant Gleam: two Moonsign members (each Moonsign Benediction raises the party's Moonsign by a level).
  const gleam = !noGleam && team.filter((m) => m.families?.includes("moonsign")).length >= 2;
  // Secret Rite: two Hexerei members, read from their families like Moonsign above (the scorer's Witch's Homework
  // option, score.ts familiesOf, doesn't reach the damage model).
  const secretRite = team.filter((m) => m.families?.includes("hexerei")).length >= 2;
  const fits = (w?: When) =>
    !w ||
    ((!w.reaction || active.includes(w.reaction)) && (!w.ascendantGleam || gleam) && (!w.secretRite || secretRite) &&
      (!w.noHealer || !team.some((m) => m !== c && healsInPlay(m))));
  const lands = (h: CarryHit) => fits(h.when);
  const buffs = kit.buffs.filter((b) => !("when" in b) || fits(b.when));
  // EM from ATK (Flins' passive 2), with or without a build: Enka's panel EM doesn't include it (#149: Jessie's Flins
  // shows 175.6 EM = 96 from substats + 80 from Night of the Sky's Unveiling 2pc). From his own ATK (build or
  // benchmark), not kit- or team-buffed ATK: KeqingMains' Flins guide says it "does not consider ATK buffs that
  // originate from a percentage of one character's stat".
  let em = s.em;
  for (const b of buffs) {
    if (b.kind === "emFromAtk") em += Math.min(b.max, b.value * own.atk); // own ATK: no team buffs (#157)
    if (b.kind === "emBonus") em += b.value; // Nefer at 3 Veil of Falsehood stacks (#148)
  }
  const amp = amplifyGain(c, em, active, reaction ?? mainReactionOf(c)) * ampShare;
  const catalyze = catalyzeDamage(c, em, active, reaction ?? mainReactionOf(c));
  // A hit of another damage type (#222): its own DMG Bonus (Physical: the build's; another element: none of the carry's),
  // the team buffs that reach that type (read as if it were the carry's element, so a Cryo-only buff skips Physical
  // hits), and its own reactions (Physical hits don't react). ATK and CRIT buffs reach every hit alike.
  // RES and DEF shred (#204): teammates' on the hits of the type they cover, and Superconduct's 40% Physical RES
  // (Genshin Impact Wiki, Superconduct, fetched 2026-10-16: "reduces the Physical RES of all enemies in the AoE by 40%
  // for 12 seconds"; while the team has it, taken as up throughout).
  const superconduct = active.includes("superconduct") ? 0.4 : 0;
  const byType = new Map<string, { bonus: number; flat: number; amp: number; catalyze: number; res: number; def: number }>();
  const typed = (el: Element | "Physical") => {
    if (el === c.element) return { bonus: s.dmgBonus, flat: teamBuffs.flat, amp, catalyze, res: teamBuffs.resShred, def: teamBuffs.defShred };
    let v = byType.get(el);
    if (!v) {
      const view = { ...c, element: el as Element };
      const tb = teamBuffs === NO_TEAM_BUFFS ? NO_TEAM_BUFFS : teamBuffStats(view, c.reactions.filter((r) => active.includes(r)), team);
      const r = reaction ?? mainReactionOf(c);
      const own = el === "Physical" ? s.physicalDmgBonus : 0;
      byType.set(el, (v = { bonus: own + tb.dmgBonus, flat: tb.flat, amp: amplifyGain(view, em, active, r), catalyze: catalyzeDamage(view, em, active, r), res: tb.resShred + (el === "Physical" ? superconduct : 0), def: tb.defShred }));
    }
    return v;
  };
  const stat = { atk, def: s.def, em };
  let lunarBase = 0;
  for (const b of buffs) if (b.kind === "lunarBaseBonus") lunarBase += Math.min(b.max, b.perPoint * stat[b.stat]);
  // Reaction DMG Bonus to direct Lunar hits (Flins' passive 1, #147): added to the EM bonus, as in the wiki formula.
  const lunarBonus = (r: LunarReaction) => buffs.reduce((a, b) => a + (b.kind === "lunarReactionBonus" && b.reaction === r ? b.value : 0), 0);
  // Base DMG Multiplier by hit label (Nefer's Veil of Falsehood, #148): multiplies the hit's base, Lunar or not.
  const baseMultiplier = (h: CarryHit) =>
    buffs.reduce((a, b) => a * (b.kind === "baseDmgMultiplier" && b.labels.includes(h.label) ? 1 + b.value : 1), 1);
  const rotationSeconds = rotationFor(kit, c, active, team);
  // The share of rotations the team's Energy lets them Burst in (#37, energy.ts); 1 for a carry scored alone.
  const burstPart = burstShare(c, team, c, rotationSeconds);
  // Teammates of the elements a hit converts to (#233): how many there are, and how many element types.
  const eligible = (els: readonly Element[]) => team.filter((m) => m.id !== c.id && els.includes(m.element));
  const typesOf = (els: readonly Element[]) => [...new Set(eligible(els).map((m) => m.element))];
  const at = (list: number[] | undefined, i: number) => (list?.length ? list[Math.min(i, list.length - 1)] : 0);
  const teamCount = (h: CarryHit) =>
    h.byTeammates ? at(h.byTeammates.members, eligible(h.byTeammates.elements).length) + at(h.byTeammates.types, typesOf(h.byTeammates.elements).length) : 0;
  const hitTotal = (h: CarryHit, el: Element | "Physical", count: number) => {
    let perHit = (h.scaling.atk ?? 0) * atk + (h.scaling.hp ?? 0) * s.hp + (h.scaling.def ?? 0) * s.def + (h.scaling.em ?? 0) * em;
    perHit *= baseMultiplier(h);
    const t = typed(el);
    // Shred as a ratio to the unshredded enemy (benchmark.ts: 10% RES, level 100), so every baseline stays put. Lunar
    // reaction DMG ignores DEF (wiki, Damage § Lunar: no DEF term) but not RES.
    const ownShred = kit.buffs.reduce((a, b) => a + (b.kind === "resShred" && b.elements.includes(el) && b.labels.includes(h.label) ? b.value : 0), 0);
    const resFactor = 1 + resShredGain(t.res + ownShred);
    const defFactor = 1 + defShredGain(Math.min(0.9, t.def));
    if (h.lunar) {
      if (h.additive) return perHit * count * resFactor;
      return LUNAR_COEFFICIENT[h.lunar] * perHit * count * (1 + lunarBase) * (1 + lunarEmBonus(em) + lunarBonus(h.lunar)) * resFactor;
    }
    if (!h.addOn) perHit += t.catalyze * (h.instances ?? 1) * reactingShare(h);
    // Additive Base DMG Bonus from teammates (Shenhe, Yun Jin): per hit instance, before DMG bonus and crit
    // (Genshin Impact Wiki, Damage § General Damage Formula).
    if (!h.addOn) perHit += t.flat * (h.instances ?? 1);
    let bonus = t.bonus;
    let factor = 1;
    for (const b of buffs) {
      if (b.kind === "addPerStack" && b.tag === h.tag) perHit += b.value * b.stacks * (b.fightingSpirit ? fsShare : 1) * (h.instances ?? 1) * (b.stat === "hp" ? s.hp : atk);
      if (b.kind === "flatAtk" && b.types.includes(h.type) && b.reactions.some((r) => active.includes(r)))
        perHit += Math.min(b.value * atk, b.cap) * (h.instances ?? 1); // per hit instance (Clorinde's Impale: 3)
      if (b.kind === "dmgBonus" && b.types.includes(h.type)) {
        const share = b.hitsCap ? Math.min(1, b.hitsCap / instancesOf(b.types)) : 1;
        bonus += b.value * share * (b.fightingSpirit ? fsShare : 1);
      }
      // Raiden's passive 2 is a stat conversion the character screen shows: an imported build's (Enka) DMG bonus
      // already includes it (Jessie's Raiden: 108.8% = 46.6% goblet + 0.4 x 155.6 ER), so only the benchmark gets it (#161).
      if (b.kind === "dmgBonusFromEr" && !c.stats) bonus += b.perPercent * Math.max(0, (s.er - 1) * 100);
      if (b.kind === "dmgBonusPerEm" && b.labels.includes(h.label)) bonus += Math.min(b.max, b.perEm * em);
      if (b.kind === "dmgBonusByTypes" && b.labels.includes(h.label)) bonus += at([0, ...b.values], typesOf(b.elements).length);
      if (b.kind === "factor" && b.types.includes(h.type)) factor *= b.value;
      // CRIT Rate for some hits only (Ganyu's passive 1): their expected crit over the one applied to every hit below.
      if (b.kind === "critRate" && b.labels.includes(h.label))
        factor *= expectedCrit(c, teamBuffs.critRate + b.value) / expectedCrit(c, teamBuffs.critRate);
      if (b.kind === "factorByReactions" && b.types.includes(h.type)) {
        const stacks = Math.min(b.values.length, b.reactions.filter((r) => active.includes(r)).length);
        if (stacks > 0) factor *= b.values[stacks - 1]; // Neuvillette's passive 1: one stack per kind of reaction
      }
    }
    return perHit * count * (1 + bonus) * factor * (1 + reactingShare(h) * t.amp) * resFactor * defFactor;
  };
  let total = 0;
  for (const h of kit.hits) {
    if (fsShare === 0 && h.type === "burst") continue; // can't Burst without the Fighting Spirit
    if (!lands(h)) continue;
    const count = (h.count + teamCount(h)) * (h.type === "burst" ? burstPart : 1);
    if (count <= 0) continue;
    if (h.element !== "teammates") total += hitTotal(h, h.element ?? c.element, count);
    else {
      const types = typesOf(h.byTeammates?.elements ?? []);
      for (const el of types) total += hitTotal(h, el, count / types.length);
    }
  }
  // Masque of the Red Death: each Normal Attack hit adds ATK x ratio x Bond of Life %, and uses `use` of it.
  for (const b of kit.buffs) {
    if (b.kind !== "masque") continue;
    const n = instancesOf(["normal"]);
    const bondSum = (b.start * (1 - Math.pow(1 - b.use, n))) / b.use;
    total += b.ratio * bondSum * atk * (1 + s.dmgBonus) * (1 + AMPLIFY_SHARE * amp) * (1 + resShredGain(teamBuffs.resShred)) * (1 + defShredGain(Math.min(0.9, teamBuffs.defShred)));
  }
  total *= expectedCrit(c, teamBuffs.critRate);
  return { perSecond: total / rotationSeconds, ...(combo ? { combo } : {}), rotationSeconds, missing: kit.missing ?? [], em };
}
