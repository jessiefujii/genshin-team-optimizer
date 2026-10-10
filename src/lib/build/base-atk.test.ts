import { expect, test } from "vitest";
import { baseAtk } from "./base-atk";

const lv = (level: number, ascension?: number) => ({ level, ascension });

// Enka's base ATK (fight prop 4) for these builds in src/lib/enka/__fixtures__/uid-838859790.json.
test("matches the game's base ATK", () => {
  expect(baseAtk("Raiden Shogun", lv(90, 6), '"The Catch"', lv(90, 6))).toBe(847); // Enka 846.8
  expect(baseAtk("Bennett", lv(90, 6), "Sapwood Blade", lv(90, 6))).toBe(756); // Enka 755.9
  expect(baseAtk("Kamisato Ayaka", lv(80, 5), "Amenoma Kageuchi", lv(90, 6))).toBe(756); // Enka 756.1, 80/80
});

// At an ascension level the phase picks the value (#82): Prune 80/80 has 196 base ATK, 80/90 has 206.
test("ascension decides the value at an ascension level", () => {
  const before = baseAtk("Prune", lv(80, 5), "Sapwood Blade", lv(90, 6))!;
  const after = baseAtk("Prune", lv(80, 6), "Sapwood Blade", lv(90, 6))!;
  expect(after - before).toBeCloseTo(10, -1); // 195.8 vs 205.6, rounded with the weapon
  // No ascension saved (older builds): before ascending.
  expect(baseAtk("Prune", lv(80), "Sapwood Blade", lv(90))).toBe(before);
  // Weapons too: a level 80 weapon after ascending has more base ATK.
  const weaponBefore = baseAtk("Bennett", lv(90, 6), "Sapwood Blade", lv(80, 5))!;
  expect(baseAtk("Bennett", lv(90, 6), "Sapwood Blade", lv(80, 6))!).toBeGreaterThan(weaponBefore);
});

test("Traveler ids use Aether's stats; unknown names give undefined", () => {
  expect(baseAtk("Traveler (Pyro)", lv(90), "Sapwood Blade", lv(90))).toBe(baseAtk("Aether", lv(90), "Sapwood Blade", lv(90)));
  expect(baseAtk("Bennett", lv(90), "No Such Sword", lv(90))).toBeUndefined();
  // genshin-db matches names loosely; a near-miss must not pick some other weapon or character.
  expect(baseAtk("Bennett", lv(90), "Nope", lv(90))).toBeUndefined();
  expect(baseAtk("Benet", lv(90), "Sapwood Blade", lv(90))).toBeUndefined();
});
