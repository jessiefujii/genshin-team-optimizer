import genshindb from "genshin-db";
import tagsJson from "../../../data/tags.json";
import type { CharacterTags } from "../../types/tags";
import type { Element, ScoringCharacter } from "./types";

const tags = tagsJson as CharacterTags[];

// Manekin and Manekina always share the Traveler's element, so they are only included when it is known.
const FOLLOWS_TRAVELER = new Set(["Manekin", "Manekina"]);

// Joins tags.json with element data from genshin-db. Server-side only (genshin-db is ~178 MB).
export function loadScoringCharacters(travelerElement?: Element): ScoringCharacter[] {
  const out: ScoringCharacter[] = [];
  for (const tag of tags) {
    const traveler = tag.id.match(/^Traveler \((\w+)\)$/);
    if (traveler) {
      out.push({ ...tag, element: traveler[1] as Element, weapon: "Sword" });
    } else if (FOLLOWS_TRAVELER.has(tag.id)) {
      if (travelerElement) {
        out.push({ ...tag, element: travelerElement, weapon: genshindb.characters(tag.id)?.weaponText ?? "Sword" });
      }
    } else {
      const db = genshindb.characters(tag.id);
      if (!db?.elementText) throw new Error(`genshin-db has no element for ${tag.id}`);
      out.push({ ...tag, element: db.elementText as Element, weapon: db.weaponText });
    }
  }
  return out;
}
