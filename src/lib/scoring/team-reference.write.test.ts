// Rewrites data/team-reference.json (`npm run reference`). Kept out of `npm test`, which only checks it.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { loadScoringCharacters } from "./load";
import { computeReference } from "./team-reference";

test("write data/team-reference.json", () => {
  const reference = computeReference(loadScoringCharacters());
  writeFileSync("data/team-reference.json", `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`median ${reference.median} over ${Object.keys(reference.carries).length} carries`);
});
