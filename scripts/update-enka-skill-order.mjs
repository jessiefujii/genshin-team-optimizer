// Regenerates data/enka-skill-order.json from Enka's characters store.
// Run with `node scripts/update-enka-skill-order.mjs` when a patch adds characters with unusual talent IDs.
//
// Enka's skillLevelMap is keyed by skill ID with no hint of which talent is which. The store's
// SkillOrder gives [normal, skill, burst]; Travelers are keyed "avatarId-skillDepotId".
// Characters missing from the store fall back to sorting the IDs (see src/lib/enka/import.ts).
import { writeFileSync } from "node:fs";

const STORE_URL = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json";
const ELEMENTS = { Fire: "Pyro", Water: "Hydro", Electric: "Electro", Ice: "Cryo", Wind: "Anemo", Rock: "Geo", Grass: "Dendro" };

// Traveler depots Enka's store doesn't have yet (#136). Cryo: genshin-db's "Traveler (Cryo)" talents have id 705,
// and the other elements' ids are Lumine's depots (702 Pyro ... 708 Dendro). Skill IDs from Jessie's Lumine on Enka
// (skillLevelMap 10127, 10128, 100554; burst 10128 by proudSkillExtraLevelMap 839, as Anemo's 10068 is 739).
// Aether's 505 and 100544 follow the 50x/70x pattern of the other elements: not seen on a real profile yet.
const MISSING = {
  "10000005-505": { Element: "Ice", SkillOrder: [100544, 10127, 10128] },
  "10000007-705": { Element: "Ice", SkillOrder: [100554, 10127, 10128] },
};

const store = { ...MISSING, ...(await (await fetch(STORE_URL)).json()) };
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
