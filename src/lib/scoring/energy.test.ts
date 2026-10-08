import { expect, test } from "vitest";
import { energyCheck } from "./energy";
import { loadScoringCharacters } from "./load";
import { scoreTeam } from "./score";

const all = loadScoringCharacters();
const get = (id: string) => all.find((c) => c.id === id)!;

test("burst costs come from genshin-db; bursts without Energy are left out", () => {
  expect(get("Xingqiu").burstCost).toBe(80);
  expect(get("Raiden Shogun").burstCost).toBe(90);
  expect(get("Traveler (Anemo)").burstCost).toBe(60);
  expect(get("Mavuika").burstCost).toBeUndefined();
  expect(all.filter((c) => !c.burstCost).map((c) => c.id)).toEqual(["Mavuika", "Skirk"]);
});

test("each member's burst cost against their ER target and, with a build, their ER", () => {
  const xingqiu = { ...get("Xingqiu"), stats: { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRecharge: 160, elementalMastery: 0, elementalDmgBonus: 0 } };
  const lines = energyCheck([get("Hu Tao"), xingqiu, get("Mavuika"), get("Zhongli")]);
  expect(lines).toEqual([
    { id: "Hu Tao", cost: 60, target: 100, er: undefined },
    { id: "Xingqiu", cost: 80, target: 200, er: 160 },
    { id: "Zhongli", cost: 40, target: 100, er: undefined },
  ]);
});

test("scored teams carry the energy check", () => {
  expect(scoreTeam(["Hu Tao", "Xingqiu", "Yelan", "Zhongli"].map(get)).energy).toHaveLength(4);
});
