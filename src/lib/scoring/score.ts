import type { EffectTag } from "../../types/effects";
import { type Buff, type CompositionPref, type Role, type Talent } from "../../types/tags";
import { effectKey, effectLabel, isDraft } from "./effects";
import { canTrigger, mainReactionOf, reactionElements, reactionShare } from "./reactions";
import { energyCheck, erTargetOf } from "./energy";
import { generateRotation } from "./rotation";
import { atkPctGain, baseAtkOf, kitBuffValue } from "./kit";
import { BENCHMARK, critGain, dmgBonusGain, emGain, GAIN_FOR_POINTS, gainPoints, resShredGain } from "./benchmark";
import kitJson from "../../../data/kit.json";
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
  battery: 5,
  starvedBursts: -5,
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
  return { members, elements, active, options };
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
interface Sink {
  total: number;
  add(rule: string, points: number, reason: () => string): void;
  addAll(other: Sink): void;
}

class Breakdown implements Sink {
  total = 0;
  lines: ScoreLine[] = [];
  add(rule: string, points: number, reason: () => string) {
    this.total += points;
    this.lines.push({ rule, points, reason: reason() });
  }
  addAll(other: Sink) {
    this.total += other.total;
    this.lines.push(...(other as Breakdown).lines);
  }
}

class Tally implements Sink {
  total = 0;
  add(_rule: string, points: number) {
    this.total += points;
  }
  addAll(other: Sink) {
    this.total += other.total;
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
  const carryActive = carry.reactions.filter((r) => ctx.active.includes(r));
  if (main !== "none" && carry.reactions.length > 0 && carryActive.length === 0) {
    out.add("Reactions", POINTS.carryReactionsUnavailable, () => `${carry.id}'s reactions are not possible with this team`);
  }
  if (main === undefined) {
    const ranked = carryActive
      .map((r) => ({ r, partners: partnersFor(r) }))
      .sort((a, b) => b.partners.length - a.partners.length)
      .slice(0, POINTS.maxCountedReactions);
    ranked.forEach(({ r, partners }, i) => {
      if (i > 0) out.add("Reactions", POINTS.secondaryReaction, () => `${label(r)} as a secondary reaction`);
      else mainReactionLines(carry, r, partners, out);
    });
  } else {
    // Only the reaction the carry's teams are built around gets full points (#49).
    if (main !== "none" && ctx.active.includes(main)) mainReactionLines(carry, main, partnersFor(main), out);
    for (const r of carryActive.filter((r) => r !== main).slice(0, POINTS.maxCountedReactions - 1)) {
      out.add("Reactions", POINTS.secondaryReaction, () => `${label(r)} as a secondary reaction`);
    }
  }

  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  const emUseful = usesEmReaction(carry, ctx);
  const maxBuffers = main === "none" ? POINTS.hypercarryMaxBuffers : POINTS.maxBuffers;
  // Every fitting buffer is scored, then the strongest count up to the cap (#60).
  const fitting: { id: string; points: number; reason: () => string }[] = [];
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
      out.add("Buffs", 0, () => `${s.id}: their kit's buff doesn't apply to ${carry.id}'s damage`);
      continue;
    }
    const base = kit ? (POINTS.buffer * kit.gain) / GAIN_FOR_POINTS : POINTS.buffer;
    const est = kit ? `~+${Math.round(kit.gain * 100)}% damage` : "";
    const detail = [est, level === undefined ? "" : `${talent} level ${level}`].filter(Boolean).join(", ");
    fitting.push({
      id: s.id,
      points: Math.round(base * talentFactor(level)),
      reason: () => `${s.id} buffs ${carry.id}${detail ? ` (${detail})` : ""}`,
    });
  }
  fitting.sort((a, b) => b.points - a.points);
  for (const f of fitting.slice(0, maxBuffers)) out.add("Buffs", f.points, f.reason);

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

  const sustain = members.find((m) => hasRole(m, "healer") || hasRole(m, "shielder"));
  if (sustain) out.add("Survivability", POINTS.survivability, () => `${sustain.id} heals or shields`);
  else out.add("Survivability", POINTS.noSurvivability, () => "No healer or shielder");

  const hungry = members.filter((m) => m.energyNeed === "high");
  const batteries = members.filter((m) => hasRole(m, "battery"));
  const batteryName = (b: ScoringCharacter) => (b.roles.includes("battery") ? b.id : effectName(b, roleEffect(b, "battery")!));
  if (hungry.some((h) => batteries.some((b) => b !== h))) {
    out.add("Energy", POINTS.battery, () => `${batteries.map(batteryName).join(", ")} feeds high-cost bursts`);
  } else if (hungry.length >= 2 && batteries.length === 0) {
    out.add("Energy", POINTS.starvedBursts, () => `${hungry.length} high-cost bursts and no battery`);
  }

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
  // Kept for every Moonsign carry here: team scores don't read carry damage yet. Once they do (#96, #102), skip it
  // for carries whose damage already has the upgrade (damage.ts modelsAscendantGleam), so it isn't counted twice (#150).
  if (moonsign.includes(carry) && GLEAM[carry.id]?.target === "self") {
    out.add("Moonsign", POINTS.ownAscendantGleam, () => `Ascendant Gleam enhances ${carry.id}'s kit`);
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

// Scales the carry's points by their crit value; no line without stats (benchmark assumed).
function carryBuildLine(carry: ScoringCharacter, carryPoints: number, out: Sink) {
  if (!carry.stats || !usesCrit(carry) || carryPoints <= 0) return;
  const cv = Math.round(2 * carry.stats.critRate + carry.stats.critDmg);
  const factor = Math.min(Math.max(cv / POINTS.cvBenchmark, POINTS.cvMinFactor), POINTS.cvMaxFactor);
  const points = Math.round(carryPoints * (factor - 1));
  if (points !== 0) out.add("Carry build", points, () => `${carry.id} CV ${cv} vs ${POINTS.cvBenchmark} benchmark`);
}

// Level / benchmark within bounds; no level (no build, or a passive) = benchmark.
function talentFactor(level: number | undefined): number {
  if (level === undefined) return 1;
  return Math.min(Math.max(level / POINTS.talentBenchmark, POINTS.talentMinFactor), POINTS.talentMaxFactor);
}

// Scales the carry's points by their key talent's level, like the CV line.
function carryTalentLine(carry: ScoringCharacter, carryPoints: number, out: Sink) {
  const talent: Talent | undefined = carry.keyTalent;
  const level = talent && carry.talents?.[talent];
  if (!level || carryPoints <= 0) return;
  const points = Math.round(carryPoints * (talentFactor(level) - 1));
  if (points !== 0) {
    out.add("Carry talent", points, () => `${carry.id} ${talent} level ${level} vs ${POINTS.talentBenchmark} benchmark`);
  }
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

// Scores a team once per possible carry and keeps the best reading. `explain` keeps the breakdown text.
function bestReading(team: ScoringCharacter[], options: ScoreOptions, explain: boolean) {
  if (team.length !== 4) throw new Error(`A team needs 4 members, got ${team.length}`);
  const sink = (): Sink => (explain ? new Breakdown() : new Tally());
  const ctx = buildContext(team, options);
  const shared = sink();
  teamLines(ctx, shared);
  const candidates = team.filter((m) => m.roles.includes("main-dps"));

  let best: { carry: ScoringCharacter | null; out: Sink } | null = null;
  for (const carry of candidates.length > 0 ? candidates : [null]) {
    const out = sink();
    carryLines(ctx, carry, out);
    if (carry) {
      // Both factors apply to the carry's own points, not to each other's adjustment.
      const carryPoints = out.total;
      carryBuildLine(carry, carryPoints, out);
      carryTalentLine(carry, carryPoints, out);
    }
    out.addAll(shared);
    carryResonanceLines(ctx, carry, out);
    ascendantGleamLines(ctx, carry, out);
    secretRiteLines(ctx, carry, out);
    nightsoulBurstLines(ctx, carry, out);
    stellarLines(ctx, carry, out);
    prefLines(ctx, carry, out);
    infusionLines(ctx, carry, out);
    cryoSplitLines(ctx, carry, out);
    statLines(ctx, carry, out);
    if (!best || out.total > best.out.total) best = { carry, out };
  }
  return { ctx, carry: best!.carry, out: best!.out };
}

// The team's score alone, without building the breakdown; the search uses it to skip teams outside the top.
export function teamScore(team: ScoringCharacter[], options: ScoreOptions = {}): number {
  return bestReading(team, options, false).out.total;
}

export function scoreTeam(team: ScoringCharacter[], options: ScoreOptions = {}): ScoredTeam {
  const { ctx, carry, out } = bestReading(team, options, true);
  const rotation = generateRotation(team, carry?.id ?? null);
  return {
    members: team.map((m) => m.id) as ScoredTeam["members"],
    carry: carry?.id ?? null,
    score: out.total,
    breakdown: (out as Breakdown).lines,
    activeReactions: ctx.active,
    defaultBuilds: team.filter((m) => !m.stats).map((m) => m.id),
    rotation,
    energy: energyCheck(team),
  };
}
