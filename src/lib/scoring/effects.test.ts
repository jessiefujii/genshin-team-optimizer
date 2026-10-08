import genshindb from "genshin-db";
import { describe, expect, test } from "vitest";
import effectsJson from "../../../data/effects.json";
import tagsJson from "../../../data/tags.json";
import type { CharacterBuild } from "../../types/build";
import type { EffectTag } from "../../types/effects";
import { characterEffects } from "./effects";
import { ELEMENTS, REACTIONS, ROLES, SCALING_STATS, type CharacterTags } from "../../types/tags";

const effects = effectsJson as EffectTag[];
const tagIds = new Set((tagsJson as CharacterTags[]).map((t) => t.id));
const key = (e: EffectTag) => `${e.source}|${e.id}|${e.requires ?? ""}`;

describe("data/effects.json", () => {
  test("every item exists: weapons and sets in genshin-db, characters in tags.json", () => {
    const missing = effects.filter((e) =>
      e.source === "weapon" ? !genshindb.weapons(e.id) : e.source === "set" ? !genshindb.artifacts(e.id) : !tagIds.has(e.id),
    );
    expect(missing.map(key)).toEqual([]);
  });

  test("requires matches the source: 2/4 pieces, C1-C6, nothing for weapons", () => {
    const bad = effects.filter((e) =>
      e.source === "weapon"
        ? e.requires !== undefined
        : e.source === "set"
          ? e.requires !== 2 && e.requires !== 4
          : !Number.isInteger(e.requires) || e.requires! < 1 || e.requires! > 6,
    );
    expect(bad.map(key)).toEqual([]);
  });

  test("no duplicate entries", () => {
    const keys = effects.map(key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  test("every entry does something, using known roles, elements, stats and reactions", () => {
    const bad = effects.filter(
      (e) =>
        !(e.buffs?.length || e.roles?.length || e.infusion) ||
        e.roles?.some((r) => !ROLES.includes(r)) ||
        (e.infusion && !ELEMENTS.includes(e.infusion)) ||
        e.buffs?.some(
          (b) =>
            !b.stat ||
            (b.scope !== "team" && b.scope !== "active") ||
            (b.affects && !SCALING_STATS.includes(b.affects)) ||
            b.elements?.some((el) => !ELEMENTS.includes(el)) ||
            b.reactions?.some((r) => !REACTIONS.includes(r)),
        ),
    );
    expect(bad.map(key)).toEqual([]);
  });

  test("known effects are drafted", () => {
    const find = (source: EffectTag["source"], id: string, requires?: number) =>
      effects.find((e) => e.source === source && e.id === id && e.requires === requires);
    expect(find("set", "Noblesse Oblige", 4)?.buffs).toContainEqual({ stat: "ATK", scope: "team", affects: "ATK" });
    expect(find("weapon", "Favonius Sword")?.roles).toEqual(["battery"]);
    expect(find("constellation", "Bennett", 6)?.infusion).toBe("Pyro");
    expect(find("constellation", "Xiangling", 1)?.buffs?.[0]).toMatchObject({ stat: "Pyro RES shred", elements: ["Pyro"] });
  });
});

describe("characterEffects", () => {
  const build = (weapon: string, artifactSets: CharacterBuild["artifactSets"]): CharacterBuild => ({
    level: 90,
    talents: { normal: 9, skill: 9, burst: 9 },
    weapon: { id: weapon, level: 90, refinement: 1 },
    artifactSets,
    stats: { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRecharge: 0, elementalMastery: 0, elementalDmgBonus: 0 },
  });
  const keys = (list: EffectTag[]) => list.map(key);

  test("constellations up to the owned level", () => {
    expect(keys(characterEffects("Xiangling", 0))).toEqual([]);
    expect(keys(characterEffects("Xiangling", 1))).toEqual(["constellation|Xiangling|1"]);
    expect(keys(characterEffects("Xiangling", 6))).toContain("constellation|Xiangling|6");
  });

  test("weapon and set bonuses come from the build", () => {
    const found = keys(characterEffects("Bennett", 0, build("Favonius Sword", [{ set: "Noblesse Oblige", pieces: 4 }])));
    expect(found).toContain("weapon|Favonius Sword|");
    expect(found).toContain("set|Noblesse Oblige|4");
  });

  test("a 2pc set doesn't get the 4pc bonus", () => {
    const found = keys(characterEffects("Bennett", 0, build("Favonius Sword", [{ set: "Noblesse Oblige", pieces: 2 }])));
    expect(found).not.toContain("set|Noblesse Oblige|4");
  });
});
