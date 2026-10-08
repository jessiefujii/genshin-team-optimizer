import effectsJson from "../../../data/effects.json";
import type { CharacterBuild } from "../../types/build";
import type { EffectTag } from "../../types/effects";

const effects = effectsJson as EffectTag[];

// Entries drafted by scripts/draft-effects.mjs and not yet reviewed (#23).
export const isDraft = (e: EffectTag) => !!e.notes?.startsWith("VERIFY");

// Same item and level = same effect; two copies in one team don't stack.
export const effectKey = (e: EffectTag) => `${e.source}|${e.id}|${e.requires ?? ""}`;

// Short name for score lines: 'C1', '4pc Noblesse Oblige', 'Favonius Sword'.
export function effectLabel(e: EffectTag): string {
  if (e.source === "constellation") return `C${e.requires}`;
  if (e.source === "set") return `${e.requires}pc ${e.id}`;
  return e.id;
}

// A character's effects.json entries: constellations up to the owned level, plus the weapon and
// set bonuses of their build (a 4pc build also has the 2pc bonus). No build = constellations only.
export function characterEffects(id: string, constellation: number, build?: CharacterBuild): EffectTag[] {
  return effects.filter((e) => {
    if (e.source === "constellation") return e.id === id && e.requires! <= constellation;
    if (!build) return false;
    if (e.source === "weapon") return e.id === build.weapon.id;
    return build.artifactSets.some((s) => s.set === e.id && e.requires! <= s.pieces);
  });
}
