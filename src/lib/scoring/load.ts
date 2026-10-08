import genshindb from "genshin-db";
import tagsJson from "../../../data/tags.json";
import type { CharacterTags } from "../../types/tags";
import type { Element, ScoringCharacter } from "./types";

const tags = tagsJson as CharacterTags[];

// The burst's Energy Cost from genshin-db's talent attributes; undefined when it has none (Mavuika, Skirk).
function burstCost(id: string): number | undefined {
  const attrs = genshindb.talents(id)?.combat3?.attributes;
  const label = attrs?.labels.find((l) => l.startsWith("Energy Cost|"));
  const param = label?.match(/\{(param\d+)/)?.[1];
  const cost = param ? attrs!.parameters[param]?.[0] : undefined;
  return cost && cost > 0 ? cost : undefined;
}

// Manekin and Manekina always share the Traveler's element, so they are only included when it is known.
const FOLLOWS_TRAVELER = new Set(["Manekin", "Manekina"]);

// Joins tags.json with element data from genshin-db. Server-side only (genshin-db is ~178 MB).
export function loadScoringCharacters(travelerElement?: Element): ScoringCharacter[] {
  const out: ScoringCharacter[] = [];
  for (const tag of tags) {
    const traveler = tag.id.match(/^Traveler \((\w+)\)$/);
    if (traveler) {
      out.push({ ...tag, element: traveler[1] as Element, weapon: "Sword", burstCost: burstCost(tag.id) });
    } else if (FOLLOWS_TRAVELER.has(tag.id)) {
      if (travelerElement) {
        const weapon = genshindb.characters(tag.id)?.weaponText ?? "Sword";
        out.push({ ...tag, element: travelerElement, weapon, burstCost: burstCost(tag.id) });
      }
    } else {
      const db = genshindb.characters(tag.id);
      if (!db?.elementText) throw new Error(`genshin-db has no element for ${tag.id}`);
      out.push({ ...tag, element: db.elementText as Element, weapon: db.weaponText, burstCost: burstCost(tag.id) });
    }
  }
  return out;
}
