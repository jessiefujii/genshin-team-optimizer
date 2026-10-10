import { describe, expect, test } from "vitest";
import { mapFightProps } from "./stats";

// Trimmed from a real Enka response (Zhongli, UID 838859790).
const zhongli = {
  "20": 0.489300012588501,
  "22": 0.7563999891281128,
  "23": 1.0648000240325928,
  "28": 100.23999786376953,
  "30": 0,
  "42": 0,
  "45": 0.7539999485015869,
  "4": 755.94,
  "2000": 40489.12,
  "2001": 1206.73,
  "2002": 1043.5,
};

describe("mapFightProps", () => {
  test("converts final stats, with percent stats in percent", () => {
    expect(mapFightProps(zhongli, "Geo")).toEqual({
      hp: 40489,
      atk: 1207,
      def: 1044,
      critRate: 48.9,
      critDmg: 75.6,
      energyRecharge: 106.5,
      elementalMastery: 100,
      elementalDmgBonus: 75.4,
      baseAtk: 756,
    });
  });

  test("reads the DMG bonus of the character's own element only", () => {
    expect(mapFightProps(zhongli, "Hydro").elementalDmgBonus).toBe(0);
  });

  test("treats missing props as 0", () => {
    expect(mapFightProps({}, "Pyro").critRate).toBe(0);
  });
});
