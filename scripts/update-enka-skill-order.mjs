// Regenerates data/enka-skill-order.json from Enka's characters store.
// Run with `node scripts/update-enka-skill-order.mjs` when a patch adds characters with unusual talent IDs.
//
// Enka's skillLevelMap is keyed by skill ID with no hint of which talent is which. The store's
// SkillOrder gives [normal, skill, burst]; Travelers are keyed "avatarId-skillDepotId".
// Characters missing from the store fall back to sorting the IDs (see src/lib/enka/import.ts).
import { writeFileSync } from "node:fs";

const STORE_URL = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json";
const ELEMENTS = { Fire: "Pyro", Water: "Hydro", Electric: "Electro", Ice: "Cryo", Wind: "Anemo", Rock: "Geo", Grass: "Dendro" };

const store = await (await fetch(STORE_URL)).json();
const skillOrder = {};
const travelerElement = {};
for (const [key, entry] of Object.entries(store)) {
  if (!entry.SkillOrder) continue;
  skillOrder[key] = entry.SkillOrder;
  if (key.includes("-") && ELEMENTS[entry.Element]) travelerElement[key] = ELEMENTS[entry.Element];
}

const out = new URL("../data/enka-skill-order.json", import.meta.url);
// One entry per line keeps patch-to-patch diffs readable.
const lines = (obj) => Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
writeFileSync(
  out,
  `{\n  "source": ${JSON.stringify(STORE_URL)},\n  "skillOrder": {\n${lines(skillOrder)}\n  },\n  "travelerElement": {\n${lines(travelerElement)}\n  }\n}\n`,
);
console.log(`Wrote ${Object.keys(skillOrder).length} skill orders, ${Object.keys(travelerElement).length} Traveler elements`);
