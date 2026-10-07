import type { Element, Family, Reaction } from "./types";

const AURA_ELEMENTS: Element[] = ["Pyro", "Hydro", "Electro", "Cryo"];

interface ReactionRequirement {
  all: Element[]; // every one of these elements must be in the team
  anyOf?: Element[]; // plus at least one of these
  family?: Family; // plus a member of this family to convert the base reaction
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
  "lunar-charged": { all: ["Electro", "Hydro"], family: "moonsign" },
  "lunar-bloom": { all: ["Dendro", "Hydro"], family: "moonsign" },
  "lunar-crystallize": { all: ["Geo", "Hydro"], family: "moonsign" },
  "stellar-conduct": { all: ["Electro", "Cryo"], family: "stellar" },
  "stellar-swirl": { all: ["Anemo", "Cryo"], family: "stellar" },
};

// Elements that take part in a reaction (e.g. Pyro and Hydro for Vaporize; Anemo plus any aura element for Swirl).
export function reactionElements(reaction: Reaction): Element[] {
  const req = REQUIREMENTS[reaction];
  return [...req.all, ...(req.anyOf ?? [])];
}

// Whether the team's elements (and families) can trigger a reaction at all.
export function canTrigger(reaction: Reaction, elements: ReadonlySet<Element>, families: ReadonlySet<Family>): boolean {
  const req = REQUIREMENTS[reaction];
  if (!req.all.every((e) => elements.has(e))) return false;
  if (req.anyOf && !req.anyOf.some((e) => elements.has(e))) return false;
  if (req.family && !families.has(req.family)) return false;
  return true;
}
