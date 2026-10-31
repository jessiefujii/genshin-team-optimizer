import type { EffectTag } from "../../types/effects";
import { type Buff, type CompositionPref, type Role, type Talent } from "../../types/tags";
import { effectKey, effectLabel, isDraft } from "./effects";
import { canTrigger, mainReactionOf, reactionElements, reactionShare } from "./reactions";
import { energyCheck, energyNeeds, erTargetOf } from "./energy";
import { generateRotation } from "./rotation";
import { FAMILY_IN_DAMAGE, FIGHTING_SPIRIT_MIN, NO_TEAM_BUFFS, partyGearModeled, RESONANCE_IN_DAMAGE, type TeamBuffStats, atkPctGain, baseAtkOf, fightingSpirit, fightingSpiritBuilt, kitBuffValue, memberBuffStats, normalAttacks, partySetBuffs, partySetModeled, reactionBonusesFor, teamBuffStats, type BurstShares } from "./kit";
import { amplifyGain, weaponFlatFromDef, weaponReactionBonus, carryDamage, carryStats, freezeInDamage, freezeSetModeled, setBuffs, setDmgBonus, setsOf, setReactionBonus, sumSet, weaponAtk, weaponBuffs, weaponDmgBonus, weaponSum, LEVEL_MULTIPLIER_90, LUNAR_COEFFICIENT, lunarEmBonus, carryHitRates, carryRotationSeconds, catalyzeDamage, expectedCrit, lunarHit, modelsAscendantGleam, modelsRadiance, modelsReaction, modelsSecretRite, passiveEnabler, TRANSFORMATIVE, transformativeHit, type LunarReaction } from "./damage";
import { BENCHMARK, critGain, defShredGain, dmgBonusGain, emGain, GAIN_FOR_POINTS, gainPoints, resShredGain, subDpsBenchmark } from "./benchmark";
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
  burstShares: Map<ScoringCharacter, BurstShares>; // burstSharesFor, once per carry and team
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

// A member as the player's quests leave them (#124): without the families familiesOf locks, so the damage model, which
// reads `families` directly (Ascendant Gleam, Secret Rite, Wriothesley's Radiance combo), agrees with the scorer. One
// object per member and lock set, so object-keyed caches still hit.
const questViews = new WeakMap<ScoringCharacter, Map<string, ScoringCharacter>>();
function questView(m: ScoringCharacter, options: ScoreOptions): ScoringCharacter {
  const families = familiesOf(m, options);
  if (families === (m.families ?? NO_FAMILIES)) return m;
  let views = questViews.get(m);
  if (!views) questViews.set(m, (views = new Map()));
  const key = families.join(",");
  let view = views.get(key);
  if (!view) views.set(key, (view = { ...m, families }));
  return view;
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
  return { members, elements, active, options, carryDps: new Map(), burstShares: new Map() };
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
  // Reactions the carry's modeled damage covers score by the damage they add (#134), and Overloaded and Swirl by their
  // own damage in team damage (transformativeLines, #205); the flat points below are for the rest (a carry not modeled
  // yet, or a reaction the damage model doesn't cover yet, like Freeze or Electro-Charged).
  const carryActive = carry.reactions.filter((r) => ctx.active.includes(r));
  // A reaction that deals its own damage (Swirl, Overloaded...) leaves the flat points only when that damage counts too:
  // Heizou's Swirl hit is in his damage, but in a Dendro team his Swirls' own damage isn't yet (#253).
  const transformative = carryActive.filter((r) => transformativeModeled(ctx, carry, r));
  const kitModeled = reactionDamageLine(ctx, carry, out).filter((r) => !TRANSFORMATIVE[r] || transformative.includes(r));
  // Freeze scores only through crit (#205): with a 4pc set whose CRIT Rate needs it (Blizzard Strayer, #206) it is in the
  // carry's damage. A carry without a build wears their guide's set (setsOf, #279), and a build with another set gets
  // nothing from Freeze. A carry whose guide set doesn't need Freeze (Ayaka, Wriothesley: Marechaussee Hunter, #206)
  // keeps the flat points.
  const worn = carryActive.includes("freeze") && freezeInDamage(carry, ctx.active);
  const frozen = worn || (carryActive.includes("freeze") && freezeSetModeled(carry));
  if (worn) {
    const share = Math.round(frozenShare(ctx, carry) * 100); // #282
    out.add("Reactions", 0, () => `Freeze: in ${carry.id}'s damage through their set's CRIT Rate on Frozen opponents (Frozen ~${share}% of the time)`);
  }
  else if (frozen) out.add("Reactions", 0, () => `Freeze: adds nothing without a set whose CRIT Rate needs it (Blizzard Strayer)`);
  // Quicken is the aura Aggravate and Spread need: with either in the carry's damage, so is what it's worth (#427).
  const quicken = kitModeled.some((r) => r === "aggravate" || r === "spread") ? ["quicken" as Reaction] : [];
  // Lunar-Bloom deals damage only through Columbina's, Lauma's and Nefer's talents, each in their own damage (#429).
  const lunarBloom = carryActive.includes("lunar-bloom") && modeledCarryDps(carry, ctx) !== null ? ["lunar-bloom" as Reaction] : [];
  const modeled = [...kitModeled, ...transformative, ...quicken, ...lunarBloom, ...(frozen ? ["freeze" as Reaction] : [])];
  const flat = carryActive.filter((r) => !modeled.includes(r));
  const mainIn = (r: Reaction) =>
    TRANSFORMATIVE[r] ? transformativeModeled(ctx, carry, r) : modelsReaction(carry, r) || transformativeModeled(ctx, carry, r) || (r === "freeze" && frozen);
  const mainModeled = main !== undefined && main !== "none" && mainIn(main);
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
    // A Base DMG converter's buff is in team damage already (#358: kit.json lunarBase, teammatesLunarBase).
    if (KIT_BUFFS[s.id]?.inLunarBase) {
      out.add("Buffs", 0, () => `${s.id}'s Base DMG bonus: in team damage`);
      continue;
    }
    // A buffer through their gear alone (Jean's and Venti's VV, Collei's Deepwood, Kachina's Scroll: no kit buff, so no
    // kit.json entry) is in a modeled carry's damage already: their benchmark set and weapon are (#338, #352, #369).
    // Standard points stay only for a carry without a damage model.
    if (!KIT_BUFFS[s.id] && inDamage) {
      out.add("Buffs", 0, () => `${s.id} buffs ${carry.id} through their gear: in team damage`);
      continue;
    }
    // How much the buff is worth comes from the kit's numbers (#68); without a readable value, standard points.
    const burst = burstSharesFor(ctx, carry).get(s) ?? 1;
    const shares = measuredShares(carry, ctx);
    const kit = kitBuffValue(s, carry, carryActive, ctx.members, false, burst, shares);
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
    // Bonuses to reactions that deal their own damage count there (transformativeLines, #256), for any carry.
    const outside = kit ? kitBuffValue(s, carry, carryActive, ctx.members, inDamage ? true : "reactions", burst, shares)! : kit;
    const base = outside ? (POINTS.buffer * outside.gain) / GAIN_FOR_POINTS : POINTS.buffer;
    const counted = kit && outside && kit.gain - outside.gain >= 0.005 ? `, ~+${Math.round((kit.gain - outside.gain) * 100)}% of it in ${carry.id}'s damage` : "";
    const est = kit ? `~+${Math.round(kit.gain * 100)}% damage${counted}` : "";
    // A Burst short of Energy funds its buffs less often (#207): say so when it's noticeable (under 95%).
    const starved = burst < 0.95 && KIT_BUFFS[s.id]?.buffs.some((b) => b.burst) ? `Burst in ~${Math.round(burst * 100)}% of rotations` : "";
    const detail = [est, level === undefined ? "" : `${talent} level ${level}`, starved].filter(Boolean).join(", ");
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
// A set whose party-wide effects are in team damage (#306, kit.ts partySetBuffs: Silken Moon's Serenade, Night of the
// Sky's Unveiling) scores there, not as points, for a modeled carry; a carry without a damage model keeps the points as
// the stand-in for their own share (their sub-DPS's and reactions' share is in damage either way).
function effectBuffLines(ctx: TeamContext, carry: ScoringCharacter, emUseful: boolean, out: Sink) {
  const seen: string[] = [];
  const inTeamDamage: string[] = [];
  const inDamage = modeledCarryDps(carry, ctx) !== null;
  for (const m of ctx.members) {
    for (const e of m.effects ?? []) {
      if (seen.length === POINTS.maxEffectBuffs) return;
      if (inDamage && e.source === "set" && (partySetModeled(e.id) || HEAL_SETS[e.id]?.some((x) => x.kind.startsWith("heal")))) {
        // Shown once, with 0 points; it takes no place under the effect cap.
        if (!inTeamDamage.includes(effectKey(e))) out.add("Effects", 0, () => `${effectName(m, e)}: party-wide, in team damage`);
        inTeamDamage.push(effectKey(e));
        continue;
      }
      // On the carry's own items, an 'active' buff only buffs the carry, which its final stats may already show.
      const fits = (b: NonNullable<typeof e.buffs>[number]) =>
        (m !== carry || b.scope === "team") && !buffMisfit(b.holderElement ? { ...b, elements: [m.element] } : b, carry, ctx, emUseful);
      // Support gear whose party ATK, DMG Bonus and RES shred are in team damage (#206, kit.ts partyGearStats): for a
      // modeled carry only its EM still scores here; with nothing else that fits, it shows at 0.
      const gearInDamage = inDamage && partyGearModeled(e.source, e.id);
      const fit = e.buffs?.find((b) => fits(b) && (!gearInDamage || b.affects === "EM"));
      if (!fit && gearInDamage && e.buffs?.some(fits) && !inTeamDamage.includes(effectKey(e))) {
        out.add("Effects", 0, () => `${effectName(m, e)}: party-wide, in team damage`);
        inTeamDamage.push(effectKey(e));
      }
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
    // Pyro, Hydro and Dendro buff one stat, so whether they help depends on the carry; Geo and Cryo are in team damage
    // for a modeled carry (#186): carryResonanceLines adds those.
    if (n >= 2 && !(el in STAT_RESONANCE) && !RESONANCE_IN_DAMAGE.has(el)) out.add("Resonance", RESONANCE[el].points, () => RESONANCE[el].name);
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

// Scored by coverage (#177): the share of the rotation a shield or healing over time is up (kit.json `sustain`,
// duration / cooldown from the talent tables), across members as 1 - product(1 - coverage). Full coverage is the
// flat `survivability` points the tag used to give. A member whose coverage can't be read (no duration in the kit:
// Jean, Beidou...) or whose role comes from an effect counts as full, as before. Per carry (#2): Arlecchino "cannot
// utilize any form of healing apart from the heal granted by her Burst cast while in combat" and "cannot rely on healers
// for survivability" (KeqingMains' Arlecchino quick guide, fetched 2026-10-18), so only shields count for her.
const SHIELDS_ONLY = new Set(["Arlecchino"]);
// Carries who heal themselves on field count as their own healer (#324): Clorinde's Impale the Night heals her "based on
// the Bond of Life value" (104% / 110% of it), her pistolet shots and Burst grant Bond of Life, and in Night Vigil
// "healing effects other than Impale the Night will not take effect" (wiki Clorinde, fetched 2026-10-22).
const SELF_HEALS = new Set(["Clorinde"]);
// Sized against incoming damage (#208; Jessie, 2026-10-18: a sourced Spiral Abyss hit, survival a factor on the team
// score as this line): the Abyss Monster Skill "Discharge", "400%" base multiplier, "15s" cooldown; Monster Skill
// effects "deal flat damage" scaling "similarly to transformative reactions", are "unaffected by your character level or
// defense", and "can be negated via shields" (KeqingMains Theorycrafting Library, Enemy Attributes, fetched
// 2026-10-18), at the level 100 Enemies and Environment multiplier, 1674.8092 (wiki Elemental Reaction/Level Scaling):
// 6,699 per hit. A shield counts by its uptime times the share of that hit it absorbs: its size from the talent table
// at the member's stats (kit.json sustain), Geo shields "1.5" x (KQM TCL, Shields). Heals keep their coverage: every
// sourced heal out-heals 6,699 per 15s. Crystallize shields count too (#205): the Geo member's level 90 base, 1851.0603,
// x (1 + 4.44 EM / (EM + 1400)) (wiki Crystallize: +29.6% at 100 EM ... +185% at 1,000), up while a Crystallize comes at
// least every 15s ("These Shield last for 15 seconds": KQM TCL, Shields); not Hydro's when it turns Lunar-Crystallize.
const INCOMING_HIT = 4 * 1674.8092;
const CRYSTALLIZE_SHIELD_90 = 1851.0603;
// A mitigation's size is its ratio of the DMG taken (#113: Xingqiu's Rain Swords, Dehya's Fiery Sanctum), counted as
// that share of the hit while it is up.
type Sized = {
  kind: string;
  size: Partial<Record<"flat" | "hp" | "def" | "atk" | "em" | "ratio", number>>;
  uptime: number | null;
  interval?: number;
  targets?: "party";
};
function sustainCoverage(m: ScoringCharacter, heals: boolean): number {
  const entry = SUSTAIN[m.id];
  if (!entry || !entry.effects?.length) return entry?.coverage ?? 1;
  const stats = subDpsStats(m) ?? carryStats(m);
  const parts = entry.effects
    .filter((e) => e.kind === "shield" || e.kind === "mitigation" || heals)
    .map((e) => {
      const up = e.uptime ?? 1;
      // Mitigation (#113): the share of the hit it takes away, whether or not the carry can be healed.
      if (e.kind === "mitigation") return up * (e.size.ratio ?? 0);
      if (e.kind !== "shield") return up;
      const absorb = (e.size.flat ?? 0) + (e.size.hp ?? 0) * stats.hp + (e.size.def ?? 0) * stats.def + (e.size.atk ?? 0) * stats.atk;
      return up * Math.min(1, (absorb * (m.element === "Geo" ? 1.5 : 1)) / INCOMING_HIT);
    });
  return 1 - parts.reduce((a, c) => a * (1 - c), 1);
}
// Healing turned into damage (#345): Ocean-Hued Clam's foam and Song of Days Past's added damage, from the wearer's
// heal rate (#351): each kit.json sustain heal's size over its interval (the wiki's; one a second where unsourced), on
// every party member for a party-wide heal (overflow counts for both sets), times its uptime. Clam: a foam every 3.5s ("Only one Sea-Dyed Foam can be produced every 3.5 seconds") of 90% of 3s of
// healing, up to 30,000 healed; no crit, "not affected by Elemental Mastery, Character Levels, or Reaction DMG
// Bonuses", Physical RES (10%). Song: a Yearning records 6s of healing (up to 15,000), then the on-field carry's next
// 5 hits gain 8% of it each, once per 6s: at the carry's crit, against 10% RES.
const HEAL_SETS = kitJson.sets as unknown as Record<string, { kind: string; value: number; max?: number }[]>;
function healPerSecond(m: ScoringCharacter): number {
  const stats = subDpsStats(m) ?? carryStats(m);
  return (SUSTAIN[m.id]?.effects ?? [])
    .filter((e) => e.kind === "heal")
    .reduce((a, e) => {
      const size = (e.size.flat ?? 0) + (e.size.hp ?? 0) * stats.hp + (e.size.def ?? 0) * stats.def + (e.size.atk ?? 0) * stats.atk + (e.size.em ?? 0) * stats.em;
      return a + ((size * (e.targets === "party" ? 4 : 1)) / (e.interval ?? 1)) * (e.uptime ?? 1);
    }, 0);
}
function healSetLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink): number {
  let total = 0;
  for (const m of ctx.members) {
    for (const { set, pieces } of setsOf(m, ctx.active, ctx.members)) {
      const e = pieces >= 4 ? HEAL_SETS[set]?.find((x) => x.kind === "healFoam" || x.kind === "healAdditive") : undefined;
      const heal = e ? healPerSecond(m) : 0;
      if (!e || heal <= 0) continue;
      const dps =
        e.kind === "healFoam"
          ? (Math.min(e.max!, heal * 3) * e.value * 0.9) / 3.5
          : carry ? ((Math.min(e.max!, heal * 6) * e.value) / 6) * expectedCrit(carry) * 0.9 : 0;
      if (dps < 1) continue;
      total += dps;
      out.add("Sub-DPS", 0, () => `${m.id}'s ${set}: ~${Math.round(dps)} damage per second`);
    }
  }
  return total;
}
function survivabilityLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  const heals = !carry || !SHIELDS_ONLY.has(carry.id);
  const healer = (m: ScoringCharacter) => hasRole(m, "healer") || (m === carry && SELF_HEALS.has(m.id));
  const sustainers = ctx.members.filter((m) => hasRole(m, "shielder") || hasRole(m, "mitigation") || (heals && healer(m)));
  const parts = sustainers.map((m) => ({ name: m.id, coverage: sustainCoverage(m, heals) }));
  const crystallize = carry ? auraBudget(ctx, carry).crystallize : null;
  if (crystallize && crystallize.perSecond > 0 && crystallize.geo.length > 0) {
    const em = Math.max(...crystallize.geo.map((m) => (subDpsStats(m) ?? carryStats(m)).em));
    const shield = CRYSTALLIZE_SHIELD_90 * (1 + (4.44 * em) / (em + 1400));
    parts.push({ name: "Crystallize shields", coverage: Math.min(1, crystallize.perSecond * 15) * Math.min(1, shield / INCOMING_HIT) });
  }
  if (parts.length) {
    const coverage = 1 - parts.reduce((a, p) => a * (1 - p.coverage), 1);
    const names = parts.map((p) => p.name).join(", ");
    const mitigates = sustainers.some((m) => hasRole(m, "mitigation"));
    const verb = mitigates ? (heals ? "heal, shield or mitigate" : "shield or mitigate") : heals ? "heal or shield" : "shield";
    const reason = () => `${names} ${verb} ~${Math.round(coverage * 100)}% of an Abyss hit per rotation`;
    out.add("Survivability", Math.round(POINTS.survivability * coverage), reason);
  } else {
    const reason = () => (heals ? "No healer or shielder" : `No shielder (${carry!.id} can't be healed)`);
    out.add("Survivability", POINTS.noSurvivability, reason);
  }
}

function carryResonanceLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  // A modeled carry's team damage has them (#186, kit.ts resonanceStats): said at 0 points.
  const inDamage = !!carry && modeledCarryDps(carry, ctx) !== null;
  for (const el of RESONANCE_IN_DAMAGE as Set<Element>) {
    if (ctx.members.filter((m) => m.element === el).length < 2) continue;
    const { name, points } = RESONANCE[el];
    if (inDamage) out.add("Resonance", 0, () => `${name}: in team damage`);
    else if (!(el in STAT_RESONANCE)) out.add("Resonance", points, () => name); // Geo, Cryo: as before
  }
  if (inDamage) return;
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
const SUSTAIN = kitJson.sustain as unknown as Record<string, { coverage: number | null; missing?: string; effects?: Sized[] }>;
const KIT_BUFFS = kitJson.characters as Record<
  string,
  { base: { atk: number } | null; buildFor?: { atk?: number }; buffs: { kind: string; value: number; threshold?: number; max?: number; burst?: boolean }[]; inLunarBase?: boolean }
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
  // is inside the carry's damage (carryDamagePerSecond reads it with Gleam on), so the line says what it adds with 0
  // points (#245: as points it counted twice, Flins +35). Upgrades not modeled yet keep the flat points.
  if (moonsign.includes(carry) && GLEAM[carry.id]?.target === "self") {
    const share = carryAmpShare(ctx, carry);
    const withGleam = modelsAscendantGleam(carry.id) ? carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, false, share, frozenShare(ctx, carry)) : null;
    const without = withGleam ? carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, true, share, frozenShare(ctx, carry)) : null;
    if (withGleam && without && withGleam.missing.length === 0 && without.perSecond > 0) {
      const gain = withGleam.perSecond / without.perSecond - 1;
      if (gain > 0) out.add("Moonsign", 0, () => `Ascendant Gleam adds ~+${Math.round(gain * 100)}% to ${carry.id}'s damage`);
    } else {
      out.add("Moonsign", POINTS.ownAscendantGleam, () => `Ascendant Gleam enhances ${carry.id}'s kit`);
    }
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  const usesEm = carry.scalesOn?.includes("EM") || usesEmReaction(carry, ctx);
  const inDamage = modeledCarryDps(carry, ctx) !== null;
  for (const m of moonsign) {
    const g = GLEAM[m.id];
    if (m === carry || g?.target !== "party") continue;
    const fits = g.values.filter(
      (v) => (!v.elements || v.elements.includes(carry.element)) && (!v.reactions || v.reactions.some((r) => dealt.includes(r as Reaction))),
    );
    // A value for some reactions (Lauma's Lunar-Bloom crit) only reaches that share of the carry's damage (#87).
    const sum = (kind: GleamValue["kind"]) =>
      fits.filter((v) => v.kind === kind).reduce((a, v) => a + v.value * (v.reactions ? reactionShare(carry, v.reactions, dealt, measuredShares(carry, ctx)) : 1), 0);
    // Linnea's extra Geo shred stacks on her base shred, so it is worth less than the same shred alone.
    // For a modeled carry it is in team damage (#204, kit.ts familyBuffStats).
    const baseShred = KIT_BUFFS[m.id]?.buffs.filter((b) => b.kind === "resShred").reduce((a, b) => a + b.value, 0) ?? 0;
    const shred = inDamage ? 0 : resShredGain(sum("resShred"), baseShred);
    const gain = (1 + critGain(sum("critRate"), sum("critDmg"))) * (1 + (usesEm ? emGain(sum("em")) : 0)) * (1 + shred) - 1;
    const points = gainPoints(gain, POINTS.buffer);
    if (points > 0) out.add("Moonsign", points, () => `Ascendant Gleam: ${m.id} gives ${carry.id} ~+${Math.round(gain * 100)}% damage`);
    else if (inDamage && sum("resShred") > 0) out.add("Moonsign", 0, () => `Ascendant Gleam: ${m.id}: in team damage`);
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
      ? dmgBonusGain(value) * reactionShare(carry, v.reactions ?? [], dealt, measuredShares(carry, ctx))
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
// upgrade (Lohen, Razor, Varka) counts as ownSecretRite; when their damage model has it (Klee: damage.ts
// modelsSecretRite) it is in their damage, so the line has 0 points (#241). A member's party buff (Albedo, Sucrose,
// Fischl, Venti, Durin, Nicole, Prune) counts by the damage it adds to the carry. Some only reach Hexerei members
// (Albedo's Silver Isotoma, Sucrose's Large Wind Spirit, Nicole's Arcane Projections), so a Hexerei carry gets more.
function secretRiteLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  if (!carry) return;
  const hexerei = ctx.members.filter((m) => familiesOf(m, ctx.options).includes("hexerei"));
  if (hexerei.length < 2) return;
  if (hexerei.includes(carry) && SECRET_RITE[carry.id]?.target === "self") {
    const modeled = modelsSecretRite(carry.id);
    const points = modeled ? 0 : POINTS.ownSecretRite;
    out.add("Hexerei", points, () => `Secret Rite enhances ${carry.id}'s kit${modeled ? " (in their damage)" : ""}`);
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  for (const m of hexerei) {
    const entry = SECRET_RITE[m.id];
    if (m === carry || entry?.target !== "party") continue;
    partyValueLine("Hexerei", `Secret Rite: ${m.id}`, entry.values, m, carry, ctx, dealt, out);
  }
}

// A member's family party values as a line (#204): for a modeled carry their DMG Bonus, ATK % and RES shred are in
// team damage (kit.ts familyBuffStats), so the points are for the rest, and a line with nothing else says so at 0.
function partyValueLine(rule: string, who: string, values: PartyValue[], m: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext, dealt: Reaction[], out: Sink) {
  const inDamage = modeledCarryDps(carry, ctx) !== null;
  const gain = partyValuesGain(inDamage ? values.filter((v) => !FAMILY_IN_DAMAGE.has(v.kind)) : values, m, carry, ctx, dealt);
  const points = gainPoints(gain, POINTS.buffer);
  if (points > 0) out.add(rule, points, () => `${who} gives ${carry.id} ~+${Math.round(gain * 100)}% damage`);
  else if (inDamage && partyValuesGain(values, m, carry, ctx, dealt) >= 0.005) out.add(rule, 0, () => `${who}: in team damage`);
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
  // The Polestar Field's DMG Bonus is in a modeled carry's damage (kit.ts polestarStats, #327).
  const polestar = ctx.active.includes("stellar-conduct") && (carry.element === "Cryo" || carry.element === "Electro");
  if (polestar && modeledCarryDps(carry, ctx) !== null) out.add("Stellar", 0, () => "Polestar Field: +40% Cryo and Electro DMG Bonus, in team damage");
  const stellar = ctx.members.filter((m) => familiesOf(m, ctx.options).includes("stellar"));
  const own = stellar.includes(carry) ? STELLAR[carry.id] : undefined;
  const on = own?.radiance.filter((r) => ctx.active.includes(r)) ?? [];
  if (own?.target === "self" && on.length > 0) {
    // In the carry's damage when their model has it (Mizuki, #235): said with 0 points, as for Ascendant Gleam (#245).
    const inDamage = modelsRadiance(carry.id);
    out.add("Stellar", inDamage ? 0 : POINTS.ownRadiance, () => `Radiance: ${on.map(label).join(", ")} enhances ${carry.id}'s kit${inDamage ? " (in their damage)" : ""}`);
  }
  const dealt = carry.reactions.filter((r) => ctx.active.includes(r));
  for (const m of stellar) {
    const entry = STELLAR[m.id];
    if (m === carry || entry?.target !== "party") continue;
    partyValueLine("Stellar", `${m.id}'s Stellar buff`, entry.values, m, carry, ctx, dealt, out);
  }
}

type NightsoulBurstEntry =
  | { target: "own"; note: string; kind?: "em" | "dmgBonus" | "defPct"; value?: number; duration?: number; source: string }
  | { target: "self"; kind?: "atkPct"; value?: number; duration: number | null; maxStacks: number; inDamage?: boolean; source: string };
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
// Mualani's and Chasca's kit upgrade as ownNightsoulBurst. Either way, by how much of it a faster cooldown keeps up:
// average stacks (each lasts `duration`, up to maxStacks) or, for a one-off like Chasca's shot, how often. Kinich's
// (inDamage) is in his Cannon damage instead (#288, damage.ts), so no points here.
// A member's own Nightsoul Burst effect on their own hits (#98: Kachina's Geo DMG, Xilonen's DEF, Ifa's EM), as its
// average over a rotation: the value times the share of the time it is up (its duration per Nightsoul Burst cooldown),
// or nothing without a Natlanese member to trigger one.
function ownNightsoulBuff(m: ScoringCharacter, ctx: TeamContext): { kind: "em" | "dmgBonus" | "defPct"; value: number } | null {
  const entry = NIGHTSOUL_BURST.characters[m.id];
  if (entry?.target !== "own" || !entry.kind) return null;
  const natlanese = ctx.members.filter(
    (x) => familiesOf(x, ctx.options).includes("nightsoul") && !NIGHTSOUL_BURST.notNatlanese.includes(x.id),
  ).length;
  if (natlanese === 0) return null;
  return { kind: entry.kind, value: entry.value! * Math.min(1, entry.duration! / nightsoulCooldown(natlanese)) };
}

function nightsoulBurstLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink) {
  const entry = carry && NIGHTSOUL_BURST.characters[carry.id];
  if (!carry || entry?.target !== "self" || entry.inDamage) return;
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
  when?: SourceWhen; // like a carry hit's `when` (Jahoda's robots, #100)
  // More DMG on this source's hits while `when` holds (Venti's Stormeye at 135% under Secret Rite, #98): 1 + value.
  factor?: { value: number; when: SourceWhen };
  // Other rates for teams that fit: the first whose `when` matches replaces hits/every/duration (Jahoda, #175).
  alternatives?: { when: { topElement?: Element; radiance?: boolean; constellation?: number; ascendantGleam?: boolean }; hits?: number; every?: number; duration?: number; cd?: number; perRotation?: boolean }[];
  perRotation?: boolean; // cast once per rotation: the cd is at least the carry's rotation (Yae's totems before her quest, #304)
  dmgBonusPerStat?: Partial<Record<ScaleStat, number>>; // DMG Bonus per point of a stat (Dendro Traveler, #172)
  // More DMG on the first `stacks` hits per use, by a share of a stat, capped (Durin's Primordial Fusion, #195).
  boost?: { stacks: number; perPoint: number; stat: ScaleStat; max: number };
  icd?: "none" | { reset: number; every: number | "first" }; // elemental application ICD (#190); default standard
  pickOne?: string; // one source of the group per use, picked by the team's reactions
  // More Vaporize/Melt DMG on this source's own reactions while `when` holds (Durin's Dark Decay, #316): amplifyGain's bonus.
  reactionBonus?: { value: number; reactions: Reaction[]; when?: SourceWhen }[];
  talent?: string; // the talent the hit is from: "burst" hits need the Burst's Energy (#37)
  burstFunded?: boolean; // another talent's hits that need the Burst too (Yelan's C6 Mastermind barbs, #106)
  cd: number;
}
// When a sub-DPS source hits (sourceFits). reaction / reactions: the team triggers it / one of them; ascendantGleam: two
// Moonsign members; radiance: the member's own Stellar family is active (Witch's Revelation done; their Radiance then
// needs the Stellar reaction too, as `reaction`); secretRite: two Hexerei members; carryReactions: the carry deals one
// of them (Venti's Secret Rite needs the active character's own Swirl); unless: the team triggers none of them;
// constellation: the sub-DPS is at least that constellation (Escoffier's C6 Parfaits, #106).
type SourceWhen = {
  ascendantGleam?: boolean;
  reaction?: Reaction;
  reactions?: Reaction[];
  unless?: Reaction[];
  radiance?: boolean;
  secretRite?: boolean;
  carryReactions?: Reaction[];
  constellation?: number;
};
// lunarBaseBonus: their own Moonsign Benediction's Base DMG bonus to their direct Lunar hits (PR #155); teammates' add
// to it (teammatesLunarBase, #88).
type SubDpsLunarBase = { stat: "atk" | "hp" | "def" | "em"; perPoint: number; max: number; reactions: Reaction[] };
// base: level 90 character base stats from genshin-db, for the benchmark build (#158).
type SubDpsEntry = { base: SubDpsBase | null; sources: SubDpsSource[]; missing?: string[]; lunarBaseBonus?: SubDpsLunarBase };
const SUB_DPS = kitJson.subDps as Record<string, SubDpsEntry>;

// Moonsign Benediction (#88): every Lunar converter in the party raises the Base DMG of their Lunar reactions by their
// own stat, capped (kit.json lunarBase, from passive 3). The wiki's formula has one "% Reaction Base DMG Bonus" term,
// so converters' bonuses add. A converter's stat: their build, else their sub-DPS benchmark, else a carry's (Flins,
// Zibai, Nefer). Their own bonus to their own hits is already in (subDps lunarBaseBonus, the carry's kit buff).
const LUNAR_BASE = kitJson.lunarBase as Record<string, SubDpsLunarBase>;
// Stellar converters too (Odette, Sandrone, Vesna, Cryo Traveler; #235): kit.json lunarBase holds both families.
function teammatesLunarBase(r: Reaction, members: readonly ScoringCharacter[], self?: ScoringCharacter): number {
  let sum = 0;
  for (const m of members) {
    const b = LUNAR_BASE[m.id];
    if (m === self || !b?.reactions.includes(r)) continue;
    const stats = subDpsStats(m) ?? carryStats(m);
    sum += Math.min(b.max, b.perPoint * stats[b.stat]);
  }
  return sum;
}
// With the Stellar reactions: the converters' Base DMG bonus reaches direct Stellar hits too (Mizuki's, #235; Cryo
// Traveler's Stellar-Conduct Burst, #236).
const LUNAR_REACTIONS: LunarReaction[] = ["lunar-charged", "lunar-bloom", "lunar-crystallize", "stellar-swirl", "stellar-conduct"];
// The share of rotations each member's Burst is funded with this carry (#37, energy.ts), for the buffs from it (#207):
// the same reading their Burst damage uses (subDpsLines, carry damage's burstShare).
function burstSharesFor(ctx: TeamContext, carry: ScoringCharacter): BurstShares {
  let shares = ctx.burstShares.get(carry);
  if (!shares) {
    const needs = energyNeeds(ctx.members, carry, carryRotationSeconds(carry, ctx.active, ctx.members));
    ctx.burstShares.set(carry, (shares = new Map([...needs].map(([m, n]) => [m, n.share]))));
  }
  return shares;
}

// The carry's team buffs (#157), with teammates' Lunar Base DMG bonuses (#88) and funded Burst shares (#207).
function carryTeamBuffs(carry: ScoringCharacter, ctx: TeamContext): TeamBuffStats {
  const lunarBase: Partial<Record<Reaction, number>> = {};
  for (const r of LUNAR_REACTIONS) {
    const v = teammatesLunarBase(r, ctx.members, carry);
    if (v > 0) lunarBase[r] = v;
  }
  const burstShares = burstSharesFor(ctx, carry);
  return { ...teamBuffStats(carry, carry.reactions.filter((r) => ctx.active.includes(r)), ctx.members, burstShares, ctx.active), lunarBase, burstShares };
}

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
// Cached per character object (#215): a benchmark build depends only on them, and every team asks again.
const statsCache = new WeakMap<ScoringCharacter, SubDpsStats | null>();
export function subDpsStats(m: ScoringCharacter): SubDpsStats | null {
  if (statsCache.has(m)) return statsCache.get(m)!;
  const stats = readSubDpsStats(m);
  statsCache.set(m, stats);
  return stats;
}

function readSubDpsStats(m: ScoringCharacter): SubDpsStats | null {
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

// A source's `when` (#98), on the quest-adjusted team (questView, #124) as for carry hits (damage.ts).
function sourceFits(w: SourceWhen, carry: ScoringCharacter, ctx: TeamContext, sub: ScoringCharacter): boolean {
  const count = (family: "moonsign" | "hexerei") => ctx.members.filter((m) => m.families?.includes(family)).length;
  return (
    (!w.reaction || ctx.active.includes(w.reaction)) &&
    (!w.reactions || w.reactions.some((r) => ctx.active.includes(r))) &&
    !(w.unless ?? []).some((r) => ctx.active.includes(r)) &&
    (!w.ascendantGleam || count("moonsign") >= 2) && // Ascendant Gleam is two Moonsign members (Jahoda's robots)
    (!w.radiance || !!sub.families?.includes("stellar")) &&
    (!w.secretRite || (!!sub.families?.includes("hexerei") && count("hexerei") >= 2)) &&
    (!w.carryReactions || w.carryReactions.some((r) => carry.reactions.includes(r) && ctx.active.includes(r))) &&
    (!w.constellation || (sub.constellation ?? 0) >= w.constellation)
  );
}

// Hits per second of one source, averaged over its cooldown; 0 when it can't fire in this team.
function hitsPerSecond(source: SubDpsSource, carry: ScoringCharacter, ctx: TeamContext, sub: ScoringCharacter): number {
  // radiance: their own Stellar family is active, i.e. their Witch's Revelation done (the team is quest-adjusted:
  // questView, #124): Yae's 24s totems (#304). constellation: at least that one (Xingqiu's C6 swords, #106).
  // ascendantGleam: two Moonsign members (Aino's faster water balls, #159).
  const alt = source.alternatives?.find(
    (a) =>
      (!a.when.topElement || a.when.topElement === topElement(ctx.members)) &&
      (!a.when.radiance || !!sub.families?.includes("stellar")) &&
      (!a.when.constellation || (sub.constellation ?? 0) >= a.when.constellation) &&
      (!a.when.ascendantGleam || ctx.members.filter((m) => m.families?.includes("moonsign")).length >= 2),
  );
  const s = alt ? { ...source, ...alt, when: source.when } : source;
  if (s.onCarryNormal && !normalAttacks(carry)) return 0; // Xingqiu's rain swords need the carry's Normal Attacks
  if (s.needsReaction && ctx.active.length === 0) return 0; // Nahida's Tri-Karma needs a reaction
  if (s.whenReaction && !ctx.active.includes(s.whenReaction)) return 0; // Ineffa's Overclocking Circuit: thunderclouds
  // A source's `when`, as for carry hits (damage.ts): Ascendant Gleam is two Moonsign members (Jahoda's robots, #100).
  if (s.when && !sourceFits(s.when, carry, ctx, sub)) return 0;
  const perUse = s.every !== undefined ? Math.min(s.duration!, s.cd) / s.every : 1;
  // A Burst is cast at most once per rotation (#186), as the Energy model funds it (energy.ts energyNeeds, #37): Albedo's
  // 12s cooldown counted his Burst every 12s in a 20s rotation.
  const cd = s.perRotation || s.talent === "burst" || s.burstFunded ? Math.max(s.cd, carryRotationSeconds(carry, ctx.active, ctx.members) ?? s.cd) : s.cd;
  // Furina's Salon bonus needs members above 50% HP, which takes another healer (#130).
  const healed = ctx.members.some((m) => m !== sub && m.roles.includes("healer"));
  const times = s.timesNeedsHealer && !healed ? 1 : (s.times ?? 1);
  return ((s.hits ?? 1) * perUse * times) / cd;
}

// For each `pickOne` group, the source that fires (#151): Columbina's Gravity Interference takes the type of the Lunar
// reaction that built the most Gravity. Read as the carry's main reaction when the team triggers it, else the first
// active one in kit order.
// A source with a `when` that fits beats one without (Durin's Darkness form over his Purity form, #316).
function pickedSources(sources: SubDpsSource[], carry: ScoringCharacter, ctx: TeamContext, sub: ScoringCharacter): Map<string, SubDpsSource> {
  const out = new Map<string, SubDpsSource>();
  const main = mainReactionOf(carry);
  for (const s of sources) {
    if (!s.pickOne || (s.whenReaction && !ctx.active.includes(s.whenReaction))) continue;
    if (s.when && !sourceFits(s.when, carry, ctx, sub)) continue;
    const current = out.get(s.pickOne);
    if (!current || s.whenReaction === main || (s.when && !current.when)) out.set(s.pickOne, s);
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
// (estimate). Spread and Aggravate don't consume the Quicken aura; they take the share of time it is up (`quicken` below, #303).
// Reactions per aura application (#329): whole, at least 1. "Gauge Result = Gauge Aura - Reaction Coefficient x Gauge
// Trigger", floored at 0: "a target with 2 units of Cryo Aura can only have Pyro Melt triggered on it once using a
// trigger of 1 unit of Pyro" (Genshin Impact Wiki, Elemental Gauge Theory, fetched 2026-10-22). So a 1x or 2x trigger
// reacts once on the 0.8U aura and clears it (was 0.8 and 0.4); a 0.5x one keeps 0.8 / 0.5 = 1.6 on average, under the
// 2 that fit, since "the decay of elemental aura and internal cooldown ... might negatively impact the ability to
// repeatedly trigger reactions" (same page).
const perAuraApp = (coefficient: number) => Math.max(1, 0.8 / coefficient);
const AMPLIFYING: Partial<Record<Reaction, Element>> = { vaporize: "Hydro", melt: "Pyro" }; // the strong-side trigger
const CATALYZING: Partial<Record<Reaction, Element>> = { spread: "Dendro", aggravate: "Electro" }; // the trigger on Quicken
function applicationsPerSecond(x: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext): number {
  if (x === carry) {
    const rates = carryHitRates(carry, ctx.active, ctx.members);
    if (!rates) return 0;
    const h = rates.hitsPerSecond;
    return Math.max(h / STANDARD_ICD.every, Math.min(h, 1 / STANDARD_ICD.reset));
  }
  const entry = SUB_DPS[x.id];
  if (!entry) return 0;
  const picked = pickedSources(entry.sources, carry, ctx, x);
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
// The share of the carry's own Vaporize or Melt hits their pair's aura feeds (#239), or of their Spread or Aggravate
// hits that find a Quicken aura (#303); 1 when nothing else claims it.
function carryAmpShare(ctx: TeamContext, carry: ScoringCharacter): number {
  return auraBudget(ctx, carry).carry;
}
// The share of the time the enemy is Frozen (#282), for Blizzard Strayer's "If the opponent is Frozen".
function frozenShare(ctx: TeamContext, carry: ScoringCharacter): number {
  return auraBudget(ctx, carry).frozen;
}
const budgetCache = new WeakMap<TeamContext, Map<ScoringCharacter, ReturnType<typeof computeAuraBudget>>>();
function auraBudget(ctx: TeamContext, carry: ScoringCharacter) {
  let byCarry = budgetCache.get(ctx);
  if (!byCarry) budgetCache.set(ctx, (byCarry = new Map()));
  if (!byCarry.has(carry)) byCarry.set(carry, computeAuraBudget(ctx, carry));
  return byCarry.get(carry)!;
}
function computeAuraBudget(ctx: TeamContext, carry: ScoringCharacter) {
  const out = new Map<ScoringCharacter, Map<Reaction, number>>();
  const apps = new Map<Element, number>();
  // Each member's applications per second, read once (the rounds below ask for them many times).
  const appsOf = new Map(ctx.members.map((x) => [x, applicationsPerSecond(x, carry, ctx)]));
  const appsBy = (x: ScoringCharacter) => appsOf.get(x)!;
  for (const x of ctx.members) apps.set(x.element, (apps.get(x.element) ?? 0) + appsBy(x));
  const full = new Map(apps);
  const perAuraOf = (r: Reaction, trigger: Element) => perAuraApp(trigger === AMPLIFYING[r] ? 2 : 0.5);
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
    const demand = Math.min(own.reactingPerSecond, appsBy(carry));
    if (demand > 0) {
      const perAura = perAuraOf(r, carry.element);
      const reactions = Math.min(demand, (apps.get(aura) ?? 0) * perAura);
      carryShare = reactions / demand;
      apps.set(aura, (apps.get(aura) ?? 0) - reactions / perAura);
      apps.set(carry.element, (apps.get(carry.element) ?? 0) - reactions);
    }
  }
  // Each (trigger, aura) pair asks for its applying hits, as many as its element has left; when an aura falls short, the
  // pairs on it get the same fraction of what they asked. Damped rounds settle it. Vaporize and Melt pairs are the
  // sub-DPS' (the carry's own came first, above); Overloaded and Swirl pairs (#205) take the carry's applications too,
  // since their damage is a separate instance, not a multiplier on the carry's hits. Overloaded: Pyro on Electro or
  // Electro on Pyro, 1x unit modifier; Swirl: Anemo on any aura element, 0.5x (Genshin Impact Wiki, Elemental Gauge
  // Theory, fetched 2026-10-18).
  type Pair = {
    r: Reaction;
    trigger: Element;
    aura: Element;
    perAura: number;
    members: ScoringCharacter[];
    asked: number;
    demand: number;
    reactions: number;
  };
  const pairs: Pair[] = [];
  const addPair = (r: Reaction, trigger: Element, aura: Element, perAura: number, withCarry: boolean) => {
    const fires = (m: ScoringCharacter) => (m === carry ? withCarry : !!SUB_DPS[m.id]);
    const members = ctx.members.filter((m) => m.element === trigger && fires(m));
    const asked = members.reduce((s, m) => s + appsBy(m), 0);
    const left = (full.get(trigger) ?? 0) > 0 ? Math.max(0, apps.get(trigger) ?? 0) / full.get(trigger)! : 0;
    if (asked === 0 || !(full.get(aura) ?? 0)) return;
    pairs.push({ r, trigger, aura, perAura, members, asked, demand: asked * left, reactions: 0 });
  };
  for (const r of active) {
    const [a, b] = reactionElements(r);
    addPair(r, a, b, perAuraOf(r, a), false);
    addPair(r, b, a, perAuraOf(r, b), false);
  }
  const free = (r: Reaction) => ctx.active.includes(r) && !convertedAway(ctx, r);
  if (free("overloaded")) {
    addPair("overloaded", "Pyro", "Electro", perAuraApp(1), true);
    addPair("overloaded", "Electro", "Pyro", perAuraApp(1), true);
  }
  if (ctx.active.includes("swirl")) {
    for (const aura of swirlAuras(ctx)) addPair("swirl", "Anemo", aura, perAuraApp(0.5), true);
  }
  if (free("superconduct")) {
    addPair("superconduct", "Electro", "Cryo", perAuraApp(1), true);
    addPair("superconduct", "Cryo", "Electro", perAuraApp(1), true);
  }
  // Reactions that use auras too (#253). Bloom: Dendro on Hydro (2x) or Hydro on Dendro (0.5x), each makes a Dendro Core
  // (wiki Bloom; transformativeLines pops them), none with Lunar-Bloom in the team, which takes the same auras. Quicken:
  // Dendro and Electro (1x); no damage of its own (Spread and Aggravate add to hits and don't consume it: wiki Quicken),
  // and it is taken as used up like a trigger, though the Quicken aura lasts (estimate). Crystallize: Geo on any aura
  // (0.5x), at most once a second on a target (wiki Crystallize); its shields count under survival (#208), not here.
  const anyActive = (rs: Reaction[]) => rs.some((r) => ctx.active.includes(r));
  if (anyActive(["bloom", "hyperbloom", "burgeon", "lunar-bloom"])) {
    addPair("bloom", "Dendro", "Hydro", perAuraApp(2), true);
    addPair("bloom", "Hydro", "Dendro", perAuraApp(0.5), true);
  }
  if (anyActive(["quicken", "aggravate", "spread"])) {
    addPair("quicken", "Dendro", "Electro", perAuraApp(1), true);
    addPair("quicken", "Electro", "Dendro", perAuraApp(1), true);
  }
  // Frozen (#282): Hydro on Cryo or Cryo on Hydro, 1x ("Gauge_Reaction = min(Gauge_Origin Aura, Gauge_Trigger
  // Element)": wiki Elemental Gauge Theory/Advanced Mechanics § Frozen, fetched 2026-10-28).
  if (ctx.active.includes("freeze")) {
    addPair("freeze", "Hydro", "Cryo", perAuraApp(1), true);
    addPair("freeze", "Cryo", "Hydro", perAuraApp(1), true);
  }
  // Stellar Swirl (#235): Anemo on Cryo, like Swirl (0.5x), replacing the Cryo Swirl (swirlAuras).
  if (ctx.active.includes("stellar-swirl")) addPair("stellar-swirl", "Anemo", "Cryo", perAuraApp(0.5), true);
  if (anyActive(["crystallize", "lunar-crystallize"])) {
    for (const aura of SWIRLABLE) addPair("crystallize", "Geo", aura, perAuraApp(0.5), true);
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
    // An application reacts once (#205): a trigger element in several pairs (Pyro vaporizing Hydro and overloading
    // Electro, Anemo swirling two auras) splits its applications between them.
    for (const t of new Set(pairs.map((p) => p.trigger))) {
      const mine = pairs.filter((p) => p.trigger === t);
      const used = mine.reduce((s, p) => s + p.reactions, 0);
      const left = (full.get(t) ?? 0) > 0 ? Math.max(0, apps.get(t) ?? 0) / full.get(t)! : 0;
      const firing = [...new Set(mine.flatMap((p) => p.members))];
      const supply = firing.reduce((s, m) => s + appsBy(m), 0) * left;
      const cap = t === "Geo" ? Math.min(CRYSTALLIZE_PER_SECOND, supply) : supply;
      if (used > cap) for (const p of mine) p.reactions *= cap / used;
    }
  }
  // Spread and Aggravate (#303): a Dendro or Electro hit on a Quicken aura; they "will not consume the Quicken Aura"
  // (wiki Quicken, fetched 2026-10-21) nor the hit's element, so the same hit can still Bloom or Quicken. What limits
  // them is the aura being there: it lasts gauge x 5 + 6 seconds, 10s from 0.8U (wiki Elemental Gauge Theory/Advanced
  // Mechanics § Quicken), and "Inflicting Pyro or Hydro on a Quicken Aura will consume it to trigger Burning or Bloom"
  // (wiki Quicken; KQM Library, Additive Reactions: it "acts as a Dendro aura when being reacted with Pyro or Hydro").
  // Hydro on it takes 0.5U (0.5x, as on Dendro), so 1.6 Hydro applications end one; a Pyro application ends it (Burning
  // eats it at 0.4U/s or more: estimate). Hydro and Pyro spent amplifying first don't reach it ("Vaporize will occur
  // first, and Bloom will occur if Hydro was not fully consumed": wiki Simultaneous Reaction Priority). Taking those
  // as random arrivals at rate c, an aura lasts (1 - e^(-10c)) / c on average, and the Quicken pairs above make one
  // each reaction: uptime = min(1, Quickens per second x that), the share of Spread and Aggravate hits that find it
  // (estimate). Every Spread or Aggravate hit, the carry's and sub-DPS', gets it. Before, every applying Dendro or
  // Electro hit counted next to a Hydro teammate, and the same Dendro hit both Spread and fed Bloom (Alhaitham with
  // Furina, #303). When Dendro or Electro has no modeled applier (no sub-DPS entry), 1 stays as the stand-in.
  const quickens = pairs.filter((p) => p.r === "quicken").reduce((s, p) => s + p.reactions, 0);
  const amplified = (e: Element) => pairs.filter((p) => p.trigger === e && AMPLIFYING[p.r]).reduce((s, p) => s + p.reactions, 0);
  const reaching = (e: Element) => Math.max(0, (apps.get(e) ?? 0) - amplified(e));
  const eaten = reaching("Hydro") / perAuraApp(0.5) + reaching("Pyro");
  const lasts = eaten > 0 ? (1 - Math.exp(-QUICKEN_SECONDS * eaten)) / eaten : QUICKEN_SECONDS;
  const modeled = (full.get("Dendro") ?? 0) > 0 && (full.get("Electro") ?? 0) > 0;
  const quicken = modeled ? Math.min(1, quickens * lasts) : 1;
  if (own && CATALYZING[own.reaction as Reaction] === carry.element && ctx.active.includes(own.reaction as Reaction)) carryShare = quicken;
  const transformative: Trigger[] = [];
  for (const p of pairs) {
    const share = Math.min(1, p.reactions / p.asked);
    for (const m of p.members) {
      if (AMPLIFYING[p.r]) {
        if (!out.has(m)) out.set(m, new Map());
        out.get(m)!.set(p.r, share);
      } else if (TRANSFORMATIVE[p.r]) {
        const perSecond = share * appsBy(m); // Bloom: the Dendro Cores this member makes
        if (perSecond > 0) transformative.push({ m, r: p.r, aura: p.aura, perSecond });
      }
    }
  }
  // Electro-Charged (#205): not a trigger on an aura but a state while the target holds both, ticking once a second;
  // each tick takes 0.4U of each aura, so one 1U application (0.8U after the Aura Tax) feeds 2 ticks. From the Hydro and
  // Electro applications the pairs above left (reactions with Electro come first on an Electro-Charged target: wiki),
  // credited to their appliers by share. Not with Lunar-Charged in the team: the converter turns it into that (CONVERTED).
  const spent = (e: Element) =>
    pairs.reduce((s, p) => s + (p.trigger === e ? p.reactions : 0) + (p.aura === e ? p.reactions / p.perAura : 0), 0);
  const leftOf = (e: Element) => Math.max(0, (apps.get(e) ?? 0) - spent(e));
  // A state's ticks, credited to the appliers of its elements by share of applications.
  const credit = (r: Reaction, aura: Element, elements: Element[], ticks: number) => {
    const appliers = ctx.members.filter((m) => elements.includes(m.element) && appsBy(m) > 0);
    const all = appliers.reduce((s, m) => s + appsBy(m), 0);
    for (const m of ticks > 0 ? appliers : []) transformative.push({ m, r, aura, perSecond: (ticks * appsBy(m)) / all });
  };
  if (free("electrocharged")) {
    credit("electrocharged", "Electro", ["Hydro", "Electro"], Math.min(1, 2 * leftOf("Hydro"), 2 * leftOf("Electro")));
  }
  // Burning (#205): a state too. It ticks every 0.25s (KQM, pasted by Jessie 2026-10-18), owned by whoever last refreshed
  // it with Dendro or Pyro, and while it lasts the Dendro aura is used at max(0.4, 2x its natural decay) U/s, 0.4 for a
  // normal aura (wiki Elemental Gauge Theory/Advanced Mechanics § Burning): one 1U application (0.8U) keeps it 2s. Up as
  // long as the Dendro the pairs above left can feed it, with a Pyro applier to light it; refreshes don't use Pyro.
  if (free("burning") && (apps.get("Pyro") ?? 0) > 0) {
    credit("burning", "Pyro", ["Pyro", "Dendro"], 4 * Math.min(1, 2 * leftOf("Dendro")));
  }
  // Indirect Lunar damage (#145): Lunar-Charged thunderclouds strike "every 2s" while the target is Wet and affected by
  // Electro, each strike taking "0.4 GU of both the Wet and Electro auras" (wiki Lunar-Charged § Damage, fetched
  // 2026-10-18), so from the Hydro and Electro the pairs above left, like Electro-Charged's ticks; with a converter
  // Electro-Charged doesn't happen (CONVERTED). Lunar-Crystallize: "every third Lunar-Crystallize reaction will cause
  // Moondrifts to resonate and initiate Moondrift Harmony" (wiki Lunar-Crystallize): a third of the Geo-on-Hydro pairs.
  // Lunar-Bloom has no indirect damage (wiki Damage § Indirect).
  const indirect: Indirect[] = [];
  if (ctx.active.includes("lunar-charged")) {
    const perSecond = Math.min(0.5, 2 * leftOf("Hydro"), 2 * leftOf("Electro"));
    indirect.push({ r: "lunar-charged", what: "thunderclouds", perSecond, coefficient: LUNAR_COEFFICIENT["lunar-charged"], element: "Electro" });
  }
  if (ctx.active.includes("lunar-crystallize")) {
    const hydro = pairs.filter((p) => p.r === "crystallize" && p.aura === "Hydro").reduce((s, p) => s + p.reactions, 0);
    indirect.push({ r: "lunar-crystallize", what: "Moondrift Harmony", perSecond: hydro / 3, coefficient: LUNAR_COEFFICIENT["lunar-crystallize"], element: "Geo" });
  }
  // Stellar Swirl (#235; wiki Stellar Swirl § Damage, fetched 2026-10-18): each trigger deals "an instance of Anemo DMG"
  // (coefficient 0.75, wiki Damage § Indirect) and makes a Lv. 1 Stellar Vortex that "lasts for 3s" and explodes as
  // Cryo (2); "After triggering Stellar Swirl for the third time, the Vortex will level up to Lv. 2" (3), and "three
  // more times" explode it at once. So a vortex takes the triggers of its 3s, 1 + 3 x rate, at most 6: worked out here
  // from those rules (estimate), one explosion per that many triggers.
  const stellar = pairs.filter((p) => p.r === "stellar-swirl").reduce((s, p) => s + p.reactions, 0);
  if (stellar > 0) {
    const perVortex = Math.min(6, 1 + 3 * stellar);
    const lv2 = perVortex >= 3;
    indirect.push({ r: "stellar-swirl", what: "Anemo hits", perSecond: stellar, coefficient: 0.75, element: "Anemo" });
    indirect.push({ r: "stellar-swirl", what: `Stellar Vortex Lv. ${lv2 ? 2 : 1}`, perSecond: stellar / perVortex, coefficient: lv2 ? 3 : 2, element: "Cryo" });
  }
  // Crystallize shards per second for survival (#208): Geo on any aura but Hydro's when it turns Lunar-Crystallize.
  const crystals = pairs.filter((p) => p.r === "crystallize" && !(p.aura === "Hydro" && ctx.active.includes("lunar-crystallize")));
  const crystallize = { perSecond: crystals.reduce((s, p) => s + p.reactions, 0), geo: [...new Set(crystals.flatMap((p) => p.members))] };
  // Frozen uptime (#282): each Freeze holds the enemy FREEZE_SECONDS; taking Freezes as random arrivals, the share of
  // the time it is Frozen is 1 - e^(-rate x FREEZE_SECONDS) (estimate). Against Freeze-immune enemies ("Most Bosses":
  // wiki Freeze § Immunity) it is 0, but the benchmark has no enemy type, so they aren't weighed. When Hydro or Cryo
  // has no modeled applier (no sub-DPS entry), 1 stays as the stand-in.
  const freezes = pairs.filter((p) => p.r === "freeze").reduce((s, p) => s + p.reactions, 0);
  const frozen = (full.get("Hydro") ?? 0) > 0 && (full.get("Cryo") ?? 0) > 0 ? 1 - Math.exp(-freezes * FREEZE_SECONDS) : 1;
  return { subs: out, carry: carryShare, quicken, transformative, appsOf, indirect, crystallize, frozen };
}
const SWIRLABLE: Element[] = ["Pyro", "Hydro", "Electro", "Cryo"];
const QUICKEN_SECONDS = 0.8 * 5 + 6; // a Quicken aura from 0.8U (wiki Quicken § Duration)
// A Freeze from a 0.8U aura and a 1U trigger: "Gauge_Freeze Aura = 2 min(Gauge_Origin Aura, Gauge_Trigger Element)",
// 1.6U, lasting "2 sqrt(5 x Gauge_Freeze Aura x (1 - Freeze Resistance) + 4) - 4" seconds, 2.93s (wiki Freeze § Duration).
const FREEZE_SECONDS = 2 * Math.sqrt(5 * 1.6 + 4) - 4;
const CRYSTALLIZE_PER_SECOND = 1;
// A converter turns these into their Lunar or Stellar form (Moonsign Benediction, Stellar Jubilee): with the converted
// reaction in the team, the base one doesn't happen. Stellar Swirl is the Cryo Swirl only (reactions.ts: Anemo + Cryo).
// Not Bloom (#354): Lunar-Bloom "will grant the party a Verdant Dew in addition to spawning a Dendro Core or Bountiful
// Core" and "does no DMG on its own" (wiki Lunar-Bloom, fetched 2026-10-28), so its cores still burst as Bloom and can
// be Hyperbloomed or Burgeoned (Kaveh: "Dendro Cores created ... through Bloom and Lunar-Bloom reactions").
const CONVERTED: Partial<Record<Reaction, Reaction>> = {
  electrocharged: "lunar-charged",
  superconduct: "stellar-conduct",
};
const convertedAway = (ctx: TeamContext, r: Reaction) => !!CONVERTED[r] && ctx.active.includes(CONVERTED[r]!);
const swirlAuras = (ctx: TeamContext) => SWIRLABLE.filter((e) => !(e === "Cryo" && ctx.active.includes("stellar-swirl")));
const DAMAGE_ELEMENT: Partial<Record<Reaction, Element>> = {
  overloaded: "Pyro",
  superconduct: "Cryo",
  electrocharged: "Electro",
  bloom: "Dendro",
  hyperbloom: "Dendro",
  burgeon: "Dendro",
  burning: "Pyro",
};
// Transformative reaction damage (#205): Overloaded, Swirl, Superconduct and Electro-Charged, a separate damage instance
// per reaction each member triggers (or Electro-Charged tick credited to them) in the aura budget, at that member's EM
// (the carry's from their combo, a sub-DPS's from their build or benchmark), with teammates' RES shred on the
// reaction's element (DAMAGE_ELEMENT; Swirl the swirled aura's). At most TRANSFORMATIVE's instances per second per
// member (Damage Sequence). Added to team damage like a sub-DPS's hits;
// the flat reaction points for these reactions are gone (carryLines). Not yet: Reaction Bonus from sets (VV, Crimson
// Witch: #206) and kits, the swirled element's further reactions, team EM buffs.
type Trigger = { m: ScoringCharacter; r: Reaction; aura: Element; perSecond: number };
// Dendro Cores (#253): the cores the Bloom pairs make each second are popped by Electro (Hyperbloom) and Pyro (Burgeon)
// applications, at the popper's EM ("their damage scale with the stats of the party responsible for applying Pyro or
// Electro": wiki Bloom), as many as there are cores; the rest explode as Bloom at their maker's EM. Popping takes no
// aura: the attack hits the core as well as the enemy (estimate).
function withCores(ctx: TeamContext, triggers: Trigger[], appsOf: Map<ScoringCharacter, number>): Trigger[] {
  const cores = triggers.filter((t) => t.r === "bloom");
  const made = cores.reduce((s, t) => s + t.perSecond, 0);
  if (made === 0) return triggers;
  const rest = triggers.filter((t) => t.r !== "bloom");
  const popping = ([["hyperbloom", "Electro"], ["burgeon", "Pyro"]] as const).filter(([r]) => ctx.active.includes(r));
  const applying = (e: Element) => ctx.members.filter((m) => m.element === e && (appsOf.get(m) ?? 0) > 0);
  const poppers = popping.flatMap(([r, e]) => applying(e).map((m) => ({ m, r })));
  const rate = poppers.reduce((s, p) => s + appsOf.get(p.m)!, 0);
  const popped = Math.min(made, rate);
  for (const p of poppers) rest.push({ m: p.m, r: p.r, aura: "Dendro", perSecond: (popped * appsOf.get(p.m)!) / rate });
  if (made > popped) for (const c of cores) rest.push({ ...c, perSecond: (c.perSecond * (made - popped)) / made });
  return rest;
}

function transformativeLines(ctx: TeamContext, carry: ScoringCharacter | null, out: Sink): number {
  if (!carry) return 0;
  const budget = auraBudget(ctx, carry);
  const triggers = withCores(ctx, budget.transformative, budget.appsOf);
  const carryReactions = carry.reactions.filter((r) => ctx.active.includes(r));
  const shreds = new Map<Element, number>();
  const shredOn = (element: Element) => {
    if (!shreds.has(element)) shreds.set(element, resShredGain(teamBuffStats({ ...carry, element }, carryReactions, ctx.members, burstSharesFor(ctx, carry), ctx.active).resShred));
    return shreds.get(element)!;
  };
  let total = 0;
  // Mizuki's C1 (#362): one Swirl or Stellar Swirl per `every` seconds deals more; each reaction's rate and the
  // multiplier its flat damage takes, filled in below.
  const marked: { flat: number; every: number; rate: number; mult: number }[] = [];
  for (const r of Object.keys(TRANSFORMATIVE) as Reaction[]) {
    const mine = triggers.filter((t) => t.r === r);
    if (mine.length === 0) continue;
    const { bonus, additive, once } = reactionBonusesFor(r, carry, ctx.members, burstSharesFor(ctx, carry)); // the team's kits' (#256)
    if (once) {
      const rate = mine.reduce((s, t) => s + t.perSecond, 0);
      const aura = DAMAGE_ELEMENT[r] ?? mine[0].aura;
      marked.push({ ...once, rate: Math.min(rate, TRANSFORMATIVE[r]!.perSecond), mult: 1 + shredOn(aura) });
    }
    let dps = 0;
    const by: string[] = [];
    for (const m of new Set(mine.map((t) => t.m))) {
      const own = mine.filter((t) => t.m === m);
      const rate = own.reduce((s, t) => s + t.perSecond, 0);
      const capped = Math.min(1, TRANSFORMATIVE[r]!.perSecond / rate);
      const extras = memberExtras(m, carry, ctx);
      const em = teamEm(m, carry, ctx, (subDpsStats(m)?.em ?? 0) + extras.em);
      const mineBonus = bonus + extras.reaction(r); // their own set's (VV's Swirl, #344)
      let d = 0;
      for (const t of own) {
        const element = DAMAGE_ELEMENT[r] ?? t.aura; // Swirl: the swirled aura's
        d += t.perSecond * capped * transformativeHit(r, em, mineBonus, additive) * (1 + shredOn(element));
      }
      dps += d;
      by.push(`${m.id} ~${(rate * capped).toFixed(1)}/s`);
    }
    if (dps >= 1) out.add("Reactions", 0, () => `${label(r)}: ~${Math.round(dps)} damage per second (${by.join(", ")})`);
    total += dps;
  }
  // Indirect Lunar damage (#145; Jessie, 2026-10-12: in the Reactions line by damage added, for the team that triggers
  // it). Genshin Impact Wiki, Damage § Indirect (fetched 2026-10-18): each member who applied the reaction's elements
  // gets "Base Reaction Coefficient x Level Multiplier x (1 + % Reaction Base DMG Bonus) x (1 + % EM Bonus + % Reaction
  // Bonus) x RES x CRIT", at their own EM and crit; the hit is "Highest x 0.6 + 2nd x 0.3 + 3rd x 0.05 + 4th x 0.05".
  // Base DMG Bonus: every converter's (#88); Reaction Bonus: the team's kits' (Columbina, Ifa; #256).
  for (const { r, what, perSecond, coefficient, element } of budget.indirect) {
    const els = reactionElements(r);
    const contributors = ctx.members.filter((m) => els.includes(m.element) && (budget.appsOf.get(m) ?? 0) > 0);
    if (perSecond <= 0 || contributors.length === 0) continue;
    const { bonus, once } = reactionBonusesFor(r, carry, ctx.members, burstSharesFor(ctx, carry));
    // The Anemo hits are the Stellar Swirl instances (the Vortex is a separate hit).
    if (once && what === "Anemo hits") marked.push({ ...once, rate: perSecond, mult: (1 + shredOn(element)) * expectedCrit(carry) });
    const base = 1 + teammatesLunarBase(r, ctx.members);
    const res = 1 + shredOn(element);
    const individual = contributors
      .map((m) => {
        const s = subDpsStats(m);
        // Each contributor's own EM and Reaction Bonus (#306: party set and weapon EM, Gleaming Moon, their Aubade).
        const x = memberExtras(m, carry, ctx);
        const em = teamEm(m, carry, ctx, (s?.em ?? carryStats(m).em) + x.em);
        const crit = m !== carry && s ? 1 + Math.min(s.critRate + x.critRate, 1) * s.critDmg : expectedCrit(m);
        return coefficient * LEVEL_MULTIPLIER_90 * base * (1 + lunarEmBonus(em) + bonus + x.lunar(r)) * res * crit;
      })
      .sort((a, b) => b - a);
    const dps = perSecond * individual.reduce((sum, d, i) => sum + d * INDIRECT_WEIGHTS[i], 0);
    if (dps >= 1) out.add("Reactions", 0, () => `${label(r)} ${what}: ~${Math.round(dps)} damage per second (~${perSecond.toFixed(1)}/s)`);
    total += dps;
  }
  // The mark clears on the first Swirl or Stellar Swirl after it, so they share its one boosted hit per `every` s.
  const all = marked.reduce((s, m) => s + m.rate, 0);
  if (all > 0) {
    const hits = Math.min(1 / marked[0].every, all);
    const dps = marked.reduce((s, m) => s + hits * (m.rate / all) * m.flat * m.mult, 0);
    if (dps >= 1) out.add("Reactions", 0, () => `Mizuki's C1: ~${Math.round(dps)} damage per second on ~${hits.toFixed(2)} Swirls/s`);
    total += dps;
  }
  return total;
}
const INDIRECT_WEIGHTS = [0.6, 0.3, 0.05, 0.05];
// Lunar and Stellar reactions with damage of their own besides the members' direct hits (#145, #235).
const INDIRECT_LUNAR = new Set<Reaction>(["lunar-charged", "lunar-crystallize", "stellar-swirl"]);
type Indirect = { r: Reaction; what: string; perSecond: number; coefficient: number; element: Element };

// Whether a transformative reaction's damage is in team damage for this team (#205), so its flat points go: some member
// applies each of its elements in the aura budget (Swirl: Anemo and an aura element). Not when an applier isn't modeled
// (Raiden off field has no sub-DPS entry, #252): the flat points stay as the stand-in. A reaction a converter turns into
// its Lunar or Stellar form (CONVERTED) doesn't happen, so it scores nothing either way.
function transformativeModeled(ctx: TeamContext, carry: ScoringCharacter, r: Reaction): boolean {
  if (!TRANSFORMATIVE[r] && !INDIRECT_LUNAR.has(r)) return false;
  if (convertedAway(ctx, r)) return true;
  const applies = (e: Element) => ctx.members.some((m) => m.element === e && applicationsPerSecond(m, carry, ctx) > 0);
  if (r === "swirl") return applies("Anemo") && swirlAuras(ctx).some(applies);
  return reactionElements(r).every(applies);
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
// A modeled carry's measured reaction shares in this team (#94 part 5): which share of their damage a bonus to each
// reaction reaches, from the same reading as their reactions' damage (aura-limited); undefined when not modeled.
function measuredShares(carry: ScoringCharacter, ctx: TeamContext): Partial<Record<string, number>> | undefined {
  const own = carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, false, carryAmpShare(ctx, carry), frozenShare(ctx, carry));
  return own && own.missing.length === 0 ? own.shares : undefined;
}
function modeledCarryDps(carry: ScoringCharacter, ctx: TeamContext, reactions = true, buffs = NO_TEAM_BUFFS): number | null {
  const own = reactions
    ? carryDamage(carry, ctx.active, ctx.members, buffs, false, carryAmpShare(ctx, carry), frozenShare(ctx, carry))
    : carryDamage(carry, [], ctx.members, buffs, false);
  return own && own.missing.length === 0 ? own.perSecond : null;
}

// The reactions the damage model covers (damage.ts modelsReaction) are inside the carry's damage (#134, #202); these
// lines say what they add, with 0 points. They replace the flat reaction points (main reaction, extra partners,
// secondary reactions) for those reactions; returns them, empty for a carry not modeled yet. Without reactions the
// carry plays their default combo (#114). Both readings include the team's kit buffs (#157).
function reactionDamageLine(ctx: TeamContext, carry: ScoringCharacter, out: Sink): Reaction[] {
  const covered = ctx.active.filter((r) => modelsReaction(carry, r));
  if (covered.length === 0) return covered;
  const buffs = carryTeamBuffs(carry, ctx);
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

// What a member gets that their character screen doesn't show (#306): party-wide set EM (Silken Moon's Serenade) and
// their weapon's EM and CRIT Rate (Snare Hook, The Widsith, Harbinger of Dawn), and the Reaction Bonus on their Lunar
// damage: the Gleaming Moon sets' (party-wide) and their own set's (Aubade off-field; Thundering Fury). `reaction`: their
// own set's alone, for the transformative reactions they trigger (Viridescent Venerer's Swirl, #344). For a sub-DPS's
// hits and the reactions they contribute to; the carry's own are in carryDamage.
function memberExtras(m: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext) {
  const gleam = ctx.members.filter((x) => x.families?.includes("moonsign")).length >= 2;
  const party = partySetBuffs(ctx.members, ctx.active, carry, gleam);
  const weapon = weaponBuffs(m, ctx.members, ctx.active, gleam, m === carry);
  const set = setBuffs(m, ctx.active, ctx.members, gleam, m === carry);
  return {
    weapon,
    em: party.em + weaponSum(weapon, "em"),
    critRate: weaponSum(weapon, "critRate"),
    lunar: (r: Reaction | LunarReaction) => party.lunar + (r.startsWith("stellar-") ? party.stellar : 0) + setReactionBonus(set, r) + weaponReactionBonus(weapon, r), // Heart of the Furnace (#345)
    reaction: (r: Reaction) => setReactionBonus(set, r) + weaponReactionBonus(weapon, r), // a weapon's too (#385)
    set,
  };
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
  const quicken = auraBudget(ctx, carry).quicken;
  for (const m of ctx.members) {
    const entry = SUB_DPS[m.id];
    if (m === carry || !entry) continue;
    // Their own Nightsoul Burst effect, averaged over its uptime (#98).
    const ownNs = ownNightsoulBuff(m, ctx);
    const extras = memberExtras(m, carry, ctx);
    // Teammates' EM and HP % on all of this member's hits (#186: kit EM buffs, Sprawling Greenery, Soothing Water).
    const whole = memberBuffStats(m, carry, ctx.active, ctx.members, undefined, burstSharesFor(ctx, carry));
    const base = subDpsStats(m)!;
    // Their own set on their own hits (#346, #347), as the carry's (damage.ts): DEF%, ATK%, EM, CRIT Rate and DMG Bonus
    // by hit type and element (Golden Troupe's Skill DMG, Husk's Geo DMG; Emblem at their build's ER, else ER target).
    const set = extras.set;
    const stat = {
      ...base,
      em: base.em + extras.em + whole.em + sumSet(set, "emPerOther") + (ownNs?.kind === "em" ? ownNs.value : 0), // party set and weapon EM (#306)
      def: base.def + ((ownNs?.kind === "defPct" ? ownNs.value : 0) + sumSet(set, "defPct") + weaponSum(extras.weapon, "defPct")) * (entry.base?.def ?? 0),
    };
    const er = base.er ?? (erTargetOf(m) ?? 100) / 100;
    const dmgBonus = stat.dmgBonus + (ownNs?.kind === "dmgBonus" ? ownNs.value : 0);
    // Base ATK, for teammates' ATK% buffs: the build's, else the character's plus the benchmark weapon's.
    const baseAtk = m.stats?.baseAtk ?? (entry.base ? entry.base.atk + BENCHMARK.buffer.weaponBaseAtk : BENCHMARK.carryBaseAtk);
    const setAtk = (sumSet(set, "atkPct") + sumSet(set, "atkPctPerSame")) * baseAtk;
    let dps = 0;
    let lunarDps = 0;
    const picked = pickedSources(entry.sources, carry, ctx, m);
    // Burst hits only in the rotations the team's Energy funds (#37).
    const burstPart = needs.get(m)?.share ?? 1;
    const own = entry.lunarBaseBonus;
    const lunarBase = (r: LunarReaction) =>
      (own && own.reactions.includes(r) ? Math.min(own.max, own.perPoint * stat[own.stat]) : 0) + teammatesLunarBase(r, ctx.members, m);
    const reactions = subDpsReactions(m, ctx);
    const reacted = new Set<Reaction>();
    // Their build's weapon passive on their own hits (#40): DMG bonus by talent, and Max HP as a % of base HP.
    const weapon = extras.weapon;
    const hp = stat.hp + (weapon.reduce((a, b) => a + (b.kind === "hpPct" ? b.value : 0), 0) + whole.hpPct) * (entry.base?.hp ?? 0);
    for (const s of entry.sources) {
      if (s.pickOne && picked.get(s.pickOne) !== s) continue;
      // Teammates' party-wide kit buffs on this hit (#204, kit.ts memberBuffStats): ATK, DMG Bonus, CRIT Rate, flat DMG.
      const team = memberBuffStats(m, carry, ctx.active, ctx.members, s.talent, burstSharesFor(ctx, carry));
      const atk = stat.atk + team.atk + team.atkPct * baseAtk + weaponAtk(weapon, baseAtk, stat.em) + setAtk; // weapon ATK (#206), set ATK%
      const perHit =
        (s.scaling.atk ?? 0) * atk + (s.scaling.hp ?? 0) * hp + (s.scaling.def ?? 0) * stat.def + (s.scaling.em ?? 0) * stat.em +
        weaponFlatFromDef(weapon, s.talent === "skill" || s.talent === "burst" || s.talent === "normal" ? s.talent : undefined, stat.def); // Cinnabar Spindle (#385)
      // By talent (#40); a Normal Attack talent's hits read as Normal Attack DMG (#206: every-hit bonuses reach them).
      const talent = s.talent === "normal" || s.talent === "skill" || s.talent === "burst" ? s.talent : undefined;
      const weaponBonus = talent ? weaponDmgBonus(weapon, talent) : 0;
      const setBonus = setDmgBonus(set, talent ?? "normal", m.element, er);
      // Direct Lunar hits crit too (wiki, Damage § Direct; #156), so expected crit applies to both.
      const crit = 1 + Math.min(stat.critRate + team.critRate + extras.critRate + sumSet(set, "critRate"), 1) * (stat.critDmg + team.critDmg); // weapon, set CRIT (#306)
      // Teammates' RES and DEF shred on this hit (#204), as on the carry's: Lunar hits take RES only.
      const res = 1 + resShredGain(team.resShred);
      const def = 1 + defShredGain(Math.min(0.9, team.defShred));
      // Direct Lunar hits use the Lunar formula: no DMG Bonus term, EM bonus instead (damage.ts, #135/#151), with
      // their own Moonsign Benediction Base DMG bonus (PR #155).
      // A conditional factor on the source's own DMG (#98: Venti's Stormeye under Secret Rite).
      const factor = s.factor && sourceFits(s.factor.when, carry, ctx, m) ? 1 + s.factor.value : 1;
      const rate = hitsPerSecond(s, carry, ctx, m) * (s.talent === "burst" || s.burstFunded ? burstPart : 1) * factor;
      if (s.lunar) lunarDps += lunarHit(s.lunar, perHit, stat.em, lunarBase(s.lunar), extras.lunar(s.lunar)) * rate * crit * res;
      else {
        // Additive Base DMG Bonus from teammates (Shenhe's quills): per hit, before DMG Bonus and crit, as on the carry.
        const base = perHit + team.flat;
        // DMG Bonus per point of a stat on this hit (Dendro Traveler's 0.15% per EM, #172).
        const perStat = Object.entries(s.dmgBonusPerStat ?? {}).reduce((a, [k, v]) => a + v * stat[k as ScaleStat], 0);
        // A reacting hit (#153): the extra damage of the best reaction, on the hits that react.
        let extra = 0;
        let best: Reaction | null = null;
        // Each reaction's extra damage on this hit's reacting share: its applying hits (ICD), times the aura budget's
        // share for Vaporize and Melt, or the Quicken aura's uptime for Spread and Aggravate (#303).
        for (const r of reactions) {
          const share = appliedShare(s) * (AMPLIFYING[r] ? (auras.get(m)?.get(r) ?? 0) : CATALYZING[r] ? quicken : 1);
          const rb = (s.reactionBonus ?? []).filter((b) => b.reactions.includes(r) && (!b.when || sourceFits(b.when, carry, ctx, m)));
          const bonus = rb.reduce((a, b) => a + b.value, 0);
          const add = share * (base * amplifyGain(m, stat.em, ctx.active, r, bonus) + catalyzeDamage(m, stat.em, ctx.active, r));
          if (add > extra) [extra, best] = [add, r];
        }
        if (best && extra >= 0.01 * base) reacted.add(best); // named only when it adds at least 1% to the hit
        // A passive's boost on the first `stacks` hits of each use (Durin's Primordial Fusion, #195): their share of the
        // use's hits, times the boost from the member's stat, capped.
        const b = s.boost;
        const hitsPerUse = (s.hits ?? 1) * (s.every !== undefined ? Math.min(s.duration!, s.cd) / s.every : 1);
        const boost = b ? 1 + Math.min(1, b.stacks / hitsPerUse) * Math.min(b.max, b.perPoint * stat[b.stat]) : 1;
        dps += (base + extra) * rate * (1 + dmgBonus + team.dmgBonus + perStat + weaponBonus + setBonus) * crit * res * def * boost;
      }
    }
    dps += lunarDps;
    total += dps;
    const withReactions = reacted.size ? `, with ${[...reacted].map(label).join(", ")}` : "";
    if (dps >= 1) out.add("Sub-DPS", 0, () => `${m.id}'s own hits: ~${Math.round(dps)} damage per second${withReactions}`);
    // Only a main DPS takes the team over (Mavuika, a flex DPS): a support's hits never make them its main DPS (#266:
    // Escoffier out-damaged a carry with no damage model yet).
    if (m.roles.includes("main-dps") && dps > carryDps && (!lead || dps > lead.dps)) lead = { m, dps };
  }
  if (lead) {
    const { m, dps } = lead;
    out.add("Carry", 0, () => `${m.id} out-damages ${carry.id} (~${Math.round(dps)} vs ~${Math.round(carryDps)} per second): ${m.id} is the main DPS`);
  }
  return { lead: lead?.m ?? null, dps: total };
}

// A member's EM for the reactions they trigger (#186): the carry's as their damage reads it (with the team's EM buffs),
// a teammate's own plus their teammates' EM buffs (memberBuffStats).
function teamEm(m: ScoringCharacter, carry: ScoringCharacter, ctx: TeamContext, own: number): number {
  if (m === carry) return (carryDamage(carry, ctx.active, ctx.members, NO_TEAM_BUFFS, false, carryAmpShare(ctx, carry), frozenShare(ctx, carry))?.em ?? 0) + carryTeamBuffs(carry, ctx).em;
  return own + memberBuffStats(m, carry, ctx.active, ctx.members, undefined, burstSharesFor(ctx, carry)).em;
}

// The carry's damage per second in team damage (#202): modeled, with the team's reactions and the kit buffs that
// read as carry stats (#157); else the generic benchmark carry (a non-crit hit) at their expected crit. Scaled by
// their key talent's level, which the damage model reads at 9.
function carryDamagePerSecond(carry: ScoringCharacter, ctx: TeamContext): number {
  const known = ctx.carryDps.get(carry);
  if (known !== undefined) return known;
  const buffs = carryTeamBuffs(carry, ctx);
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
  // order the team arrives in (the model checks' order test, #201). By code unit, not localeCompare: much faster (#215).
  const team = given.map((m) => questView(m, options)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sink = (): Sink => (explain ? new Breakdown() : new Tally());
  const ctx = buildContext(team, options);
  const shared = sink();
  teamLines(ctx, shared);
  // Every main DPS is tried as the on-field carry, and the reading that scores the team highest stands (Jessie,
  // 2026-10-28, #389): the strongest carry before team buffs isn't always the best one on field (Skirk's damage
  // leans on Escoffier's and Furina's buffs, so Clorinde out-damaged her unbuffed and took the field at 87.5k
  // against 112.6k). Before, only the strongest modeled one was tried (#96, #215).
  const mainDps = team.filter((m) => m.roles.includes("main-dps"));
  const candidates = onlyCarry ? team.filter((m) => m.id === onlyCarry) : mainDps;

  type Reading = { carry: ScoringCharacter | null; lead: ScoringCharacter | null; out: Sink; dps: number; value: number };
  let best: Reading | null = null;
  for (const carry of candidates.length > 0 ? candidates : [null]) {
    const out = sink();
    carryLines(ctx, carry, out);
    if (carry) carryTalentLine(carry, out);
    out.addAll(shared);
    carryResonanceLines(ctx, carry, out);
    survivabilityLines(ctx, carry, out);
    ascendantGleamLines(ctx, carry, out);
    secretRiteLines(ctx, carry, out);
    nightsoulBurstLines(ctx, carry, out);
    stellarLines(ctx, carry, out);
    const sub = subDpsLines(ctx, carry, out);
    const reacted = transformativeLines(ctx, carry, out);
    const healed = healSetLines(ctx, carry, out);
    prefLines(ctx, carry, out);
    infusionLines(ctx, carry, out);
    cryoSplitLines(ctx, carry, out);
    statLines(ctx, carry, out);
    energyLines(ctx, carry, out);
    // No carry: the generic benchmark hit stands in for whoever is on field; the -30 line marks the missing carry.
    const own = carry ? carryDamagePerSecond(carry, ctx) : BENCHMARK.hitDamage * BENCHMARK.carryHitsPerSecond;
    const dps = own + sub.dps + reacted + healed;
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

// A team's value with this carry on field, for the reference (team-reference.ts) and the search's support ranking (#215).
export function carryTeamValue(team: ScoringCharacter[], carry: string, options: ScoreOptions = {}): number {
  return bestReading(team, options, false, carry).value;
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
