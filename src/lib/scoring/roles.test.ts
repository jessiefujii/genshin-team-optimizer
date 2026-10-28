// tags.json's DPS roles and field time come from the in-game Character Roles on the wiki (#105, npm run roles).
import { describe, expect, test } from "vitest";
import tags from "../../../data/tags.json";
import overrides from "../../../data/role-overrides.json";
import wiki from "../../../data/wiki-roles.json";

const WIKI = (wiki as { characters: Record<string, { roles: string[] }> }).characters;
// Roles changed from the wiki's by Jessie's decision: added (Traveler (Cryo) on-field, #136), dropped (Lan Yan's main-dps, #216;
// Traveler (Anemo)'s, now an off-field sub-DPS, #236).
const OVERRIDES = (overrides as { characters: Record<string, { add?: string[]; drop?: string[] }> }).characters;

describe("character roles (#105)", () => {
  test("DPS roles and field time match the wiki", () => {
    for (const c of tags) {
      if (!WIKI[c.id]) continue;
      const roles = [...WIKI[c.id].roles, ...(OVERRIDES[c.id]?.add ?? [])];
      const dropped = OVERRIDES[c.id]?.drop ?? [];
      const on = roles.includes("On-Field");
      const off = roles.includes("Off-Field");
      const dps = roles.includes("DPS");
      expect(c.roles.includes("main-dps"), `${c.id} main-dps`).toBe(dps && on && !dropped.includes("main-dps"));
      expect(c.roles.includes("sub-dps"), `${c.id} sub-dps`).toBe(dps && off && !dropped.includes("sub-dps"));
      expect(c.fieldTime, `${c.id} fieldTime`).toBe(on && off ? "flex" : on ? "on" : "off");
    }
  });

  // The wiki says Survivability without saying how; healer, shielder and mitigation (#113) stay hand-written.
  const noSurvivalTag = tags
    .filter((c) => WIKI[c.id]?.roles.includes("Survivability") && !c.roles.some((r) => r === "healer" || r === "shielder" || r === "mitigation"))
    .map((c) => c.id);
  test.todo(`Survivability on the wiki but no healer, shielder or mitigation tag: ${noSurvivalTag.join(", ")}`);
  const noWiki = tags.filter((c) => !WIKI[c.id]).map((c) => c.id);
  test.todo(`no Character Roles on the wiki, hand tags kept: ${noWiki.join(", ")}`);
});
