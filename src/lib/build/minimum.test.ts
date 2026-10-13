import { describe, expect, test } from "vitest";
import roster from "../../../data/test-rosters/jessie.json";
import tags from "../../../data/tags.json";
import type { CharacterBuild } from "../../types/build";
import type { Talent } from "../../types/tags";
import { belowMinimum } from "./minimum";

const stats = { hp: 15000, atk: 1500, def: 800, critRate: 50, critDmg: 100, energyRecharge: 120, elementalMastery: 0, elementalDmgBonus: 46.6 };
const build = (over: Partial<CharacterBuild> = {}): CharacterBuild => ({
  level: 90,
  talents: { normal: 6, skill: 9, burst: 9 },
  weapon: { id: "Favonius Sword", level: 90, refinement: 1 },
  artifactSets: [{ set: "Emblem of Severed Fate", pieces: 4 }],
  stats,
  ...over,
});
const rarity = { "Favonius Sword": 4, "Dull Blade": 1, "Silver Sword": 2, "Cool Steel": 3 };

describe("minimum requirements for the team search (#133)", () => {
  test("a usable build passes", () => {
    expect(belowMinimum(build(), rarity)).toEqual([]);
    expect(belowMinimum(build({ level: 61, weapon: { id: "Cool Steel", level: 21, refinement: 5 } }), rarity, "normal")).toEqual([]);
  });

  test("each rule leaves a character out, with the reason", () => {
    expect(belowMinimum(build({ artifactSets: [] }), rarity)).toEqual(["no artifact set bonus (no 2- or 4-piece set)"]);
    expect(belowMinimum(build({ level: 60 }), rarity)).toEqual(["level 60: below the level 61 minimum"]);
    expect(belowMinimum(build({ weapon: { id: "Favonius Sword", level: 20, refinement: 1 } }), rarity)).toEqual([
      "weapon level 20: below the level 21 minimum (not ascended)",
    ]);
    expect(belowMinimum(build({ weapon: { id: "Dull Blade", level: 90, refinement: 5 } }), rarity)).toEqual([
      "1-star weapon: below the 3-star minimum",
    ]);
    expect(belowMinimum(build({ talents: { normal: 1, skill: 9, burst: 9 } }), rarity, "normal")).toEqual([
      "Normal Attack (key talent) level 1: not levelled",
    ]);
    expect(belowMinimum(build({ weapon: { id: "Silver Sword", level: 1, refinement: 1 }, artifactSets: [] }), rarity)).toEqual([
      "no artifact set bonus (no 2- or 4-piece set)",
      "weapon level 1: below the level 21 minimum (not ascended)",
      "2-star weapon: below the 3-star minimum",
    ]);
  });

  test("Normal Attack at 1 only counts for a main DPS whose key talent it is", () => {
    expect(belowMinimum(build({ talents: { normal: 1, skill: 9, burst: 9 } }), rarity)).toEqual([]);
    expect(belowMinimum(build({ talents: { normal: 1, skill: 9, burst: 9 } }), rarity, "skill")).toEqual([]);
  });

  test("no build: nothing to check, the Built box decides", () => {
    expect(belowMinimum(undefined, rarity)).toEqual([]);
  });

  // Jessie's roster (data/test-rosters/jessie.json): her built characters all pass; the minimum only drops ones she
  // already marks not built. Weapon rarity isn't in the roster, so that rule is left out here.
  test("none of Jessie's built characters is below the minimum", () => {
    const key = new Map(tags.map((t) => [t.id, (t as { keyTalent?: Talent }).keyTalent]));
    const entries = Object.entries(roster as Record<string, { built: boolean; build?: CharacterBuild }>);
    const built = entries.filter(([, e]) => e.built).map(([id, e]) => [id, belowMinimum(e.build, {}, key.get(id))]);
    expect(built.filter(([, why]) => why.length > 0)).toEqual([]);
  });
});
