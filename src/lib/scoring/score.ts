import type { EffectTag } from "../../types/effects";
import { type Buff, type CompositionPref, type Role, type Talent } from "../../types/tags";
import { effectKey, effectLabel, isDraft } from "./effects";
import { canTrigger, mainReactionOf, reactionElements, reactionShare } from "./reactions";
import { energyCheck, energyNeeds, erTargetOf } from "./energy";
import { generateRotation } from "./rotation";
import { FIGHTING_SPIRIT_MIN, NO_TEAM_BUFFS, atkPctGain, baseAtkOf, fightingSpirit, fightingSpiritBuilt, kitBuffValue, memberBuffStats, normalAttacks, teamBuffStats } from "./kit";
import { amplifyGain, carryDamage, carryHitRates, carryRotationSeconds, catalyzeDamage, expectedCrit, lunarHit, modelsAscendantGleam, modelsReaction, passiveEnabler, type LunarReaction } from "./damage";
import { BENCHMARK, critGain, dmgBonusGain, emGain, GAIN_FOR_POINTS, gainPoints, resShredGain, subDpsBenchmark } from "./benchmark";
import type { ScaleStat, SubDpsBase, SubDpsPriority, SubDpsStats } from "./benchmark";
import kitJson from "../../../data/kit.json";
import subDpsBuildsJson from "../../../data/subdps-builds.json";
import referenceJson from "../../../data/team-reference.json";
import type { Element, Family, Reaction, ScoreLine, ScoreOptions, ScoredTeam, ScoringCharacter } from "./types";

// Point values are starting guesses from the design doc; tune them against known-strong teams.
export const POINTS = {
  singleCarry: 20,
  noCarry: -30,
  extraOnField: -15,
  carryReactionWithSupport: 20,
  carryReactionFromElements: 10,
  extraPartner: 5, // each additional support enabling the main reaction (e.g. double Hydro)
  maxExtraPartners: 2,
  secondaryReaction: 5, // focused teams beat ones that spread across many reactions
  maxCountedReactions: 2,
  carryReactionsUnavailable: -10,
  supportReaction: 10,
  buffer: 10,
  // A buffer scores by the damage their kit adds: +20% = `buffer` points (benchmark.ts, #68). No cap since #90: reaction
  // bonuses are weighted by the carry's share (#87) and Furina's Fanfare is averaged, the overestimates it hid.
  maxBuffers: 2,
  hypercarryMaxBuffers: 3, // a hypercarry (mainReaction 'none') is built around buffers, not reactions
  survivability: 10,
  noSurvivability: -10,
  starvedBursts: -5, // per 20% of rotations a member can't Burst in, by the particle model (#37)
  ownAscendantGleam: 10, // a Moonsign carry's own kit upgrade at Ascendant Gleam (#63)
  ownSecretRite: 10, // a Hexerei carry's own kit upgrade at Hexerei: Secret Rite (#63)
  ownRadiance: 10, // a Stellar carry's own kit upgrade in Radiance (#63)
  ownNightsoulBurst: 10, // a Natlan carry's own kit upgrade from Nightsoul Bursts, at full stacks (#63)
  prefMet: 15, // the carry's own team preferences...
  onlyElementsBroken: -10,
  supportPrefMet: 5, // ...count for more than a support's (#43)
  supportPrefBroken: -5,
  idleAnemo: -10,
  // Build checks (only for members with imported or entered stats)
  cvBenchmark: 200, // CV = 2 × crit rate + crit DMG
  cvMinFactor: 0.6, // the carry's points scale by CV / benchmark, within these bounds
  cvMaxFactor: 1.2,
  lowEr: -5, // per burst-reliant member under their ER target
  emHigh: 600, // reaction-based members at or above this EM gain points...
  emLow: 300, // ...and lose them below this
  emPoints: 5,
  talentBenchmark: 9, // the carry's key talent and a buff's talent scale points by level / benchmark...
  talentMinFactor: 0.7, // ...within these bounds
  talentMaxFactor: 1.15,
  // effects.json (weapons, sets, constellations)
  effectBuff: 5, // per effect that buffs the carry
  maxEffectBuffs: 3,
  infusionConflict: -15, // another member's infusion overrides a melee carry's element
  splitCryoPlan: -15, // a Freeze/Melt carry with both Hydro and Pyro supports (#53)
} as const;

const RESONANCE: Record<Element, { points: number; name: string }> = {
  Pyro: { points: 10, name: "Fervent Flames (+25% ATK)" },
  Geo: { points: 10, name: "Enduring Rock" },
  Hydro: { points: 5, name: "Soothing Water" },
  Cryo: { points: 5, name: "Shattering Ice" },
  Electro: { points: 5, name: "High Voltage" },
  Dendro: { points: 5, name: "Sprawling Greenery" },
  Anemo: { points: 3, name: "Impetuous Winds" },
};

const label = (r: Reaction) => r.charAt(0).toUpperCase() + r.slice(1);

// Effect lines built on unreviewed effects.json entries say so (#23).
const effectName = (m: ScoringCharacter, e: EffectTag) => `${m.id} ${effectLabel(e)}${isDraft(e) ? " (draft)" : ""}`;

// The member's tags.json roles plus roles their items grant (Favonius weapons make a battery).
const roleEffect = (m: ScoringCharacter, role: Role) => m.effects?.find((e) => e.roles?.includes(role));
const hasRole = (m: ScoringCharacter, role: Role) => m.roles.includes(role) || !!roleEffect(m, role);

interface TeamContext {
  members: ScoringCharacter[];
  elements: Set<Element>;
  active: Reaction[];
  options: ScoreOptions;
  carryDps: Map<ScoringCharacter, number>; // carryDamagePerSecond, once per carry and team
}

const NO_FAMILIES: Family[] = [];

// A family that a quest unlocks counts only once the player has done it: Hexerei after Witch's Homework,
// Stellar (for characters who got it in an update) after Witch's Revelation.
function familiesOf(member: ScoringCharacter, options: ScoreOptions): Family[] {
  const families = member.families ?? NO_FAMILIES;
  const locked = (f: Family, unlocked: readonly string[] | undefined) =>
    families.includes(f) && !!unlocked && !unlocked.includes(member.id);
  const hexereiLocked = locked("hexerei", options.hexereiUnlocked);
  const stellarLocked = !!member.revelation && locked("stellar", options.revelationUnlocked);
  if (!hexereiLocked && !stellarLocked) return families;
  return families.filter((f) => !(f === "hexerei" && hexereiLocked) && !(f === "stellar" && stellarLocked));
}

// Runs for every team the search tries, so it sticks to plain loops (#4).
function buildContext(members: ScoringCharacter[], options: ScoreOptions): TeamContext {
  const elements = new Set<Element>();
  const listed: Reaction[] = [];
  for (const m of members) {
    elements.add(m.element);
    for (const r of m.reactions) if (!listed.includes(r)) listed.push(r);
  }
  const converted = new Set<Reaction>();
  for (const m of members) for (const r of m.converts ?? []) converted.add(r);
  const active = listed.filter((r) => canTrigger(r, elements, converted));
  return { members, elements, active, options, carryDps: new Map() };
}

// A support only partners a reaction if it brings an element the carry lacks (Bennett is not a Vaporize partner for Hu Tao).
function suppliesElement(support: ScoringCharacter, carry: ScoringCharacter, reaction: Reaction): boolean {
  return support.element !== carry.element && reactionElements(reaction).includes(support.element);
}

function mainReactionLines(carry: ScoringCharacter, r: Reaction, partners: ScoringCharacter[], out: Sink) {
  if (partners.length === 0) {
    out.add("Reactions", POINTS.carryReactionFromElements, () => `${label(r)} is possible for ${carry.id}`);
    return;
  }
  out.add("Reactions", POINTS.carryReactionWithSupport, () => `${label(r)}: ${carry.id} + ${partners.map((p) => p.id).join(", ")}`);
  const extra = Math.min(partners.length - 1, POINTS.maxExtraPartners);
  if (extra > 0) out.add("Reactions", extra * POINTS.extraPartner, () => `${extra + 1} supports enable ${label(r)}`);
}

// Collects a team's score lines. The search only needs the points, so reasons are passed as
// functions and only turned into text when the breakdown is kept (#4).
// A team scores by its damage (#202). Lines the damage model doesn't cover yet keep their points and turn them into a
// multiplier on team damage at the buffer rate, 2% per point (Jessie, 2026-10-15): their points add up, and team
// damage is multiplied by 1 + 2% x the total, never below x0.05. Additive, like the points they replace: compounding
// a line at a time took a typical team to x4-5, so these lines outweighed the damage itself. Each goes as its aspect
// gets modeled (#203-#208). Lines whose effect is already inside the damage (modeled reactions, sub-DPS hits, buffs
// in carry stats) say so with 0 points.
const POINT_GAIN = GAIN_FOR_POINTS / POINTS.buffer;

interface Sink {
  points: number;
  add(rule: string, points: number, reason: () => string): void;
  addAll(other: Sink): void;
}

const factorOf = (sink: Sink) => Math.max(0.05, 1 + sink.points * POINT_GAIN);

class Breakdown implements Sink {
  points = 0;
  lines: ScoreLine[] = [];
  add(rule: string, points: number, reason: () => string) {
    this.points += points;
    this.lines.push({ rule, points, reason: reason() });
  }
  addAll(other: Sink) {
    this.points += other.points;
    this.lines.push(...(other as Breakdown).lines);
  }
}

class Tally implements Sink {
  points = 0;
  add(_rule: string, points: number) {
    this.points += points;
  }
  addAll(other: Sink) {
    this.points += other.points;
  }
}

function carryLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry) {
    out.add("Carry", POINTS.noCarry, () => "No main DPS in the team");
    // Without a carry, reward reactions that at least two members build toward.
    const shared = ctx.active.filter((r) => ctx.members.filter((m) => m.reactions.includes(r)).length >= 2);
    for (const r of shared.slice(0, POINTS.maxCountedReactions)) {
      out.add("Reactions", POINTS.supportReaction, () => `${label(r)} from the supports`);
    }
    return;
  }

  const supports = ctx.members.filter((m) => m !== carry);
  const rivals = supports.filter((m) => m.fieldTime === "on");
  if (rivals.length === 0) {
    out.add("Carry", POINTS.singleCarry, () => `${carry.id} is the only on-field character`);
  } else {
    for (const r of rivals) out.add("Carry", POINTS.extraOnField, () => `${r.id} also wants field time`);
  }

  const main = mainReactionOf(carry);
  const partnersFor = (r: Reaction) => supports.filter((s) => s.reactions.includes(r) && suppliesElement(s, carry, r));
  // Reactions the carry's modeled damage covers score by the damage they add (#134); the flat points below are for
  // the rest (a carry not modeled yet, or a reaction the damage model doesn't cover yet, like Freeze or Lunar).
  const carryActive = carry.reactions.filter((r) => ctx.active.includes(r));
  const modeled = reactionDamageLine(ctx, carry, out);
  const flat = carryActive.filter((r) => !modeled.includes(r));
  const mainModeled = main !== undefined && main !== "none" && modelsReaction(carry, main);
  if (main !== "none" && !mainModeled && carry.reactions.length > 0 && carryActive.length === 0) {
    out.add("Reactions", POINTS.carryReactionsUnavailable, () => `${carry.id}'s reactions are not possible with this team`);
  }
  if (main === undefined) {
    const ranked = flat
      .map((r) => ({ r, partners: partnersFor(r) }))
      .sort((a, b) => b.partners.length - a.partners.length)
      .slice(0, POINTS.maxCountedReactions);
    ranked.forEach(({ r, partners }, i) => {
      if (i > 0 || modeled.length > 0) out.add("Reactions", POINTS.secondaryReaction, () => `${label(r)} as a secondary reaction`);
      else mainReactionLines(carry, r, partners, out);
    });
  } else {
    // Only the reaction the carry's teams are built around gets full points (#49).
    if (main !== "none" && !mainModeled && ctx.active.includes(main)) mainReactionLines(carry, main, partnersFor(main), out);
    for (const r of flat.filter((r) => r !== main).slice(0, POINTS.maxCountedReactions - 1)) {
      out.add("Reactions", POINTS.secondaryReaction, () => `${label(r)} as a secondary reaction`);
    }
  }

  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  const emUseful = usesEmReaction(carry, ctx);
  const maxBuffers = main === "none" ? POINTS.hypercarryMaxBuffers : POINTS.maxBuffers;
  // A modeled carry's damage already has the buffs teamBuffStats turns into stats (ATK, DMG Bonus, crit, flat DMG):
  // a buffer's line then scores only the rest of their kit (#202).
  const inDamage = modeledCarryDps(carry, ctx) !== null;
  // Every fitting buffer is scored, then the strongest count up to the cap (#60).
  const fitting: { id: string; points: number; inDamage: number; reason: () => string }[] = [];
  for (const s of supports.filter((m) => m.roles.includes("buffer"))) {
    // Anemo buffers (Kazuha, Sucrose) need something to swirl.
    if (s.element === "Anemo" && !swirlActive) continue;
    const misfits = (s.buffs ?? []).map((b) => buffMisfit(b, carry, ctx, emUseful));
    if (misfits.length > 0 && misfits.every((m) => m !== null)) {
      out.add("Buffs", 0, () => `${s.id}: ${misfits[0]!()}`);
      continue;
    }
    // A buff from a talent gets stronger with its level; scale by the first buff that fits.
    const fit = s.buffs?.[misfits.indexOf(null)];
    const talent = fit?.talent;
    const level = talent && talent !== "passive" ? s.talents?.[talent] : undefined;
    // How much the buff is worth comes from the kit's numbers (#68); without a readable value, standard points.
    const kit = kitBuffValue(s, carry, carryActive, ctx.members);
    if (kit && kit.gain <= 0) {
      // Mavuika under the 100 Fighting Spirit her Burst needs: say so, not "doesn't apply" (#126).
      const fs = s.id === "Mavuika" && fightingSpirit(s, carry, ctx.members) === 0 ? fightingSpiritBuilt(s, carry, ctx.members) : null;
      out.add("Buffs", 0, () =>
        fs !== null
          ? `Mavuika can't Burst: the team builds ~${Math.round(fs)} of ${FIGHTING_SPIRIT_MIN} Fighting Spirit`
          : `${s.id}: their kit's buff doesn't apply to ${carry.id}'s damage`,
      );
      continue;
    }
    const outside = kit && inDamage ? kitBuffValue(s, carry, carryActive, ctx.members, true)! : kit;
    const base = outside ? (POINTS.buffer * outside.gain) / GAIN_FOR_POINTS : POINTS.buffer;
    const counted = kit && outside && kit.gain - outside.gain >= 0.005 ? `, ~+${Math.round((kit.gain - outside.gain) * 100)}% of it in ${carry.id}'s damage` : "";
    const est = kit ? `~+${Math.round(kit.gain * 100)}% damage${counted}` : "";
    const detail = [est, level === undefined ? "" : `${talent} level ${level}`].filter(Boolean).join(", ");
    fitting.push({
      id: s.id,
      points: Math.round(base * talentFactor(level)),
      inDamage: kit && outside ? kit.gain - outside.gain : 0,
      reason: () => `${s.id} buffs ${carry.id}${detail ? ` (${detail})` : ""}`,
    });
  }
  // The strongest count their points, up to the cap. A buffer past it whose buff is in the carry's damage still
  // shows, with 0 points: team damage has every buffer (teamBuffStats has no cap).
  fitting.sort((a, b) => b.points - a.points || b.inDamage - a.inDamage);
  fitting.forEach((f, i) => {
    if (i < maxBuffers) out.add("Buffs", f.points, f.reason);
    else if (f.inDamage >= 0.005) out.add("Buffs", 0, f.reason);
  });

  effectBuffLines(ctx, carry, emUseful, out);
}

// Weapon, set and constellation buffs that fit the carry. The same effect on two members counts once.
function effectBuffLines(ctx: TeamContext, carry: ScoringCharacter, emUseful: boolean, out: Sink) {
  const seen: string[] = [];
  for (const m of ctx.members) {
    for (const e of m.effects ?? []) {
      if (seen.length === POINTS.maxEffectBuffs) return;
      // On the carry's own items, an 'active' buff only buffs the carry, which its final stats may already show.
      const fit = e.buffs?.find(
        (b) =>
          (m !== carry || b.scope === "team") &&
          !buffMisfit(b.holderElement ? { ...b, elements: [m.element] } : b, carry, ctx, emUseful),
      );
      if (!fit || seen.includes(effectKey(e))) continue;
      seen.push(effectKey(e));
      out.add("Effects", POINTS.effectBuff, () => `${effectName(m, e)}: ${fit.stat} for ${carry.id}`);
    }
  }
}

// A Cryo carry plays Freeze (with Hydro) or Melt (with Pyro). With both, Pyro breaks the Freeze and
// vaporizes the Hydro, so neither plan works fully (#53).
function cryoSplitLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry || carry.element !== "Cryo") return;
  if (!carry.reactions.includes("freeze") && !carry.reactions.includes("melt")) return;
  const hydro = ctx.members.filter((m) => m !== carry && m.element === "Hydro");
  const pyro = ctx.members.filter((m) => m !== carry && m.element === "Pyro");
  if (hydro.length === 0 || pyro.length === 0) return;
  const names = (ms: ScoringCharacter[]) => ms.map((m) => m.id).join(", ");
  out.add("Conflicts", POINTS.splitCryoPlan, () => `Hydro (${names(hydro)}) and Pyro (${names(pyro)}) split Freeze and Melt`);
}

const MELEE = new Set(["Sword", "Claymore", "Polearm"]);

// An infusion (C6 Bennett) turns a melee carry's attacks into its element.
function infusionLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry || !MELEE.has(carry.weapon)) return;
  for (const m of ctx.members) {
    if (m === carry) continue;
    for (const e of m.effects ?? []) {
      if (e.infusion && e.infusion !== carry.element) {
        out.add("Conflicts", POINTS.infusionConflict, () => `${effectName(m, e)} infuses ${carry.id}'s attacks with ${e.infusion}`);
      }
    }
  }
}

// Reactions whose damage does not grow with EM, so an EM buff does nothing for them.
const NO_EM_REACTIONS = new Set<Reaction>(["freeze", "crystallize", "quicken", "superconduct"]);

// Why a buff does not help this carry (as a function, so the text is only built when shown), or null if it does (#3).
function buffMisfit(buff: Buff, carry: ScoringCharacter, ctx: TeamContext, emUseful: boolean): (() => string) | null {
  if (buff.affects === "EM") {
    if (!carry.scalesOn?.includes("EM") && !emUseful) return () => `EM buff, but ${carry.id} has no reaction that uses EM`;
  } else if (buff.affects && carry.scalesOn && !carry.scalesOn.includes(buff.affects)) {
    return () => `${buff.affects} buff, but ${carry.id} scales on ${carry.scalesOn!.join("/")}`;
  }
  if (buff.elements && !buff.elements.includes(carry.element)) {
    return () => `${buff.elements!.join("/")} buff, but ${carry.id} is ${carry.element}`;
  }
  if (buff.reactions && !buff.reactions.some((r) => ctx.active.includes(r))) {
    return () => `buffs ${buff.reactions!.map(label).join("/")}, which this team does not trigger`;
  }
  // The team triggering the reaction is not enough: the carry has to deal it (#58).
  if (buff.reactions && !buff.reactions.some((r) => ctx.active.includes(r) && carry.reactions.includes(r))) {
    return () => `buffs ${buff.reactions!.map(label).join("/")}, which ${carry.id} does not deal`;
  }
  return null;
}

function compositionMet(pref: CompositionPref, ctx: TeamContext): boolean {
  const counts = new Map<Element, number>();
  for (const m of ctx.members) counts.set(m.element, (counts.get(m.element) ?? 0) + 1);
  const min = pref.minElements ?? {};
  for (const [el, n] of Object.entries(min)) {
    if ((counts.get(el as Element) ?? 0) < (n ?? 0)) return false;
  }
  if (pref.othersShareElement) {
    const others = ctx.members.filter((m) => !(m.element in min)).map((m) => m.element);
    if (others.length === 0 || new Set(others).size !== 1) return false;
  }
  if (pref.onlyElements && !ctx.members.every((m) => pref.onlyElements!.includes(m.element))) return false;
  if (pref.family) {
    const n = ctx.members.filter((m) => familiesOf(m, ctx.options).includes(pref.family!.family)).length;
    if (n < pref.family.min) return false;
  }
  return true;
}

function teamLines(ctx: TeamContext, out: Sink) {
  const { members } = ctx;

  const counts = new Map<Element, number>();
  for (const m of members) counts.set(m.element, (counts.get(m.element) ?? 0) + 1);
  for (const [el, n] of counts) {
    // Pyro, Hydro and Dendro buff one stat, so whether they help depends on the carry: carryResonanceLines adds them.
    if (n >= 2 && !(el in STAT_RESONANCE)) out.add("Resonance", RESONANCE[el].points, () => RESONANCE[el].name);
  }

  // Scored by coverage (#177): the share of the rotation a shield or healing over time is up (kit.json `sustain`,
  // duration / cooldown from the talent tables), across members as 1 - product(1 - coverage). Full coverage is the
  // flat `survivability` points the tag used to give. A member whose coverage can't be read (no duration in the kit:
  // Jean, Beidou...) or whose role comes from an effect counts as full, as before.
  const sustainers = members.filter((m) => hasRole(m, "healer") || hasRole(m, "shielder"));
  if (sustainers.length) {
    const coverage = 1 - sustainers.reduce((a, m) => a * (1 - (SUSTAIN[m.id]?.coverage ?? 1)), 1);
    const names = sustainers.map((m) => m.id).join(", ");
    out.add("Survivability", Math.round(POINTS.survivability * coverage), () => `${names} heal or shield ~${Math.round(coverage * 100)}% of the rotation`);
  } else out.add("Survivability", POINTS.noSurvivability, () => "No healer or shielder");

  const anemo = members.filter((m) => m.element === "Anemo");
  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  if (anemo.length >= 2 && !swirlActive) {
    out.add("Conflicts", POINTS.idleAnemo, () => "Two Anemo characters with nothing to swirl");
  }
}

// Resonances that raise one stat only help a carry who uses it (#51, #59): Fervent Flames +25% ATK,
// Soothing Water +25% HP, Sprawling Greenery +EM.
const STAT_RESONANCE: Partial<Record<Element, "ATK" | "HP" | "EM">> = { Pyro: "ATK", Hydro: "HP", Dendro: "EM" };

function carryResonanceLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  for (const [el, stat] of Object.entries(STAT_RESONANCE) as [Element, "ATK" | "HP" | "EM"][]) {
    if (ctx.members.filter((m) => m.element === el).length < 2) continue;
    const { name, points } = RESONANCE[el];
    // EM also helps a carry whose reactions grow with it.
    const helps = !carry?.scalesOn || carry.scalesOn.includes(stat) || (stat === "EM" && usesEmReaction(carry, ctx));
    if (helps) out.add("Resonance", points, () => name);
    else out.add("Resonance", 0, () => `${name}, but ${carry!.id} scales on ${carry!.scalesOn!.join("/")}`);
  }
}

const usesEmReaction = (carry: ScoringCharacter, ctx: TeamContext) =>
  carry.reactions.some((r) => ctx.active.includes(r) && !NO_EM_REACTIONS.has(r));

interface GleamValue {
  kind: "em" | "critRate" | "critDmg" | "resShred";
  value: number;
  elements?: string[];
  reactions?: string[];
}
type GleamEntry = { target: "self"; source: string } | { target: "party"; source: string; values: GleamValue[] };
const GLEAM = kitJson.ascendantGleam as Record<string, GleamEntry>;
// Shields and heals (#177): coverage is null when the kit has no duration to read (`missing`).
const SUSTAIN = kitJson.sustain as Record<string, { coverage: number | null; missing?: string }>;
const KIT_BUFFS = kitJson.characters as Record<
  string,
  { base: { atk: number } | null; buildFor?: { atk?: number }; buffs: { kind: string; value: number; threshold?: number; max?: number }[] }
>;

// Moonsign: Ascendant Gleam (#63). Each Moonsign member's "Moonsign Benediction" raises the party's Moonsign by
// 1 level, and Ascendant Gleam is level 2. What it unlocks comes from data/kit.json: a Moonsign carry's own kit
// upgrade (Flins, Nefer, Zibai...) counts as ownAscendantGleam; a support's numeric upgrade (Lauma's Lunar-Bloom
// crit, Illuga's EM, Linnea's extra Geo shred) counts by the damage it adds, when it fits the carry.
function ascendantGleamLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry) return;
  const moonsign = ctx.members.filter((m) => familiesOf(m, ctx.options).includes("moonsign"));
  if (moonsign.length < 2) return;
  // The carry's own upgrade. When their damage model has it (damage.ts modelsAscendantGleam: Zibai, Flins, Nefer), it
  // counts once, by the damage it adds (with vs without Ascendant Gleam, +20% = buffer points), and the flat line
  // drops (#150). Upgrades not modeled yet keep the flat points.
  if (moonsign.includes(carry) && GLEAM[carry.id]?.target === "self") {
    const share = carryAmpShare(ctx, carry);
    const withGleam = modelsAscendantGleam(carry.id) ? carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, false, share) : null;
    const without = withGleam ? carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, true, share) : null;
    if (withGleam && without && withGleam.missing.length === 0 && without.perSecond > 0) {
      const gain = withGleam.perSecond / without.perSecond - 1;
      const points = gainPoints(gain, POINTS.buffer);
      if (points > 0) out.add("Moonsign", points, () => `Ascendant Gleam adds ~+${Math.round(gain * 100)}% to ${carry.id}'s damage`);
    } else {
      out.add("Moonsign", POINTS.ownAscendantGleam, () => `Ascendant Gleam enhances ${carry.id}'s kit`);
    }
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  const usesEm = carry.scalesOn?.includes("EM") || usesEmReaction(carry, ctx);
  for (const m of moonsign) {
    const g = GLEAM[m.id];
    if (m === carry || g?.target !== "party") continue;
    const fits = g.values.filter(
      (v) => (!v.elements || v.elements.includes(carry.element)) && (!v.reactions || v.reactions.some((r) => dealt.includes(r as Reaction))),
    );
    // A value for some reactions (Lauma's Lunar-Bloom crit) only reaches that share of the carry's damage (#87).
    const sum = (kind: GleamValue["kind"]) =>
      fits.filter((v) => v.kind === kind).reduce((a, v) => a + v.value * (v.reactions ? reactionShare(carry, v.reactions, dealt) : 1), 0);
    // Linnea's extra Geo shred stacks on her base shred, so it is worth less than the same shred alone.
    const baseShred = KIT_BUFFS[m.id]?.buffs.filter((b) => b.kind === "resShred").reduce((a, b) => a + b.value, 0) ?? 0;
    const gain =
      (1 + critGain(sum("critRate"), sum("critDmg"))) * (1 + (usesEm ? emGain(sum("em")) : 0)) * (1 + resShredGain(sum("resShred"), baseShred)) - 1;
    const points = gainPoints(gain, POINTS.buffer);
    if (points > 0) out.add("Moonsign", points, () => `Ascendant Gleam: ${m.id} gives ${carry.id} ~+${Math.round(gain * 100)}% damage`);
  }
}

// A party buff from a family mechanic (Secret Rite, Stellar Radiance), read from data/kit.json.
interface PartyValue {
  kind: "dmgBonus" | "atkPct" | "em" | "reactionBonus" | "resShred" | "flatDmgFromAtk" | "ownAtkPct";
  value: number;
  max?: number;
  perDef?: number;
  base?: number;
  elements?: string[];
  reactions?: string[];
  teamReactions?: string[];
  hexereiOnly?: boolean;
  ownAttacks?: boolean;
  anyReaction?: boolean;
  perBurst?: { hits: number; cd: number };
  radiance?: Reaction; // Stellar: the Radiance it needs, on while the team has that reaction
  uptime: number | null;
}
type SecretRiteEntry = { target: "self"; source: string } | { target: "party"; source: string; values: PartyValue[] };
const SECRET_RITE = kitJson.secretRite as Record<string, SecretRiteEntry>;

// More ATK for a member whose buff grows with ATK above a threshold (Prune's Tolling Rally): the extra
// DMG bonus that buff then gives. ATK % is of base ATK (character + weapon; baseAtkOf).
function excessAtkBuffRaise(m: ScoringCharacter, atkPct: number): number {
  const kit = KIT_BUFFS[m.id];
  const buff = kit?.buffs.find((b) => b.kind === "dmgBonusFromExcessAtk");
  if (!kit?.base || !buff) return 0;
  const atk = m.stats?.atk ?? kit.buildFor?.atk ?? BENCHMARK.buffer.atk;
  const raise = baseAtkOf(m) * atkPct;
  const bonus = (a: number) => Math.min(buff.max!, buff.value * Math.max(0, a - buff.threshold!));
  return dmgBonusGain(bonus(atk + raise)) - dmgBonusGain(bonus(atk));
}

// What one party value adds to the carry's damage, or 0 when it can't help them.
function partyValueGain(v: PartyValue, m: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext, dealt: Reaction[]): number {
  if (v.radiance && !ctx.active.includes(v.radiance)) return 0;
  if (v.elements && !v.elements.includes(carry.element)) return 0;
  if (v.reactions && !v.reactions.some((r) => dealt.includes(r as Reaction))) return 0;
  if (v.teamReactions && !v.teamReactions.some((r) => ctx.active.includes(r as Reaction))) return 0;
  if (v.hexereiOnly && !familiesOf(carry, ctx.options).includes("hexerei")) return 0;
  if (v.ownAttacks && m.fieldTime === "off") return 0; // Mona's stacks need her own Normal Attacks
  if (v.anyReaction && dealt.length === 0) return 0;
  if (v.kind === "ownAtkPct") return excessAtkBuffRaise(m, v.value);
  const value = v.perDef ? Math.min(v.max ?? Infinity, (v.value * (m.stats?.def ?? BENCHMARK.buffer.def)) / v.perDef) : v.value;
  if (v.kind === "flatDmgFromAtk") {
    // Extra damage on the member's own hits each Burst cooldown (Nicole's Arcane Projections), against what the
    // carry deals in that time.
    const { hits, cd } = v.perBurst!;
    const extra = hits * v.value * (m.stats?.atk ?? BENCHMARK.buffer.atk);
    return (extra / (cd * BENCHMARK.carryHitsPerSecond * BENCHMARK.hitDamage)) * (v.uptime ?? 1);
  }
  const usesEm = carry.scalesOn?.includes("EM") || usesEmReaction(carry, ctx);
  // A reaction DMG bonus only reaches the share of the carry's damage that is that reaction (#87); for other kinds
  // `reactions` is just what turns the buff on (Venti's DMG after a Swirl).
  const g =
    v.kind === "reactionBonus"
      ? dmgBonusGain(value) * reactionShare(carry, v.reactions ?? [], dealt)
      : v.kind === "dmgBonus"
      ? dmgBonusGain(value)
      : v.kind === "atkPct"
        ? atkPctGain(carry, value)
        : v.kind === "em"
          ? usesEm
            ? emGain(value)
            : 0
          : resShredGain(value, v.base ?? 0);
  return g * (v.uptime ?? 1);
}

// Hexerei: Secret Rite (#63). With 2+ Hexerei members, each Hexerei member's "Hexerei: Secret Rite" text turns
// on (data/kit.json, from the Witch's Eve Rite passives in data/kit-overrides.json). A Hexerei carry's own kit
// upgrade (Klee, Lohen, Razor, Varka) counts as ownSecretRite; a member's party buff (Albedo, Sucrose, Fischl,
// Venti, Durin, Nicole, Prune) counts by the damage it adds to the carry. Some only reach Hexerei members (Albedo's
// Silver Isotoma, Sucrose's Large Wind Spirit, Nicole's Arcane Projections), so a Hexerei carry gets more.
function secretRiteLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry) return;
  const hexerei = ctx.members.filter((m) => familiesOf(m, ctx.options).includes("hexerei"));
  if (hexerei.length < 2) return;
  if (hexerei.includes(carry) && SECRET_RITE[carry.id]?.target === "self") {
    out.add("Hexerei", POINTS.ownSecretRite, () => `Secret Rite enhances ${carry.id}'s kit`);
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  for (const m of hexerei) {
    const entry = SECRET_RITE[m.id];
    if (m === carry || entry?.target !== "party") continue;
    const gain = partyValuesGain(entry.values, m, carry, ctx, dealt);
    const points = gainPoints(gain, POINTS.buffer);
    if (points > 0) out.add("Hexerei", points, () => `Secret Rite: ${m.id} gives ${carry.id} ~+${Math.round(gain * 100)}% damage`);
  }
}

// Values of one kind add up (Albedo's two Isotomas); different kinds multiply. Bonuses to different reactions
// are alternatives, since a hit is one reaction (Qiqi's Stellar-Conduct or Stellar Swirl bonus): the best counts.
function partyValuesGain(values: PartyValue[], m: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext, dealt: Reaction[]): number {
  const byKind = new Map<string, number>();
  for (const v of values) {
    const g = partyValueGain(v, m, carry, ctx, dealt);
    const key = v.kind === "reactionBonus" ? `${v.kind}|${v.reactions?.join(",") ?? ""}` : v.kind;
    byKind.set(key, (byKind.get(key) ?? 0) + g);
  }
  const best = new Map<string, number>();
  for (const [key, g] of byKind) {
    const kind = key.split("|")[0];
    best.set(kind, Math.max(best.get(kind) ?? 0, g));
  }
  let gain = 1;
  for (const g of best.values()) gain *= 1 + g;
  return gain - 1;
}

type StellarEntry =
  | { target: "self" | "own"; radiance: Reaction[]; note?: string; source: string }
  | { target: "party"; radiance: Reaction[]; source: string; values: PartyValue[] };
const STELLAR = kitJson.stellar as Record<string, StellarEntry>;

// Stellar Glimmer: Radiance (#63). Stellar members enter Radiance: Stellar-Conduct inside a Polestar Field (made by
// Stellar-Conduct) and Radiance: Stellar Swirl for 8s after a Stellar Swirl, so a Radiance is on while the team has
// that reaction. data/kit.json says what each one does: a Stellar carry's own kit upgrade (Sandrone, Vesna,
// Wriothesley, Cyno, Mizuki) counts as ownRadiance; a member's party buff (Alyosha, Qiqi, Vodyanitsa) by the damage it adds.
// Witch's Revelation characters count once their quest is done (familiesOf).
function stellarLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry) return;
  const stellar = ctx.members.filter((m) => familiesOf(m, ctx.options).includes("stellar"));
  const own = stellar.includes(carry) ? STELLAR[carry.id] : undefined;
  const on = own?.radiance.filter((r) => ctx.active.includes(r)) ?? [];
  if (own?.target === "self" && on.length > 0) {
    out.add("Stellar", POINTS.ownRadiance, () => `Radiance: ${on.map(label).join(", ")} enhances ${carry.id}'s kit`);
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  for (const m of stellar) {
    const entry = STELLAR[m.id];
    if (m === carry || entry?.target !== "party") continue;
    const gain = partyValuesGain(entry.values, m, carry, ctx, dealt);
    const points = gainPoints(gain, POINTS.buffer);
    if (points > 0) out.add("Stellar", points, () => `${m.id}'s Stellar buff gives ${carry.id} ~+${Math.round(gain * 100)}% damage`);
  }
}

type NightsoulBurstEntry =
  | { target: "own"; note: string; source: string }
  | { target: "self"; kind?: "atkPct"; value?: number; duration: number | null; maxStacks: number; source: string };
const NIGHTSOUL_BURST = kitJson.nightsoulBurst as {
  cooldownByNatlanese: Record<string, number>;
  notNatlanese: string[];
  characters: Record<string, NightsoulBurstEntry>;
};
const COOLDOWNS = Object.entries(NIGHTSOUL_BURST.cooldownByNatlanese).map(([n, s]) => [Number(n), s] as const);

// Seconds between Nightsoul Bursts with n Natlanese members; the largest listed count means "or more".
function nightsoulCooldown(n: number): number {
  const [, seconds] = COOLDOWNS.filter(([count]) => count <= n).reduce((a, b) => (b[0] > a[0] ? b : a));
  return seconds;
}
const FASTEST_NIGHTSOUL = Math.min(...COOLDOWNS.map(([, s]) => s));

// Nightsoul Burst (#63). A party with a Natlanese member triggers one whenever someone deals Elemental DMG, at most
// once per cooldown (18s with 1 Natlanese member, 12s with 2, 9s with 3 or more; data/kit.json). Every effect it
// triggers is that character's own, so only the carry's counts: Mavuika's and Varesa's ATK by the damage it adds,
// Kinich's, Mualani's and Chasca's kit upgrade as ownNightsoulBurst. Either way, by how much of it a faster cooldown
// keeps up: average stacks (each lasts `duration`, up to maxStacks) or, for a one-off like Chasca's shot, how often.
function nightsoulBurstLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  const entry = carry && NIGHTSOUL_BURST.characters[carry.id];
  if (!carry || entry?.target !== "self") return;
  const natlanese = ctx.members.filter(
    (m) => familiesOf(m, ctx.options).includes("nightsoul") && !NIGHTSOUL_BURST.notNatlanese.includes(m.id),
  ).length;
  if (natlanese === 0) return;
  const cd = nightsoulCooldown(natlanese);
  const stacks = entry.duration === null ? FASTEST_NIGHTSOUL / cd : Math.min(entry.maxStacks, entry.duration / cd);
  const share = stacks / entry.maxStacks;
  const every = `Nightsoul Burst every ${cd}s (${natlanese} Natlan)`;
  if (entry.kind === "atkPct") {
    const gain = atkPctGain(carry, entry.value! * stacks);
    const points = gainPoints(gain, POINTS.buffer);
    if (points > 0) out.add("Nightsoul", points, () => `${every}: ${carry.id} ~+${Math.round(gain * 100)}% damage`);
  } else {
    const points = Math.round(POINTS.ownNightsoulBurst * share);
    if (points > 0) out.add("Nightsoul", points, () => `${every} powers ${carry.id}'s kit (${Math.round(share * 100)}%)`);
  }
}

interface SubDpsSource {
  label: string;
  scaling: { atk?: number; hp?: number; def?: number; em?: number };
  hits?: number;
  every?: number;
  duration?: number;
  onCarryNormal?: boolean;
  needsReaction?: boolean;
  times?: number;
  timesNeedsHealer?: boolean;
  lunar?: LunarReaction; // direct Lunar reaction DMG (#151)
  whenReaction?: Reaction; // only while the team triggers it
  when?: { ascendantGleam?: boolean; reaction?: Reaction }; // like a carry hit's `when` (Jahoda's robots, #100)
  // Other rates for teams that fit: the first whose `when` matches replaces hits/every/duration (Jahoda, #175).
  alternatives?: { when: { topElement?: Element }; hits?: number; every?: number; duration?: number }[];
  dmgBonusPerStat?: Partial<Record<ScaleStat, number>>; // DMG Bonus per point of a stat (Dendro Traveler, #172)
  icd?: "none" | { reset: number; every: number | "first" }; // elemental application ICD (#190); default standard
  pickOne?: string; // one source of the group per use, picked by the team's reactions
  talent?: string; // the talent the hit is from: "burst" hits need the Burst's Energy (#37)
  cd: number;
}
// lunarBaseBonus: their own Moonsign Benediction's Base DMG bonus to their direct Lunar hits (PR #155; Ineffa,
// Columbina). Teammates' bonuses to them stay with #88.
type SubDpsLunarBase = { stat: "atk" | "hp" | "def" | "em"; perPoint: number; max: number; reactions: LunarReaction[] };
// base: level 90 character base stats from genshin-db, for the benchmark build (#158).
type SubDpsEntry = { base: SubDpsBase | null; sources: SubDpsSource[]; missing?: string[]; lunarBaseBonus?: SubDpsLunarBase };
const SUB_DPS = kitJson.subDps as Record<string, SubDpsEntry>;

// Each sub-DPS's KQM stat priority for the benchmark build's substats (#164/#165).
const SUB_DPS_BUILDS = (subDpsBuildsJson as unknown as { characters: Record<string, SubDpsPriority & { quote: string }> }).characters;

// Their ER requirement for the benchmark build (#173): their erTarget (#21) when their KQM stat priority puts ER first
// ("ER (until requirement) > ...", after any "Stat Priority:" label); else none.
function erFirstTarget(m: ScoringCharacter): number | undefined {
  const quote = SUB_DPS_BUILDS[m.id]?.quote.replace(/^[^:]*:\s*/, "").replace(/^\(/, "");
  const target = erTargetOf(m);
  return quote?.startsWith("ER") && target !== undefined ? target / 100 : undefined;
}

// The stat a sub-DPS's benchmark build is for: the first of their hand-tagged scalesOn (Jessie, #167, from their KQM
// quick guide), else (#158) EM if any hit uses it, else the stat with the largest summed coefficient.
function scaleStatOf(m: ScoringCharacter, entry: SubDpsEntry): ScaleStat {
  const tagged = m.scalesOn?.[0];
  if (tagged) return tagged.toLowerCase() as ScaleStat;
  const sum = { atk: 0, hp: 0, def: 0, em: 0 };
  for (const s of entry.sources) for (const k of ["atk", "hp", "def", "em"] as const) sum[k] += s.scaling[k] ?? 0;
  if (sum.em > 0) return "em";
  return (["atk", "hp", "def"] as const).reduce((a, b) => (sum[b] > sum[a] ? b : a));
}

// A sub-DPS's stats: their build's, else a KQM Standards benchmark build for the stat they scale on (benchmark.ts,
// #158). Their crit feeds #152's expected crit in subDpsLines.
export function subDpsStats(m: ScoringCharacter): SubDpsStats | null {
  const entry = SUB_DPS[m.id];
  if (!entry) return null;
  if (m.stats) {
    const s = m.stats;
    return { atk: s.atk, hp: s.hp, def: s.def, em: s.elementalMastery, critRate: s.critRate / 100, critDmg: s.critDmg / 100, dmgBonus: s.elementalDmgBonus / 100, er: s.energyRecharge / 100 };
  }
  if (entry.base) return subDpsBenchmark(entry.base, scaleStatOf(m, entry), SUB_DPS_BUILDS[m.id], m.element, erFirstTarget(m));
  const b = BENCHMARK.buffer;
  const { carryCritRate: critRate, carryCritDmg: critDmg, subDpsDmgBonus: dmgBonus } = BENCHMARK;
  return { atk: b.atk, hp: b.hp, def: b.def, em: b.em, critRate, critDmg, dmgBonus };
}

// The element with the most party members among Pyro, Hydro, Electro and Cryo, ties going in that order (Jahoda's
// passive 1, #175); undefined with none of them.
const TOP_ELEMENT_ORDER = ["Pyro", "Hydro", "Electro", "Cryo"] as const;
export function topElement(members: readonly ScoringCharacter[]): Element | undefined {
  let top: Element | undefined;
  let most = 0;
  for (const e of TOP_ELEMENT_ORDER) {
    const n = members.filter((m) => m.element === e).length;
    if (n > most) [top, most] = [e, n];
  }
  return top;
}

// Hits per second of one source, averaged over its cooldown; 0 when it can't fire in this team.
function hitsPerSecond(source: SubDpsSource, carry: ScoringCharacter, ctx: TeamContext, sub: ScoringCharacter): number {
  const alt = source.alternatives?.find((a) => !a.when.topElement || a.when.topElement === topElement(ctx.members));
  const s = alt ? { ...source, ...alt, when: source.when } : source;
  if (s.onCarryNormal && !normalAttacks(carry)) return 0; // Xingqiu's rain swords need the carry's Normal Attacks
  if (s.needsReaction && ctx.active.length === 0) return 0; // Nahida's Tri-Karma needs a reaction
  if (s.whenReaction && !ctx.active.includes(s.whenReaction)) return 0; // Ineffa's Overclocking Circuit: thunderclouds
  // A source's `when`, as for carry hits (damage.ts): Ascendant Gleam is two Moonsign members (Jahoda's robots, #100).
  if (s.when?.reaction && !ctx.active.includes(s.when.reaction)) return 0;
  if (s.when?.ascendantGleam && ctx.members.filter((m) => m.families?.includes("moonsign")).length < 2) return 0;
  const perUse = s.every !== undefined ? Math.min(s.duration!, s.cd) / s.every : 1;
  // Furina's Salon bonus needs members above 50% HP, which takes another healer (#130).
  const healed = ctx.members.some((m) => m !== sub && m.roles.includes("healer"));
  const times = s.timesNeedsHealer && !healed ? 1 : (s.times ?? 1);
  return ((s.hits ?? 1) * perUse * times) / s.cd;
}

// For each `pickOne` group, the source that fires (#151): Columbina's Gravity Interference takes the type of the Lunar
// reaction that built the most Gravity. Read as the carry's main reaction when the team triggers it, else the first
// active one in kit order.
function pickedSources(sources: SubDpsSource[], carry: ScoringCharacter, ctx: TeamContext): Map<string, SubDpsSource> {
  const out = new Map<string, SubDpsSource>();
  const main = mainReactionOf(carry);
  for (const s of sources) {
    if (!s.pickOne || (s.whenReaction && !ctx.active.includes(s.whenReaction))) continue;
    if (!out.has(s.pickOne) || s.whenReaction === main) out.set(s.pickOne, s);
  }
  return out;
}

// Reactions on a sub-DPS's own hits (#153): Vaporize and Melt multiply them, Spread and Aggravate add flat damage,
// with the carry's formulas (damage.ts amplifyGain, catalyzeDamage) at the sub-DPS's EM. A reaction counts when the
// team triggers it, the sub-DPS's element is one of its two, and another member brings the other (Xingqiu's swords
// with Hu Tao, Xiangling with Xingqiu, Fischl's Oz with Nahida). Each hit takes the one that adds the most.
// Transformative reactions (Overloaded, Electro-Charged, Swirl...) and Lunar ones (#145) aren't counted here yet.
const SUB_DPS_REACTIONS: Reaction[] = ["vaporize", "melt", "aggravate", "spread"];
// Which hits react: only those that apply their element (#190). A source's ICD is kit.json's `icd` (Genshin Impact
// Wiki, Internal Cooldown/Data, fetched 2026-10-14), else the standard "2.5 seconds or 3 hits": a hit applies when the
// timer has run out or it is the counter's next one, so the share is the larger of 1/every and gap/reset (capped at
// 1). "first": only the timer. "none": every hit. Hits of one use without an interval (Aino's Water Balls) are taken
// as close together, at least one applying per use. ICDs shared between two sources (Escoffier's Skill and Parfaits)
// are counted separately (slight overcount).
const STANDARD_ICD = { reset: 2.5, every: 3 } as const;
function appliedShare(s: SubDpsSource): number {
  if (s.icd === "none") return 1;
  const { reset, every } = s.icd ?? STANDARD_ICD;
  const n = s.hits ?? 1;
  const counter = every === "first" ? 0 : 1 / every;
  const timer = s.every === undefined ? 1 / n : Math.min(1, s.every / n / reset);
  return Math.min(1, Math.max(counter, timer));
}

// The aura budget for Vaporize and Melt on sub-DPS hits (#189, #191). The two elements can't coexist as auras, so every
// reaction takes its aura from the other element's applications (Elemental Gauge Theory, KQM Library, fetched
// 2026-10-14). Supply: the other element's applications per second from the rest of the team (sub-DPS sources at
// their ICD share, the carry's hits at the standard ICD), each taken as 1U (most off-field sources are 1U: KQM's
// Elemental Gauges compendium), leaving 0.8U ("Aura Tax"). Each reaction uses 2U when the trigger is the strong side
// (Hydro on Pyro, Pyro on Cryo: "2x unit modifier") and 0.5U when weak. The carry's own reacting hits on the same aura
// are served first, as far as the aura reaches, and the applications that fed them can't react (#239); the sub-DPS share
// what's left. Members without a sub-DPS entry (Bennett) add no supply
// (estimate). Spread and Aggravate don't use this budget: the Quicken aura isn't consumed the same way.
const AMPLIFYING: Partial<Record<Reaction, Element>> = { vaporize: "Hydro", melt: "Pyro" }; // the strong-side trigger
function applicationsPerSecond(x: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext): number {
  if (x === carry) {
    const rates = carryHitRates(carry, ctx.active, ctx.members);
    if (!rates) return 0;
    const h = rates.hitsPerSecond;
    return Math.max(h / STANDARD_ICD.every, Math.min(h, 1 / STANDARD_ICD.reset));
  }
  const entry = SUB_DPS[x.id];
  if (!entry) return 0;
  const picked = pickedSources(entry.sources, carry, ctx);
  return entry.sources
    .filter((s) => !s.lunar && (!s.pickOne || picked.get(s.pickOne) === s))
    .reduce((a, s) => a + hitsPerSecond(s, carry, ctx, x) * appliedShare(s), 0);
}
// For each sub-DPS, the share of its applying hits that find an aura, per amplifying reaction. One budget for the
// whole team: each application either reacts (as a trigger) or lays an aura, never both (Durin's Pyro vaporizing
// Columbina's Hydro can't also lay Pyro for Escoffier to melt), and an element's aura is shared by every reaction
// triggered on it. Each (trigger, aura) pair asks for its applying hits; when an aura falls short, the pairs on it get
// the same fraction of what they asked. Damped rounds settle it. The carry's reacting hits are served first within
// their pair.
function auraShares(ctx: TeamContext, carry: ScoringCharacter): Map<ScoringCharacter, Map<Reaction, number>> {
  return auraBudget(ctx, carry).subs;
}
// The share of the carry's own Vaporize or Melt hits their pair's aura feeds (#239); 1 when nothing else claims it.
function carryAmpShare(ctx: TeamContext, carry: ScoringCharacter): number {
  return auraBudget(ctx, carry).carry;
}
const budgetCache = new WeakMap<TeamContext, Map<ScoringCharacter, { subs: Map<ScoringCharacter, Map<Reaction, number>>; carry: number }>>();
function auraBudget(ctx: TeamContext, carry: ScoringCharacter) {
  let byCarry = budgetCache.get(ctx);
  if (!byCarry) budgetCache.set(ctx, (byCarry = new Map()));
  if (!byCarry.has(carry)) byCarry.set(carry, computeAuraBudget(ctx, carry));
  return byCarry.get(carry)!;
}
function computeAuraBudget(ctx: TeamContext, carry: ScoringCharacter) {
  const out = new Map<ScoringCharacter, Map<Reaction, number>>();
  const apps = new Map<Element, number>();
  for (const x of ctx.members) apps.set(x.element, (apps.get(x.element) ?? 0) + applicationsPerSecond(x, carry, ctx));
  const full = new Map(apps);
  const perAuraOf = (r: Reaction, trigger: Element) => 0.8 / (trigger === AMPLIFYING[r] ? 2 : 0.5);
  const active = (Object.keys(AMPLIFYING) as Reaction[]).filter((r) => ctx.active.includes(r));
  // The carry first (#239): teammates' applications of the other element lay the aura their reacting hits need, and an
  // application spent that way can't react itself; the carry's reacting hits lay none of the carry's element. The rest
  // of both elements is what the sub-DPS share below. (Before, the carry kept a flat share whatever the aura, so Klee's
  // Vaporize and Columbina's, on each other's aura, both counted in full.)
  let carryShare = 1;
  const own = carryHitRates(carry, ctx.active, ctx.members);
  if (own && active.includes(own.reaction as Reaction) && reactionElements(own.reaction as Reaction).includes(carry.element)) {
    const r = own.reaction as Reaction;
    const [a, b] = reactionElements(r);
    const aura = carry.element === a ? b : a;
    const demand = Math.min(own.reactingPerSecond, applicationsPerSecond(carry, carry, ctx));
    if (demand > 0) {
      const perAura = perAuraOf(r, carry.element);
      const reactions = Math.min(demand, (apps.get(aura) ?? 0) * perAura);
      carryShare = reactions / demand;
      apps.set(aura, (apps.get(aura) ?? 0) - reactions / perAura);
      apps.set(carry.element, (apps.get(carry.element) ?? 0) - reactions);
    }
  }
  // Each (trigger, aura) pair of sub-DPS asks for its applying hits, as many as its element has left; when an aura falls
  // short, the pairs on it get the same fraction of what they asked. Damped rounds settle it.
  const pairs: { r: Reaction; trigger: Element; aura: Element; perAura: number; subs: ScoringCharacter[]; asked: number; demand: number; reactions: number }[] = [];
  for (const r of active) {
    const [a, b] = reactionElements(r);
    for (const trigger of [a, b]) {
      const subs = ctx.members.filter((m) => m !== carry && m.element === trigger && SUB_DPS[m.id]);
      const asked = subs.reduce((s, m) => s + applicationsPerSecond(m, carry, ctx), 0);
      const left = (full.get(trigger) ?? 0) > 0 ? Math.max(0, apps.get(trigger) ?? 0) / full.get(trigger)! : 0;
      if (asked > 0) pairs.push({ r, trigger, aura: trigger === a ? b : a, perAura: perAuraOf(r, trigger), subs, asked, demand: asked * left, reactions: 0 });
    }
  }
  for (let i = 0; i < 12; i++) {
    for (const p of pairs) {
      const on = pairs.filter((q) => q.aura === p.aura);
      // The aura's element: its applications left minus those that reacted as triggers themselves.
      const laid = Math.max(0, (apps.get(p.aura) ?? 0) - pairs.filter((q) => q.trigger === p.aura).reduce((s, q) => s + q.reactions, 0));
      const needed = on.reduce((s, q) => s + q.demand / q.perAura, 0); // aura applications all of them would use
      const scale = needed > 0 ? Math.min(1, laid / needed) : 0;
      p.reactions = (p.reactions + p.demand * scale) / 2;
    }
  }
  for (const p of pairs) {
    const share = Math.min(1, p.reactions / p.asked);
    for (const m of p.subs) {
      if (!out.has(m)) out.set(m, new Map());
      out.get(m)!.set(p.r, share);
    }
  }
  return { subs: out, carry: carryShare };
}
function subDpsReactions(m: ScoringCharacter, ctx: TeamContext): Reaction[] {
  return SUB_DPS_REACTIONS.filter((r) => {
    if (!ctx.active.includes(r)) return false;
    const els = reactionElements(r);
    if (!els.includes(m.element)) return false;
    return ctx.members.some((x) => x !== m && x.element !== m.element && els.includes(x.element));
  });
}

// The carry's own damage per second (damage.ts, #101), or null when it isn't modeled yet: no kit data, or hits still
// missing. An undercounted carry (Flins, 748/s) would make every sub-DPS look several times bigger.
// `reactions: false` reads it as if the team triggered no reactions (#134); `buffs` adds the team's kit buffs (#157).
function modeledCarryDps(carry: ScoringCharacter, ctx: TeamContext, reactions = true, buffs = NO_TEAM_BUFFS): number | null {
  const own = carryDamage(carry, reactions ? ctx.active : [], ctx.members, buffs, false, reactions ? carryAmpShare(ctx, carry) : 1);
  return own && own.missing.length === 0 ? own.perSecond : null;
}

// The reactions the damage model covers (damage.ts modelsReaction) are inside the carry's damage (#134, #202); these
// lines say what they add, with 0 points. They replace the flat reaction points (main reaction, extra partners,
// secondary reactions) for those reactions; returns them, empty for a carry not modeled yet. Without reactions the
// carry plays their default combo (#114). Both readings include the team's kit buffs (#157).
function reactionDamageLine(ctx: TeamContext, carry: ScoringCharacter, out: Sink): Reaction[] {
  const covered = ctx.active.filter((r) => modelsReaction(carry, r));
  if (covered.length === 0) return covered;
  const buffs = teamBuffStats(carry, carry.reactions.filter((r) => ctx.active.includes(r)), ctx.members);
  const withReactions = modeledCarryDps(carry, ctx, true, buffs);
  let without = modeledCarryDps(carry, ctx, false, buffs);
  if (withReactions === null || without === null) return [];
  // A passive that any of several reactions switches on (Clorinde's, #141) scores on its own line, at full value when
  // the team has one of them; the reaction line then scores only what the reactions add on top.
  const enabler = passiveEnabler(carry, ctx.active);
  const passiveOn = enabler ? carryDamage(carry, [enabler], ctx.members, buffs) : null;
  if (passiveOn && passiveOn.missing.length === 0) {
    const passiveGain = passiveOn.perSecond / without - 1;
    if (passiveGain >= 0.01) {
      out.add("Reactions", 0, () => `Any ${carry.element}-related reaction enables ${carry.id}'s passive: ~+${Math.round(passiveGain * 100)}% damage`);
    }
    without = passiveOn.perSecond;
  }
  const gain = withReactions / without - 1;
  if (gain >= 0.01) {
    const verb = covered.length === 1 ? "adds" : "add";
    const onTop = passiveOn ? ", on top of the passive" : "";
    out.add("Reactions", 0, () => `${covered.map(label).join(", ")} ${verb} ~+${Math.round(gain * 100)}% to ${carry.id}'s damage${onTop}`);
  }
  return covered;
}

// Off-field sub-DPS (#96): the damage per second of their own hits, from data/kit.json `subDps` (talent level 9),
// added to the carry's in team damage (#202): the carry keeps attacking while they fire. No longer a share of the
// carry's damage, which made the same hits worth 2-3x more next to a reaction carry (#199).
// Their stats, crit included, come from their build, else a KQM Standards benchmark build (subDpsStats, #158/#152).
// Enemy RES is left out, as on the carry's side; reactions on their hits count from #153 (subDpsReactions); teammates'
// party-wide kit buffs from #204 (memberBuffStats).
// Returns their total, and the sub-DPS who out-damages the carry, if one does: the team is really theirs (#96).
function subDpsLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink): { lead: ScoringCharacter | null; dps: number } {
  if (!carry) return { lead: null, dps: 0 };
  const carryDps = carryDamagePerSecond(carry, ctx); // who out-damages whom
  let total = 0;
  let lead: { m: ScoringCharacter; dps: number } | null = null;
  const needs = energyNeeds(ctx.members, carry, carryRotationSeconds(carry, ctx.active, ctx.members));
  const auras = auraShares(ctx, carry);
  for (const m of ctx.members) {
    const entry = SUB_DPS[m.id];
    if (m === carry || !entry) continue;
    const stat = subDpsStats(m)!;
    const dmgBonus = stat.dmgBonus;
    // Base ATK, for teammates' ATK% buffs: the build's, else the character's plus the benchmark weapon's.
    const baseAtk = m.stats?.baseAtk ?? (entry.base ? entry.base.atk + BENCHMARK.buffer.weaponBaseAtk : BENCHMARK.carryBaseAtk);
    let dps = 0;
    let lunarDps = 0;
    const picked = pickedSources(entry.sources, carry, ctx);
    // Burst hits only in the rotations the team's Energy funds (#37).
    const burstPart = needs.get(m)?.share ?? 1;
    const own = entry.lunarBaseBonus;
    const lunarBase = (r: LunarReaction) => (own && own.reactions.includes(r) ? Math.min(own.max, own.perPoint * stat[own.stat]) : 0);
    const reactions = subDpsReactions(m, ctx);
    const reacted = new Set<Reaction>();
    for (const s of entry.sources) {
      if (s.pickOne && picked.get(s.pickOne) !== s) continue;
      // Teammates' party-wide kit buffs on this hit (#204, kit.ts memberBuffStats): ATK, DMG Bonus, CRIT Rate, flat DMG.
      const team = memberBuffStats(m, carry, ctx.active, ctx.members, s.talent);
      const atk = stat.atk + team.atk + team.atkPct * baseAtk;
      const perHit = (s.scaling.atk ?? 0) * atk + (s.scaling.hp ?? 0) * stat.hp + (s.scaling.def ?? 0) * stat.def + (s.scaling.em ?? 0) * stat.em;
      // Direct Lunar hits crit too (wiki, Damage § Direct; #156), so expected crit applies to both.
      const crit = 1 + Math.min(stat.critRate + team.critRate, 1) * stat.critDmg;
      // Direct Lunar hits use the Lunar formula: no DMG Bonus term, EM bonus instead (damage.ts, #135/#151), with
      // their own Moonsign Benediction Base DMG bonus (PR #155).
      const rate = hitsPerSecond(s, carry, ctx, m) * (s.talent === "burst" ? burstPart : 1);
      if (s.lunar) lunarDps += lunarHit(s.lunar, perHit, stat.em, lunarBase(s.lunar)) * rate * crit;
      else {
        // Additive Base DMG Bonus from teammates (Shenhe's quills): per hit, before DMG Bonus and crit, as on the carry.
        const base = perHit + team.flat;
        // DMG Bonus per point of a stat on this hit (Dendro Traveler's 0.15% per EM, #172).
        const perStat = Object.entries(s.dmgBonusPerStat ?? {}).reduce((a, [k, v]) => a + v * stat[k as ScaleStat], 0);
        // A reacting hit (#153): the extra damage of the best reaction, on the hits that react.
        let extra = 0;
        let best: Reaction | null = null;
        // Each reaction's extra damage on this hit's reacting share: its applying hits (ICD), times the aura budget's
        // share for Vaporize and Melt (Spread and Aggravate: all applying hits).
        for (const r of reactions) {
          const share = appliedShare(s) * (AMPLIFYING[r] ? (auras.get(m)?.get(r) ?? 0) : 1);
          const add = share * (base * amplifyGain(m, stat.em, ctx.active, r) + catalyzeDamage(m, stat.em, ctx.active, r));
          if (add > extra) [extra, best] = [add, r];
        }
        if (best && extra >= 0.01 * base) reacted.add(best); // named only when it adds at least 1% to the hit
        dps += (base + extra) * rate * (1 + dmgBonus + team.dmgBonus + perStat) * crit;
      }
    }
    dps += lunarDps;
    total += dps;
    const withReactions = reacted.size ? `, with ${[...reacted].map(label).join(", ")}` : "";
    if (dps >= 1) out.add("Sub-DPS", 0, () => `${m.id}'s own hits: ~${Math.round(dps)} damage per second${withReactions}`);
    if (dps > carryDps && (!lead || dps > lead.dps)) lead = { m, dps };
  }
  if (lead) {
    const { m, dps } = lead;
    out.add("Carry", 0, () => `${m.id} out-damages ${carry.id} (~${Math.round(dps)} vs ~${Math.round(carryDps)} per second): ${m.id} is the main DPS`);
  }
  return { lead: lead?.m ?? null, dps: total };
}

// The carry's damage per second in team damage (#202): modeled, with the team's reactions and the kit buffs that
// read as carry stats (#157); else the generic benchmark carry (a non-crit hit) at their expected crit. Scaled by
// their key talent's level, which the damage model reads at 9.
function carryDamagePerSecond(carry: ScoringCharacter, ctx: TeamContext): number {
  const known = ctx.carryDps.get(carry);
  if (known !== undefined) return known;
  const buffs = teamBuffStats(carry, carry.reactions.filter((r) => ctx.active.includes(r)), ctx.members);
  const own = modeledCarryDps(carry, ctx, true, buffs);
  const generic = BENCHMARK.hitDamage * BENCHMARK.carryHitsPerSecond * expectedCrit(carry);
  const level = carry.keyTalent && carry.talents?.[carry.keyTalent];
  const dps = (own ?? generic) * talentFactor(level || undefined);
  ctx.carryDps.set(carry, dps);
  return dps;
}

// Team preferences: the carry's count fully; a support's describe what that support wants, so they count less (#43).
function prefLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  for (const m of ctx.members) {
    const own = m === carry;
    for (const pref of m.teamPrefs ?? []) {
      if (pref.kind === "partner") {
        const partner = ctx.members.find((p) => pref.ids.includes(p.id));
        if (partner) out.add("Team preference", own ? POINTS.prefMet : POINTS.supportPrefMet, () => `${m.id} with ${partner.id}`);
      } else if (compositionMet(pref, ctx)) {
        out.add("Team preference", own ? POINTS.prefMet : POINTS.supportPrefMet, () => `${m.id}: ${pref.note ?? "preferred team makeup"}`);
      } else if (pref.onlyElements && pref.onlyElements.length > 0) {
        const points = own ? POINTS.onlyElementsBroken : POINTS.supportPrefBroken;
        out.add("Team preference", points, () => `${m.id} wants only ${pref.onlyElements!.join("/")} teammates`);
      }
    }
  }
}

// Pure reaction carries (EM only, e.g. Kaveh) don't crit, so CV says nothing about them.
const usesCrit = (c: ScoringCharacter) => !(c.scalesOn?.length === 1 && c.scalesOn[0] === "EM");

// Level / benchmark within bounds; no level (no build, or a passive) = benchmark.
function talentFactor(level: number | undefined): number {
  if (level === undefined) return 1;
  return Math.min(Math.max(level / POINTS.talentBenchmark, POINTS.talentMinFactor), POINTS.talentMaxFactor);
}

// Says how the carry's key talent level scales their damage (carryDamagePerSecond). Their build's stats, crit
// included, are inside the damage itself, so the CV line is gone (#202): it scaled the carry's points, teammates'
// buffs included, so a stronger buffer could lower the score (found by the model checks, #201).
function carryTalentLine(carry: ScoringCharacter, out: Sink) {
  const talent: Talent | undefined = carry.keyTalent;
  const level = talent && carry.talents?.[talent];
  if (!level || talentFactor(level) === 1) return;
  out.add("Carry talent", 0, () => `${carry.id} ${talent} level ${level} vs ${POINTS.talentBenchmark} benchmark: ×${talentFactor(level).toFixed(2)} damage`);
}

// Members whose damage or buff comes from EM: Swirl buffers, Hyperbloom/Burgeon triggers, EM carries.
function emReliant(m: ScoringCharacter, carry: ScoringCharacter | null, ctx: TeamContext): boolean {
  if (m === carry) return !!m.scalesOn?.includes("EM");
  if (m.element === "Anemo" && m.roles.includes("buffer")) {
    return ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  }
  if (m.element === "Electro" || m.element === "Pyro") {
    return m.reactions.some((r) => (r === "hyperbloom" || r === "burgeon") && ctx.active.includes(r));
  }
  return false;
}

// Bursts the team's Energy can't fund every rotation (#37, energy.ts): starvedBursts points per 20% of rotations a
// member misses. Only for Bursts outside the damage model: the modeled carry's Burst hits and sub-DPS Burst sources
// already lose that share of their damage. This replaces the role-based battery lines: a battery now counts by
// keeping teammates' Bursts funded. A member with a build under their ER target is scored by statLines instead.
function energyLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  const seconds = carry ? carryRotationSeconds(carry, ctx.active, ctx.members) : undefined;
  for (const [m, e] of energyNeeds(ctx.members, carry, seconds)) {
    const modeled = m === carry ? seconds !== undefined : !!carry && SUB_DPS[m.id]?.sources.some((s) => s.talent === "burst");
    if (e.share >= 1 || modeled || (m.stats && m.stats.energyRecharge < e.target)) continue;
    const points = Math.round((POINTS.starvedBursts * (1 - e.share)) / 0.2);
    if (points < 0) {
      out.add("Energy", points, () => `${m.id} Bursts in ~${Math.round(e.share * 100)}% of rotations: needs ~${e.need}% ER here (${e.target}% target)`);
    }
  }
}

function statLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  for (const m of ctx.members) {
    if (!m.stats) continue;
    const { energyRecharge, elementalMastery: em } = m.stats;
    const target = erTargetOf(m);
    if (target !== undefined && energyRecharge < target) {
      out.add("Energy", POINTS.lowEr, () => `${m.id} ER ${energyRecharge}% vs ${target}% target`);
    }
    if (emReliant(m, carry, ctx)) {
      if (em >= POINTS.emHigh) {
        out.add("EM", POINTS.emPoints, () => `${m.id} has ${em} EM for reactions`);
      } else if (em < POINTS.emLow) {
        out.add("EM", -POINTS.emPoints, () => `${m.id} has ${em} EM; reactions want ${POINTS.emHigh}+`);
      }
    }
  }
}

// What keeps a character below the benchmark build the scorer assumes, as short reasons; empty = at or
// above it everywhere checked. No build entered = assumed at benchmark, so only a "not built" mark counts.
export function buildGaps(c: ScoringCharacter): string[] {
  const gaps: string[] = [];
  if (c.built === false) gaps.push("marked not built");
  if (c.stats) {
    const { critRate, critDmg, energyRecharge, elementalMastery: em } = c.stats;
    const cv = Math.round(2 * critRate + critDmg);
    if (c.roles.includes("main-dps") && usesCrit(c) && cv < POINTS.cvBenchmark) gaps.push(`CV ${cv} vs ${POINTS.cvBenchmark}`);
    const target = erTargetOf(c);
    if (target !== undefined && energyRecharge < target) gaps.push(`ER ${energyRecharge}% vs ${target}% target`);
    const emRole = c.scalesOn?.includes("EM") || (c.element === "Anemo" && c.roles.includes("buffer"));
    if (emRole && em < POINTS.emLow) gaps.push(`EM ${em} vs ${POINTS.emLow}+`);
  }
  if (c.talents) {
    const talents = new Set<Talent>(c.roles.includes("main-dps") && c.keyTalent ? [c.keyTalent] : []);
    for (const b of c.buffs ?? []) if (b.talent && b.talent !== "passive") talents.add(b.talent);
    for (const t of talents) {
      const level = c.talents[t];
      if (level < POINTS.talentBenchmark) gaps.push(`${t} level ${level} vs ${POINTS.talentBenchmark}`);
    }
  }
  return gaps;
}

// Scores a team once per possible carry and keeps the reading with the most team damage (#202): the carry's damage
// plus each sub-DPS's own, times the factor of the lines not inside the damage yet. `explain` keeps the breakdown
// text. `onlyCarry` reads the team with that carry on field (the guide-team reference, team-reference.ts).
function bestReading(given: ScoringCharacter[], options: ScoreOptions, explain: boolean, onlyCarry?: string) {
  if (given.length !== 4) throw new Error(`A team needs 4 members, got ${given.length}`);
  // Read in a fixed member order, so sums and products of floats come out the same, to the last bit, whatever
  // order the team arrives in (the model checks' order test, #201).
  const team = [...given].sort((a, b) => a.id.localeCompare(b.id));
  const sink = (): Sink => (explain ? new Breakdown() : new Tally());
  const ctx = buildContext(team, options);
  const shared = sink();
  teamLines(ctx, shared);
  // The member who deals the most damage carries (#96): of the main DPS whose damage is modeled, only the strongest
  // is tried as the on-field carry. The others are still tried by team damage.
  const mainDps = team.filter((m) => m.roles.includes("main-dps"));
  const modeled = mainDps.map((m) => ({ m, dps: modeledCarryDps(m, ctx) })).filter((x) => x.dps !== null);
  const strongest = modeled.reduce<(typeof modeled)[number] | null>((a, x) => (!a || x.dps! > a.dps! ? x : a), null);
  const candidates = onlyCarry
    ? team.filter((m) => m.id === onlyCarry)
    : mainDps.filter((m) => !modeled.some((x) => x.m === m) || m === strongest?.m);

  type Reading = { carry: ScoringCharacter | null; lead: ScoringCharacter | null; out: Sink; dps: number; value: number };
  let best: Reading | null = null;
  for (const carry of candidates.length > 0 ? candidates : [null]) {
    const out = sink();
    carryLines(ctx, carry, out);
    if (carry) carryTalentLine(carry, out);
    out.addAll(shared);
    carryResonanceLines(ctx, carry, out);
    ascendantGleamLines(ctx, carry, out);
    secretRiteLines(ctx, carry, out);
    nightsoulBurstLines(ctx, carry, out);
    stellarLines(ctx, carry, out);
    const sub = subDpsLines(ctx, carry, out);
    prefLines(ctx, carry, out);
    infusionLines(ctx, carry, out);
    cryoSplitLines(ctx, carry, out);
    statLines(ctx, carry, out);
    energyLines(ctx, carry, out);
    // No carry: the generic benchmark hit stands in for whoever is on field; the -30 line marks the missing carry.
    const own = carry ? carryDamagePerSecond(carry, ctx) : BENCHMARK.hitDamage * BENCHMARK.carryHitsPerSecond;
    const dps = own + sub.dps;
    const value = dps * factorOf(out);
    if (!best || value > best.value) best = { carry, lead: sub.lead, out, dps, value };
  }
  return { ctx, ...best! };
}

// The guide-team reference (#202, Jessie 2026-10-15), written by `npm run reference` (team-reference.ts): `median`,
// the median across carries of their best guide team's value, sets the score scale (a team at the median = 100);
// `carries` holds each carry's best guide team, for the per-carry ratio. Single target; AoE: #211.
const REFERENCE = referenceJson as { median: number; carries: Record<string, { team: string[]; value: number }> };
const toScore = (value: number) => (100 * value) / REFERENCE.median;

// The team's score alone, without building the breakdown; the search uses it to skip teams outside the top.
export function teamScore(team: ScoringCharacter[], options: ScoreOptions = {}): number {
  return toScore(bestReading(team, options, false).value);
}

// A team's value with this carry on field, for the reference (team-reference.ts).
export function carryTeamValue(team: ScoringCharacter[], carry: string): number {
  return bestReading(team, {}, false, carry).value;
}

export function scoreTeam(team: ScoringCharacter[], options: ScoreOptions = {}): ScoredTeam {
  const { ctx, carry, lead, out, dps, value } = bestReading(team, options, true);
  const rotation = generateRotation(team, carry?.id ?? null); // the on-field carry's, even when a sub-DPS out-damages them
  const guide = carry ? REFERENCE.carries[carry.id] : undefined;
  const guideRatio = guide ? value / guide.value : null;
  const vsGuide = !carry
    ? ""
    : guide
      ? `; ${guideRatio!.toFixed(2)}× ${carry.id}'s best guide team (${guide.team.filter((id) => id !== carry.id).join(", ")})`
      : `; no guide team for ${carry.id} yet (#210)`;
  const head: ScoreLine = {
    rule: "Team damage",
    points: 0,
    reason: `~${Math.round(dps)} damage per second, ×${factorOf(out).toFixed(2)} from the lines below${vsGuide}`,
  };
  return {
    members: team.map((m) => m.id) as ScoredTeam["members"],
    mainDps: (lead ?? carry)?.id ?? null,
    onField: carry?.id ?? null,
    score: toScore(value),
    damage: { perSecond: dps, factor: factorOf(out), guideRatio },
    breakdown: [head, ...(out as Breakdown).lines],
    activeReactions: ctx.active,
    defaultBuilds: team.filter((m) => !m.stats).map((m) => m.id),
    rotation,
    energy: energyCheck(team, carry, carry ? carryRotationSeconds(carry, ctx.active, team) : undefined),
  };
}
