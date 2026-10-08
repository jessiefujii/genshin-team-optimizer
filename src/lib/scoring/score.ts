import type { EffectTag } from "../../types/effects";
import { ER_TARGETS, type Buff, type CompositionPref, type Role, type Talent } from "../../types/tags";
import { effectKey, effectLabel, isDraft } from "./effects";
import { canTrigger, reactionElements } from "./reactions";
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
  maxBuffers: 2,
  survivability: 10,
  noSurvivability: -10,
  battery: 5,
  starvedBursts: -5,
  familyPair: 10,
  nightsoulPair: 5,
  prefMet: 15,
  onlyElementsBroken: -10,
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

const FAMILY_NAMES: Record<Family, string> = {
  moonsign: "Moonsign (Ascendant Gleam)",
  hexerei: "Hexerei (Secret Rite)",
  stellar: "Stellar",
  nightsoul: "Nightsoul",
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
  families: Set<Family>;
  active: Reaction[];
  options: ScoreOptions;
}

const NO_FAMILIES: Family[] = [];

function familiesOf(member: ScoringCharacter, options: ScoreOptions): Family[] {
  const families = member.families ?? NO_FAMILIES;
  if (!options.hexereiUnlocked || options.hexereiUnlocked.has(member.id) || !families.includes("hexerei")) return families;
  return families.filter((f) => f !== "hexerei");
}

// Runs for every team the search tries, so it sticks to plain loops (#4).
function buildContext(members: ScoringCharacter[], options: ScoreOptions): TeamContext {
  const elements = new Set<Element>();
  const families = new Set<Family>();
  const listed: Reaction[] = [];
  for (const m of members) {
    elements.add(m.element);
    for (const f of familiesOf(m, options)) families.add(f);
    for (const r of m.reactions) if (!listed.includes(r)) listed.push(r);
  }
  const active = listed.filter((r) => canTrigger(r, elements, families));
  return { members, elements, families, active, options };
}

// A support only partners a reaction if it brings an element the carry lacks (Bennett is not a Vaporize partner for Hu Tao).
function suppliesElement(support: ScoringCharacter, carry: ScoringCharacter, reaction: Reaction): boolean {
  return support.element !== carry.element && reactionElements(reaction).includes(support.element);
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

  const carryActive = carry.reactions.filter((r) => ctx.active.includes(r));
  if (carry.reactions.length > 0 && carryActive.length === 0) {
    out.add("Reactions", POINTS.carryReactionsUnavailable, () => `${carry.id}'s reactions are not possible with this team`);
  }
  const ranked = carryActive
    .map((r) => ({ r, partners: supports.filter((s) => s.reactions.includes(r) && suppliesElement(s, carry, r)) }))
    .sort((a, b) => b.partners.length - a.partners.length)
    .slice(0, POINTS.maxCountedReactions);
  ranked.forEach(({ r, partners }, i) => {
    if (i > 0) {
      out.add("Reactions", POINTS.secondaryReaction, () => `${label(r)} as a secondary reaction`);
      return;
    }
    if (partners.length === 0) {
      out.add("Reactions", POINTS.carryReactionFromElements, () => `${label(r)} is possible for ${carry.id}`);
      return;
    }
    out.add("Reactions", POINTS.carryReactionWithSupport, () => `${label(r)}: ${carry.id} + ${partners.map((p) => p.id).join(", ")}`);
    const extra = Math.min(partners.length - 1, POINTS.maxExtraPartners);
    if (extra > 0) out.add("Reactions", extra * POINTS.extraPartner, () => `${extra + 1} supports enable ${label(r)}`);
  });

  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  const emUseful = carryActive.some((r) => !NO_EM_REACTIONS.has(r));
  let counted = 0;
  for (const s of supports.filter((m) => m.roles.includes("buffer"))) {
    // Anemo buffers (Kazuha, Sucrose) need something to swirl.
    if (s.element === "Anemo" && !swirlActive) continue;
    const misfits = (s.buffs ?? []).map((b) => buffMisfit(b, carry, ctx, emUseful));
    if (misfits.length > 0 && misfits.every((m) => m !== null)) {
      out.add("Buffs", 0, () => `${s.id}: ${misfits[0]!()}`);
    } else if (counted < POINTS.maxBuffers) {
      counted++;
      // A buff from a talent gets stronger with its level; scale by the first buff that fits.
      const talent = s.buffs?.[misfits.indexOf(null)]?.talent;
      const level = talent && talent !== "passive" ? s.talents?.[talent] : undefined;
      const points = Math.round(POINTS.buffer * talentFactor(level));
      out.add("Buffs", points, () => `${s.id} buffs ${carry.id}${level === undefined ? "" : ` (${talent} level ${level})`}`);
    }
  }
  effectBuffLines(ctx, carry, emUseful, out);
}

// Weapon, set and constellation buffs that fit the carry. The same effect on two members counts once.
function effectBuffLines(ctx: TeamContext, carry: ScoringCharacter, emUseful: boolean, out: Sink) {
  const seen: string[] = [];
  for (const m of ctx.members) {
    for (const e of m.effects ?? []) {
      if (seen.length === POINTS.maxEffectBuffs) return;
      // On the carry's own items, an 'active' buff only buffs the carry, which its final stats may already show.
      const fit = e.buffs?.find((b) => (m !== carry || b.scope === "team") && !buffMisfit(b, carry, ctx, emUseful));
      if (!fit || seen.includes(effectKey(e))) continue;
      seen.push(effectKey(e));
      out.add("Effects", POINTS.effectBuff, () => `${effectName(m, e)}: ${fit.stat} for ${carry.id}`);
    }
  }
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
    if (n >= 2) out.add("Resonance", RESONANCE[el].points, () => RESONANCE[el].name);
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

  const familyCounts = new Map<Family, number>();
  for (const m of members) for (const f of familiesOf(m, ctx.options)) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  for (const [f, n] of familyCounts) {
    if (n >= 2) {
      out.add("Family", f === "nightsoul" ? POINTS.nightsoulPair : POINTS.familyPair, () => `${n} ${FAMILY_NAMES[f]} members`);
    }
  }

  for (const m of members) {
    for (const pref of m.teamPrefs ?? []) {
      if (pref.kind === "partner") {
        const partner = members.find((p) => pref.ids.includes(p.id));
        if (partner) out.add("Team preference", POINTS.prefMet, () => `${m.id} with ${partner.id}`);
      } else if (compositionMet(pref, ctx)) {
        out.add("Team preference", POINTS.prefMet, () => `${m.id}: ${pref.note ?? "preferred team makeup"}`);
      } else if (pref.onlyElements && pref.onlyElements.length > 0) {
        out.add("Team preference", POINTS.onlyElementsBroken, () => `${m.id} wants only ${pref.onlyElements!.join("/")} teammates`);
      }
    }
  }

  const anemo = members.filter((m) => m.element === "Anemo");
  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  if (anemo.length >= 2 && !swirlActive) {
    out.add("Conflicts", POINTS.idleAnemo, () => "Two Anemo characters with nothing to swirl");
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

// ER % a member wants for their burst; undefined = not checked (low energy need and no erTarget).
const erTargetOf = (m: ScoringCharacter) => m.erTarget ?? (m.energyNeed === "low" ? undefined : ER_TARGETS[m.energyNeed]);

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
    infusionLines(ctx, carry, out);
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
  return {
    members: team.map((m) => m.id) as ScoredTeam["members"],
    carry: carry?.id ?? null,
    score: out.total,
    breakdown: (out as Breakdown).lines,
    activeReactions: ctx.active,
    defaultBuilds: team.filter((m) => !m.stats).map((m) => m.id),
  };
}
