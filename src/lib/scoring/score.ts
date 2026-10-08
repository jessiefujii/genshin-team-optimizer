import type { EffectTag } from "../../types/effects";
import { ER_TARGETS, type Buff, type CompositionPref, type Role } from "../../types/tags";
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

function familiesOf(member: ScoringCharacter, options: ScoreOptions): Family[] {
  return (member.families ?? []).filter(
    (f) => f !== "hexerei" || !options.hexereiUnlocked || options.hexereiUnlocked.has(member.id),
  );
}

function buildContext(members: ScoringCharacter[], options: ScoreOptions): TeamContext {
  const elements = new Set(members.map((m) => m.element));
  const families = new Set(members.flatMap((m) => familiesOf(m, options)));
  const listed = new Set(members.flatMap((m) => m.reactions));
  const active = [...listed].filter((r) => canTrigger(r, elements, families));
  return { members, elements, families, active, options };
}

// A support only partners a reaction if it brings an element the carry lacks (Bennett is not a Vaporize partner for Hu Tao).
function suppliesElement(support: ScoringCharacter, carry: ScoringCharacter, reaction: Reaction): boolean {
  return support.element !== carry.element && reactionElements(reaction).includes(support.element);
}

function carryLines(ctx: TeamContext, carry: ScoringCharacter | null): ScoreLine[] {
  const lines: ScoreLine[] = [];
  if (!carry) {
    lines.push({ rule: "Carry", points: POINTS.noCarry, reason: "No main DPS in the team" });
    // Without a carry, reward reactions that at least two members build toward.
    const shared = ctx.active.filter((r) => ctx.members.filter((m) => m.reactions.includes(r)).length >= 2);
    for (const r of shared.slice(0, POINTS.maxCountedReactions)) {
      lines.push({ rule: "Reactions", points: POINTS.supportReaction, reason: `${label(r)} from the supports` });
    }
    return lines;
  }

  const supports = ctx.members.filter((m) => m !== carry);
  const rivals = supports.filter((m) => m.fieldTime === "on");
  if (rivals.length === 0) {
    lines.push({ rule: "Carry", points: POINTS.singleCarry, reason: `${carry.id} is the only on-field character` });
  } else {
    for (const r of rivals) {
      lines.push({ rule: "Carry", points: POINTS.extraOnField, reason: `${r.id} also wants field time` });
    }
  }

  const carryActive = carry.reactions.filter((r) => ctx.active.includes(r));
  if (carry.reactions.length > 0 && carryActive.length === 0) {
    lines.push({
      rule: "Reactions",
      points: POINTS.carryReactionsUnavailable,
      reason: `${carry.id}'s reactions are not possible with this team`,
    });
  }
  const ranked = carryActive
    .map((r) => ({ r, partners: supports.filter((s) => s.reactions.includes(r) && suppliesElement(s, carry, r)) }))
    .sort((a, b) => b.partners.length - a.partners.length)
    .slice(0, POINTS.maxCountedReactions);
  ranked.forEach(({ r, partners }, i) => {
    if (i > 0) {
      lines.push({ rule: "Reactions", points: POINTS.secondaryReaction, reason: `${label(r)} as a secondary reaction` });
      return;
    }
    if (partners.length === 0) {
      lines.push({ rule: "Reactions", points: POINTS.carryReactionFromElements, reason: `${label(r)} is possible for ${carry.id}` });
      return;
    }
    lines.push({
      rule: "Reactions",
      points: POINTS.carryReactionWithSupport,
      reason: `${label(r)}: ${carry.id} + ${partners.map((p) => p.id).join(", ")}`,
    });
    const extra = Math.min(partners.length - 1, POINTS.maxExtraPartners);
    if (extra > 0) {
      lines.push({
        rule: "Reactions",
        points: extra * POINTS.extraPartner,
        reason: `${extra + 1} supports enable ${label(r)}`,
      });
    }
  });

  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  const emUseful = carryActive.some((r) => !NO_EM_REACTIONS.has(r));
  let counted = 0;
  for (const s of supports.filter((m) => m.roles.includes("buffer"))) {
    // Anemo buffers (Kazuha, Sucrose) need something to swirl.
    if (s.element === "Anemo" && !swirlActive) continue;
    const misfits = (s.buffs ?? []).map((b) => buffMisfit(b, carry, ctx, emUseful));
    if (misfits.length > 0 && misfits.every((m) => m !== null)) {
      lines.push({ rule: "Buffs", points: 0, reason: `${s.id}: ${misfits[0]}` });
    } else if (counted < POINTS.maxBuffers) {
      counted++;
      lines.push({ rule: "Buffs", points: POINTS.buffer, reason: `${s.id} buffs ${carry.id}` });
    }
  }
  lines.push(...effectBuffLines(ctx, carry, emUseful));
  return lines;
}

// Weapon, set and constellation buffs that fit the carry. The same effect on two members counts once.
function effectBuffLines(ctx: TeamContext, carry: ScoringCharacter, emUseful: boolean): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const seen = new Set<string>();
  for (const m of ctx.members) {
    for (const e of m.effects ?? []) {
      if (lines.length === POINTS.maxEffectBuffs) return lines;
      // On the carry's own items, an 'active' buff only buffs the carry, which its final stats may already show.
      const fit = e.buffs?.find((b) => (m !== carry || b.scope === "team") && !buffMisfit(b, carry, ctx, emUseful));
      if (!fit || seen.has(effectKey(e))) continue;
      seen.add(effectKey(e));
      lines.push({ rule: "Effects", points: POINTS.effectBuff, reason: `${effectName(m, e)}: ${fit.stat} for ${carry.id}` });
    }
  }
  return lines;
}

const MELEE = new Set(["Sword", "Claymore", "Polearm"]);

// An infusion (C6 Bennett) turns a melee carry's attacks into its element.
function infusionLines(ctx: TeamContext, carry: ScoringCharacter | null): ScoreLine[] {
  if (!carry || !MELEE.has(carry.weapon)) return [];
  return ctx.members
    .filter((m) => m !== carry)
    .flatMap((m) =>
      (m.effects ?? [])
        .filter((e) => e.infusion && e.infusion !== carry.element)
        .map((e) => ({
          rule: "Conflicts",
          points: POINTS.infusionConflict,
          reason: `${effectName(m, e)} infuses ${carry.id}'s attacks with ${e.infusion}`,
        })),
    );
}

// Reactions whose damage does not grow with EM, so an EM buff does nothing for them.
const NO_EM_REACTIONS = new Set<Reaction>(["freeze", "crystallize", "quicken", "superconduct"]);

// Why a buff does not help this carry, or null if it does (#3).
function buffMisfit(buff: Buff, carry: ScoringCharacter, ctx: TeamContext, emUseful: boolean): string | null {
  if (buff.affects === "EM") {
    if (!carry.scalesOn?.includes("EM") && !emUseful) return `EM buff, but ${carry.id} has no reaction that uses EM`;
  } else if (buff.affects && carry.scalesOn && !carry.scalesOn.includes(buff.affects)) {
    return `${buff.affects} buff, but ${carry.id} scales on ${carry.scalesOn.join("/")}`;
  }
  if (buff.elements && !buff.elements.includes(carry.element)) {
    return `${buff.elements.join("/")} buff, but ${carry.id} is ${carry.element}`;
  }
  if (buff.reactions && !buff.reactions.some((r) => ctx.active.includes(r))) {
    return `buffs ${buff.reactions.map(label).join("/")}, which this team does not trigger`;
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

function teamLines(ctx: TeamContext): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const { members } = ctx;

  const counts = new Map<Element, number>();
  for (const m of members) counts.set(m.element, (counts.get(m.element) ?? 0) + 1);
  for (const [el, n] of counts) {
    if (n >= 2) lines.push({ rule: "Resonance", points: RESONANCE[el].points, reason: RESONANCE[el].name });
  }

  const sustain = members.find((m) => hasRole(m, "healer") || hasRole(m, "shielder"));
  lines.push(
    sustain
      ? { rule: "Survivability", points: POINTS.survivability, reason: `${sustain.id} heals or shields` }
      : { rule: "Survivability", points: POINTS.noSurvivability, reason: "No healer or shielder" },
  );

  const hungry = members.filter((m) => m.energyNeed === "high");
  const batteries = members.filter((m) => hasRole(m, "battery"));
  const batteryName = (b: ScoringCharacter) => (b.roles.includes("battery") ? b.id : effectName(b, roleEffect(b, "battery")!));
  if (hungry.some((h) => batteries.some((b) => b !== h))) {
    lines.push({ rule: "Energy", points: POINTS.battery, reason: `${batteries.map(batteryName).join(", ")} feeds high-cost bursts` });
  } else if (hungry.length >= 2 && batteries.length === 0) {
    lines.push({ rule: "Energy", points: POINTS.starvedBursts, reason: `${hungry.length} high-cost bursts and no battery` });
  }

  const familyCounts = new Map<Family, number>();
  for (const m of members) for (const f of familiesOf(m, ctx.options)) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  for (const [f, n] of familyCounts) {
    if (n >= 2) {
      lines.push({
        rule: "Family",
        points: f === "nightsoul" ? POINTS.nightsoulPair : POINTS.familyPair,
        reason: `${n} ${FAMILY_NAMES[f]} members`,
      });
    }
  }

  for (const m of members) {
    for (const pref of m.teamPrefs ?? []) {
      if (pref.kind === "partner") {
        const partner = members.find((p) => pref.ids.includes(p.id));
        if (partner) lines.push({ rule: "Team preference", points: POINTS.prefMet, reason: `${m.id} with ${partner.id}` });
      } else if (compositionMet(pref, ctx)) {
        lines.push({ rule: "Team preference", points: POINTS.prefMet, reason: `${m.id}: ${pref.note ?? "preferred team makeup"}` });
      } else if (pref.onlyElements && pref.onlyElements.length > 0) {
        lines.push({
          rule: "Team preference",
          points: POINTS.onlyElementsBroken,
          reason: `${m.id} wants only ${pref.onlyElements.join("/")} teammates`,
        });
      }
    }
  }

  const anemo = members.filter((m) => m.element === "Anemo");
  const swirlActive = ctx.active.includes("swirl") || ctx.active.includes("stellar-swirl");
  if (anemo.length >= 2 && !swirlActive) {
    lines.push({ rule: "Conflicts", points: POINTS.idleAnemo, reason: "Two Anemo characters with nothing to swirl" });
  }
  return lines;
}

const total = (lines: ScoreLine[]) => lines.reduce((sum, l) => sum + l.points, 0);

// Pure reaction carries (EM only, e.g. Kaveh) don't crit, so CV says nothing about them.
const usesCrit = (c: ScoringCharacter) => !(c.scalesOn?.length === 1 && c.scalesOn[0] === "EM");

// Scales the carry's points by their crit value; no line without stats (benchmark assumed).
function carryBuildLine(carry: ScoringCharacter, carryPoints: number): ScoreLine | null {
  if (!carry.stats || !usesCrit(carry) || carryPoints <= 0) return null;
  const cv = Math.round(2 * carry.stats.critRate + carry.stats.critDmg);
  const factor = Math.min(Math.max(cv / POINTS.cvBenchmark, POINTS.cvMinFactor), POINTS.cvMaxFactor);
  const points = Math.round(carryPoints * (factor - 1));
  if (points === 0) return null;
  return { rule: "Carry build", points, reason: `${carry.id} CV ${cv} vs ${POINTS.cvBenchmark} benchmark` };
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

function statLines(ctx: TeamContext, carry: ScoringCharacter | null): ScoreLine[] {
  const lines: ScoreLine[] = [];
  for (const m of ctx.members) {
    if (!m.stats) continue;
    const target = m.erTarget ?? (m.energyNeed === "low" ? undefined : ER_TARGETS[m.energyNeed]);
    if (target !== undefined && m.stats.energyRecharge < target) {
      lines.push({
        rule: "Energy",
        points: POINTS.lowEr,
        reason: `${m.id} ER ${m.stats.energyRecharge}% vs ${target}% target`,
      });
    }
    if (emReliant(m, carry, ctx)) {
      const em = m.stats.elementalMastery;
      if (em >= POINTS.emHigh) {
        lines.push({ rule: "EM", points: POINTS.emPoints, reason: `${m.id} has ${em} EM for reactions` });
      } else if (em < POINTS.emLow) {
        lines.push({ rule: "EM", points: -POINTS.emPoints, reason: `${m.id} has ${em} EM; reactions want ${POINTS.emHigh}+` });
      }
    }
  }
  return lines;
}

// Scores a team once per possible carry and keeps the best reading.
export function scoreTeam(team: ScoringCharacter[], options: ScoreOptions = {}): ScoredTeam {
  if (team.length !== 4) throw new Error(`A team needs 4 members, got ${team.length}`);
  const ctx = buildContext(team, options);
  const shared = teamLines(ctx);
  const candidates = team.filter((m) => m.roles.includes("main-dps"));

  let best: { carry: ScoringCharacter | null; lines: ScoreLine[] } | null = null;
  for (const carry of candidates.length > 0 ? candidates : [null]) {
    const own = carryLines(ctx, carry);
    const build = carry && carryBuildLine(carry, total(own));
    const lines = [...own, ...(build ? [build] : []), ...shared, ...infusionLines(ctx, carry), ...statLines(ctx, carry)];
    if (!best || total(lines) > total(best.lines)) best = { carry, lines };
  }

  return {
    members: team.map((m) => m.id) as ScoredTeam["members"],
    carry: best!.carry?.id ?? null,
    score: total(best!.lines),
    breakdown: best!.lines,
    activeReactions: ctx.active,
    defaultBuilds: team.filter((m) => !m.stats).map((m) => m.id),
  };
}
