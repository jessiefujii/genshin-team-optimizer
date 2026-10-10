import { expect, test } from "vitest";
import { baseAtk } from "./base-atk";

// Enka's base ATK (fight prop 4) for these builds in src/lib/enka/__fixtures__/uid-838859790.json.
test("matches the game's base ATK", () => {
  expect(baseAtk("Raiden Shogun", 90, '"The Catch"', 90)).toBe(847); // Enka 846.8
  expect(baseAtk("Bennett", 90, "Sapwood Blade", 90)).toBe(756); // Enka 755.9
  expect(baseAtk("Kamisato Ayaka", 80, "Amenoma Kageuchi", 90)).toBe(756); // Enka 756.1, level 80 before ascending
});

test("Traveler ids use Aether's stats; unknown names give undefined", () => {
  expect(baseAtk("Traveler (Pyro)", 90, "Sapwood Blade", 90)).toBe(baseAtk("Aether" as string, 90, "Sapwood Blade", 90));
  expect(baseAtk("Bennett", 90, "No Such Sword", 90)).toBeUndefined();
  // genshin-db matches names loosely; a near-miss must not pick some other weapon or character.
  expect(baseAtk("Bennett", 90, "Nope", 90)).toBeUndefined();
  expect(baseAtk("Benet", 90, "Sapwood Blade", 90)).toBeUndefined();
});
