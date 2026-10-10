import { expect, test } from "vitest";
import { ascensionOf, isAscensionLevel, levelCap } from "./ascension";

// Phases checked against a live Enka showcase (UID 838859790, 2026-10-10): level 90 = 6, level 80 before
// ascending = 5, a level 61 weapon = 4.
test("ascension phase from level", () => {
  expect(ascensionOf(90, false)).toBe(6);
  expect(ascensionOf(80, false)).toBe(5);
  expect(ascensionOf(80, true)).toBe(6);
  expect(ascensionOf(61, false)).toBe(4);
  expect(ascensionOf(61, true)).toBe(4); // not an ascension level: nothing to choose
  expect(ascensionOf(1, false)).toBe(0);
});

test("ascension levels and caps", () => {
  expect([20, 40, 50, 60, 70, 80].every(isAscensionLevel)).toBe(true);
  expect(isAscensionLevel(90)).toBe(false);
  expect(levelCap(5)).toBe(80);
  expect(levelCap(6)).toBe(90);
});
