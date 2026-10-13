import { describe, expect, test } from "vitest";
import type { CharacterBuild } from "../../types/build";
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
    expect(belowMinimum(build({ level: 60, weapon: { id: "Cool Steel", level: 20, refinement: 5 } }), rarity)).toEqual([]);
  });

  test("each of Jessie's rules leaves a character out, with the reason", () => {
    expect(belowMinimum(build({ artifactSets: [] }), rarity)).toEqual(["no artifact set"]);
    expect(belowMinimum(build({ level: 1 }), rarity)).toEqual(["level 1"]);
    expect(belowMinimum(build({ weapon: { id: "Favonius Sword", level: 1, refinement: 1 } }), rarity)).toEqual(["weapon level 1"]);
    expect(belowMinimum(build({ weapon: { id: "Dull Blade", level: 90, refinement: 5 } }), rarity)).toEqual(["1-star weapon"]);
    expect(belowMinimum(build({ weapon: { id: "Silver Sword", level: 1, refinement: 1 }, artifactSets: [] }), rarity)).toEqual([
      "no artifact set",
      "weapon level 1",
      "2-star weapon",
    ]);
  });

  test("no build: nothing to check, the Built box decides", () => {
    expect(belowMinimum(undefined, rarity)).toEqual([]);
  });
});
