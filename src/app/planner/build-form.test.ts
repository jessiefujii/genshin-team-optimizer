import { describe, expect, test } from "vitest";
import type { CharacterBuild } from "../../types/build";
import { parseForm, toForm, type BuildForm } from "./build-form";

const raiden: CharacterBuild = {
  level: 90,
  talents: { normal: 6, skill: 7, burst: 10 },
  weapon: { id: '"The Catch"', level: 90, refinement: 5 },
  artifactSets: [{ set: "Emblem of Severed Fate", pieces: 4 }],
  stats: {
    atk: 1952, hp: 18886, def: 981, critRate: 42.3, critDmg: 112.2,
    energyRecharge: 255.6, elementalMastery: 23, elementalDmgBonus: 108.8,
  },
};

const errorsOf = (form: BuildForm) => {
  const result = parseForm(form);
  return "errors" in result ? result.errors : [];
};

describe("build form", () => {
  test("an imported build round-trips through the form unchanged", () => {
    expect(parseForm(toForm(raiden))).toEqual({ build: raiden });
  });

  test("a new build needs a weapon and every stat", () => {
    const errors = errorsOf(toForm(undefined));
    expect(errors).toContain("Pick a weapon.");
    expect(errors).toContain("CRIT Rate is required.");
    expect(errors).toHaveLength(9); // weapon + 8 stats; Base ATK is optional
  });

  test("Base ATK is optional, and kept when filled in (#80)", () => {
    const form = toForm(raiden);
    expect(form.stats.baseAtk).toBe("");
    form.stats.baseAtk = "942";
    const result = parseForm(form);
    expect("build" in result && result.build.stats.baseAtk).toBe(942);
  });

  test("percent stats typed as fractions are caught", () => {
    const form = toForm(raiden);
    form.stats.critRate = "0.423";
    form.stats.energyRecharge = "1.556";
    expect(errorsOf(form)).toEqual([
      "CRIT Rate can't be below 5%; type it as shown in game, e.g. 48.9.",
      "Energy Recharge can't be below 100%; type it as shown in game, e.g. 48.9.",
    ]);
  });

  test("accepts a trailing % and rounds like the game", () => {
    const form = toForm(raiden);
    form.stats.critDmg = "112.24%";
    form.stats.atk = "1951.6";
    const result = parseForm(form);
    expect("build" in result && result.build.stats).toMatchObject({ critDmg: 112.2, atk: 1952 });
  });

  test("2pc + 2pc sets, and the same set twice is rejected", () => {
    const form: BuildForm = { ...toForm(raiden), set1: "Gladiator's Finale", set1Pieces: "2", set2: "Shimenawa's Reminiscence" };
    const result = parseForm(form);
    expect("build" in result && result.build.artifactSets).toEqual([
      { set: "Gladiator's Finale", pieces: 2 },
      { set: "Shimenawa's Reminiscence", pieces: 2 },
    ]);
    expect(errorsOf({ ...form, set2: "Gladiator's Finale" })).toHaveLength(1);
  });

  test("talent levels outside 1-15 are rejected", () => {
    expect(errorsOf({ ...toForm(raiden), burst: "16" })).toEqual([
      "Elemental Burst level must be a whole number from 1 to 15.",
    ]);
  });
});
