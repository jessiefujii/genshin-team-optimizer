import particlesJson from "../../../data/particles.json";
import { ER_TARGETS } from "../../types/tags";
import type { Element, ScoringCharacter } from "./types";

// ER % a member wants to burst every rotation: their guide-checked erTarget (#21), or the default for
// their energy need; undefined = not checked (low energy need and no erTarget).
export const erTargetOf = (m: ScoringCharacter) =>
  m.erTarget ?? (m.energyNeed === "low" ? undefined : ER_TARGETS[m.energyNeed]);

// Particle model (#37). data/particles.json: each character's Skill particles (Genshin Impact Wiki, Energy/Data)
// and flat Energy from their talents (genshin-db).
type FlatTo = "self" | "all" | "active" | "activeAbsorbed";
interface Particles {
  perUse?: number; // particles per Skill use
  cd?: number; // Skill cooldown (s)
  perSecond?: number; // a field that stays up all rotation (Furina's Salon, Nahida's seeds)
  timing: "cast" | "field"; // cast: caught by the caster; field: made over time, caught by the on-field carry
  flat?: { to: FlatTo; energy: number }[];
}
const PARTICLES = particlesJson.characters as Record<string, Particles>;

export const ENERGY = {
  // Energy per particle at 100% ER: 3 same element, 1 other; an off-field member gets 60% in a 4-member party
  // (Genshin Impact Wiki, Energy § Particles and Orbs).
  sameElement: 3,
  otherElement: 1,
  offField: 0.6,
  // Skill uses per rotation: as many as the cooldown allows, 1 to 2 (judgment call: off-field members rarely
  // fit more casts into their field time; for Jessie).
  maxUses: 2,
  // The standard team a guide's ER target is for: the member's own particles plus 3 teammates of another element
  // who each make this many particles per rotation and catch them themselves (judgment call: a low standard, so a
  // modeled need rarely beats the guide target; batteries count by keeping a Burst from going short).
  standardParticles: 5,
  // Energy every member gets per rotation at 100% ER from everything not modeled (enemy particles and orbs, Favonius
  // procs), the same in the standard team and this one; calibrated so guide targets cover 3 in 4 KQM guide teams.
  otherEnergy: 10,
  defaultRotation: 20, // seconds, when the carry has no damage model (KQM teams mostly run 15-25s)
  // A Favonius weapon (effects.json battery role): "regenerate 6 Energy for the character" per proc, read as 2 of
  // their element's particles caught by the holder; once per 12s at R1. Other battery-role effects are left out.
  favoniusParticles: 2,
  favoniusCd: 12,
};
const ABSORBED: readonly Element[] = ["Pyro", "Hydro", "Electro", "Cryo"]; // Venti's passive 2

const particlesPerRotation = (p: Particles, seconds: number) =>
  p.perSecond !== undefined ? p.perSecond * seconds : p.perUse! * Math.min(ENERGY.maxUses, Math.max(1, Math.floor(seconds / p.cd!)));

// Energy at 100% ER that `m` gets per rotation from the team's particles, and flat Energy (not scaled by ER).
// A member without particle data counts as a standard teammate (Ineffa, Varesa: no wiki count).
function energyFor(m: ScoringCharacter, team: readonly ScoringCharacter[], carry: ScoringCharacter | null, seconds: number) {
  let particles = 0;
  let flat = 0;
  // In the order given: energyNeeds passes the team sorted, so the sums don't depend on member order (#213).
  for (const g of team) {
    if (g.effects?.some((e) => e.roles?.includes("battery") && e.id.startsWith("Favonius"))) {
      const procs = Math.max(1, Math.floor(seconds / ENERGY.favoniusCd));
      const rate = (g === m ? 1 : ENERGY.offField) * (g.element === m.element ? ENERGY.sameElement : ENERGY.otherElement);
      particles += ENERGY.favoniusParticles * procs * rate;
    }
    const p = PARTICLES[g.id];
    if (!p) {
      if (g !== m) particles += ENERGY.standardParticles * ENERGY.offField * ENERGY.otherElement;
      continue;
    }
    const catcher = p.timing === "cast" ? g : (carry ?? g);
    const rate = (catcher === m ? 1 : ENERGY.offField) * (g.element === m.element ? ENERGY.sameElement : ENERGY.otherElement);
    particles += particlesPerRotation(p, seconds) * rate;
    for (const f of p.flat ?? []) {
      const gets =
        f.to === "all" || (f.to === "self" && g === m) || (f.to === "active" && m === carry) ||
        (f.to === "activeAbsorbed" && m === carry && ABSORBED.includes(m.element));
      if (gets) flat += f.energy;
    }
  }
  return { particles, flat };
}

export interface EnergyNeed {
  target: number; // the guide's ER % for a standard team
  need: number; // the ER % this team needs (at least 100)
  has: number; // their ER %: a build's, else the target (a guide build)
  share: number; // the share of rotations they can Burst in, 0-1
}

// Each Energy-Burst member's ER need in this team (#37), anchored to their guide ER target so the particle model's
// absolute errors cancel (#37's first try, particles x energy values alone, overshot guides 2-9x): with E the
// particle Energy at 100% ER and F flat Energy, a guide target t covers the standard team's t x E_std + F_std, so
// this team needs (t x E_std + F_std - F_team) / E_team. Members without a target or an Energy Burst are left out.
// Cached (#215): a team's needs depend on its members, carry and rotation length, and the scorer asks for them several
// times per team (carry and sub-DPS Burst shares, the Energy lines). Per team array object, which the scorer keeps for
// the whole team; per member, the standard team, which depends only on them. Callers only read the result.
const needsCache = new WeakMap<readonly ScoringCharacter[], Map<string, Map<ScoringCharacter, EnergyNeed>>>();
const standardCache = new WeakMap<ScoringCharacter, Map<string, { particles: number; flat: number }>>();

// The standard team: m with 3 standard teammates (no particle data, so energyFor counts them as standard), one of
// them on field unless m is this team's carry.
function standardEnergy(m: ScoringCharacter, isCarry: boolean, seconds: number) {
  let byKey = standardCache.get(m);
  if (!byKey) standardCache.set(m, (byKey = new Map()));
  const key = `${isCarry}|${seconds}`;
  let std = byKey.get(key);
  if (!std) {
    const standardMates = [0, 1, 2].map((i) => ({ id: `standard ${i}` }) as ScoringCharacter);
    std = energyFor(m, [m, ...standardMates], isCarry ? m : standardMates[0], seconds);
    byKey.set(key, std);
  }
  return std;
}

export function energyNeeds(team: readonly ScoringCharacter[], carry: ScoringCharacter | null, seconds = ENERGY.defaultRotation) {
  let byKey = needsCache.get(team);
  if (!byKey) needsCache.set(team, (byKey = new Map()));
  const key = `${carry?.id ?? ""}|${seconds}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const out = new Map<ScoringCharacter, EnergyNeed>();
  byKey.set(key, out);
  // Particles summed in a fixed order: the same team in another member order sums the same, to the last bit, so a
  // share on a rounding boundary scores the same (#213). Sorted once here, not per energyFor call (#215).
  const ordered = [...team].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const m of team) {
    const targetPct = erTargetOf(m);
    if (!m.burstCost || targetPct === undefined) continue;
    const t = targetPct / 100;
    const std = standardEnergy(m, m === carry, seconds);
    const own = energyFor(m, ordered, carry, seconds);
    const needed = t * (std.particles + ENERGY.otherEnergy) + std.flat - own.flat;
    const got = own.particles + ENERGY.otherEnergy;
    const need = Math.max(1, got > 0 ? needed / got : needed > 0 ? Infinity : 1);
    const has = m.stats?.energyRecharge !== undefined ? m.stats.energyRecharge / 100 : t;
    out.set(m, { target: targetPct, need: Math.round(need * 100), has: Math.round(has * 100), share: Math.min(1, has / need) });
  }
  return out;
}

// The share of rotations a member Bursts in this team (#37), for their Burst damage; 1 when not modeled.
export function burstShare(m: ScoringCharacter, team: readonly ScoringCharacter[], carry: ScoringCharacter | null, seconds?: number) {
  if (team.length < 4) return 1; // a carry scored alone (tests, the generic yardstick)
  return energyNeeds(team, carry, seconds).get(m)?.share ?? 1;
}

export interface EnergyLine {
  id: string;
  cost: number; // burst Energy cost, from genshin-db
  target?: number; // ER % to burst every rotation in a standard team (guide); undefined = not checked
  need?: number; // ER % this team needs, from the particle model (#37)
  er?: number; // their actual ER %, when a build is entered
}

// The team's energy check: each Energy burst's cost against the member's ER target, the ER this team needs
// (particle model, #37) and, with a build, their actual ER.
export function energyCheck(members: ScoringCharacter[], carry: ScoringCharacter | null = null, seconds?: number): EnergyLine[] {
  const needs = members.length === 4 ? energyNeeds(members, carry, seconds) : new Map<ScoringCharacter, EnergyNeed>();
  return members
    .filter((m) => m.burstCost)
    .map((m) => {
      const n = needs.get(m);
      return { id: m.id, cost: m.burstCost!, target: erTargetOf(m), ...(n ? { need: n.need } : {}), er: m.stats?.energyRecharge };
    });
}
