import type { Element, Reaction, ScoringCharacter } from "./types";

const AURA_ELEMENTS: Element[] = ["Pyro", "Hydro", "Electro", "Cryo"];

interface ReactionRequirement {
  all: Element[]; // every one of these elements must be in the team
  anyOf?: Element[]; // plus at least one of these
  converted?: boolean; // plus a member whose kit converts the base reaction into this one (#63)
}

const REQUIREMENTS: Record<Reaction, ReactionRequirement> = {
  vaporize: { all: ["Pyro", "Hydro"] },
  melt: { all: ["Pyro", "Cryo"] },
  freeze: { all: ["Hydro", "Cryo"] },
  superconduct: { all: ["Electro", "Cryo"] },
  electrocharged: { all: ["Electro", "Hydro"] },
  overloaded: { all: ["Pyro", "Electro"] },
  burning: { all: ["Pyro", "Dendro"] },
  bloom: { all: ["Dendro", "Hydro"] },
  hyperbloom: { all: ["Dendro", "Hydro", "Electro"] },
  burgeon: { all: ["Dendro", "Hydro", "Pyro"] },
  quicken: { all: ["Dendro", "Electro"] },
  aggravate: { all: ["Dendro", "Electro"] },
  spread: { all: ["Dendro", "Electro"] },
  swirl: { all: ["Anemo"], anyOf: AURA_ELEMENTS },
  crystallize: { all: ["Geo"], anyOf: AURA_ELEMENTS },
  "lunar-charged": { all: ["Electro", "Hydro"], converted: true },
  "lunar-bloom": { all: ["Dendro", "Hydro"], converted: true },
  "lunar-crystallize": { all: ["Geo", "Hydro"], converted: true },
  "stellar-conduct": { all: ["Electro", "Cryo"], converted: true },
  "stellar-swirl": { all: ["Anemo", "Cryo"], converted: true },
};

// Transformative reactions' damage (#205): coefficient on the Level Multiplier and the most instances one attacker deals a
// target per second; formula and sources at damage.ts transformativeHit.
export const TRANSFORMATIVE: Partial<Record<Reaction, { coefficient: number; perSecond: number }>> = {
  swirl: { coefficient: 0.6, perSecond: 4 },
  overloaded: { coefficient: 2.75, perSecond: 2 },
  superconduct: { coefficient: 1.5, perSecond: 4 },
  electrocharged: { coefficient: 2, perSecond: 1 },
  // Bloom 2.0, Hyperbloom and Burgeon 3.0 (wiki Bloom § Damage: "2 instances of DMG from each Bloom-related reaction per
  // source every 0.5 seconds"); score.ts reads Dendro Cores from the aura budget (#253).
  bloom: { coefficient: 2, perSecond: 4 },
  hyperbloom: { coefficient: 3, perSecond: 4 },
  burgeon: { coefficient: 3, perSecond: 4 },
  // Burning 0.25 (wiki Burning), a tick every 0.25s (KQM; score.ts reads its uptime from the aura budget).
  burning: { coefficient: 0.25, perSecond: 4 },
};

// Elements that take part in a reaction (e.g. Pyro and Hydro for Vaporize; Anemo plus any aura element for Swirl).
export function reactionElements(reaction: Reaction): Element[] {
  const req = REQUIREMENTS[reaction];
  return [...req.all, ...(req.anyOf ?? [])];
}

// The reaction a carry's teams are built around: tagged, or their only reaction (#49). undefined = not decided.
export function mainReactionOf(carry: ScoringCharacter): Reaction | "none" | undefined {
  return carry.mainReaction ?? (carry.reactions.length === 1 ? carry.reactions[0] : undefined);
}

// Roughly how much of a carry's damage a bonus to that reaction's DMG applies to (#87), when it's their main
// reaction or another one they deal. Estimates for carries without a damage model (a modeled carry's are measured,
// reactionShare `measured`, #94), and for reactions outside carry damage:
// - Lunar, Stellar and Bloom-type: the carry's damage largely is reaction damage.
// - Vaporize, Melt: the bonus multiplies the hits that react.
// - Aggravate, Spread: the bonus is only on the flat damage the reaction adds to a hit.
// - Other transformative reactions: separate, smaller reaction hits beside the carry's own.
const SHARES = {
  reactionDamage: { main: 0.8, side: 0.3 },
  amplifying: { main: 0.7, side: 0.3 },
  additive: { main: 0.3, side: 0.15 },
  transformative: { main: 0.25, side: 0.1 },
};
const SHARE_OF: Record<Reaction, keyof typeof SHARES> = {
  "lunar-charged": "reactionDamage",
  "lunar-bloom": "reactionDamage",
  "lunar-crystallize": "reactionDamage",
  "stellar-conduct": "reactionDamage",
  "stellar-swirl": "reactionDamage",
  bloom: "reactionDamage",
  hyperbloom: "reactionDamage",
  burgeon: "reactionDamage",
  vaporize: "amplifying",
  melt: "amplifying",
  aggravate: "additive",
  spread: "additive",
  quicken: "additive",
  swirl: "transformative",
  overloaded: "transformative",
  electrocharged: "transformative",
  superconduct: "transformative",
  burning: "transformative",
  crystallize: "transformative",
  freeze: "transformative",
};

// The share of the carry's damage a bonus to `reactions` reaches: the reactions the carry deals, added up, at most 1.
// `measured`: a modeled carry's shares from the damage model (damage.ts CarryDamage.shares, #94 part 5), which
// replace the estimates for the reactions inside carry damage (Vaporize, Melt, Aggravate, Spread, Lunar, Stellar);
// Bloom-type and other transformative reactions deal their own damage beside the carry's and keep the estimate.
const MEASURED = new Set<Reaction>(["vaporize", "melt", "aggravate", "spread", "lunar-charged", "lunar-bloom", "lunar-crystallize", "stellar-conduct", "stellar-swirl"]);
const INSIDE = new Set<Reaction>(["vaporize", "melt", "aggravate", "spread"]);
// Lunar and Stellar reactions with indirect damage (score.ts transformativeLines: thunderclouds, Moondrift Harmony,
// Stellar Swirl hits), which takes the team's kit Reaction Bonuses (#145, #426). Lunar-Bloom has none.
export const INDIRECT_DAMAGE = new Set<Reaction>(["lunar-charged", "lunar-crystallize", "stellar-swirl"]);
export function reactionShare(
  carry: ScoringCharacter,
  reactions: readonly string[],
  dealt: readonly Reaction[],
  measured?: Partial<Record<string, number>>,
): number {
  const main = mainReactionOf(carry);
  let share = 0;
  for (const r of dealt) {
    if (!reactions.includes(r)) continue;
    // Vaporize, Melt, Aggravate and Spread are wholly inside carry damage: a measured 0 means no hit reacts. A Lunar
    // or Stellar reaction the carry deals no hits of happens beside their damage (Alhaitham's Lunar-Bloom with Lauma):
    // the estimate stands for it. Kit Reaction Bonuses to the ones with indirect damage are in those lines instead
    // (INDIRECT_DAMAGE, kit.ts kitBuffValue, #426).
    if (measured && MEASURED.has(r) && (INSIDE.has(r) || measured[r] !== undefined)) {
      share += measured[r] ?? 0;
      continue;
    }
    const s = SHARES[SHARE_OF[r]];
    share += r === main ? s.main : s.side;
  }
  return Math.min(1, share);
}

// Whether the team's elements (and converters) can trigger a reaction at all.
export function canTrigger(
  reaction: Reaction,
  elements: ReadonlySet<Element>,
  converted: ReadonlySet<Reaction> = new Set(), // Lunar/Stellar reactions some member converts
): boolean {
  const req = REQUIREMENTS[reaction];
  if (!req.all.every((e) => elements.has(e))) return false;
  if (req.anyOf && !req.anyOf.some((e) => elements.has(e))) return false;
  if (req.converted && !converted.has(reaction)) return false;
  return true;
}
