import { expect, test } from "vitest";
import { carryDamage } from "./damage";
import { ENERGY, burstShare, energyCheck, energyNeeds } from "./energy";
import { KNOWN_TEAMS } from "./known-teams";
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

test("each member's burst cost against their ER target, this team's modeled need and, with a build, their ER", () => {
  const xingqiu = { ...get("Xingqiu"), stats: { atk: 0, hp: 0, def: 0, critRate: 0, critDmg: 0, energyRecharge: 160, elementalMastery: 0, elementalDmgBonus: 0 } };
  const lines = energyCheck([get("Hu Tao"), xingqiu, get("Mavuika"), get("Zhongli")]);
  expect(lines).toEqual([
    { id: "Hu Tao", cost: 60, target: 100, need: 100, er: undefined },
    { id: "Xingqiu", cost: 80, target: 200, need: 200, er: 160 },
    { id: "Zhongli", cost: 40, target: 100, need: 100, er: undefined },
  ]);
});

test("scored teams carry the energy check", () => {
  expect(scoreTeam(["Hu Tao", "Xingqiu", "Yelan", "Zhongli"].map(get)).energy).toHaveLength(4);
});

// Particle model (#37).
const team = (...ids: string[]) => ids.map(get);
const needOf = (ids: string[], id: string) => {
  const t = team(...ids);
  return energyNeeds(t, t[0], carryDamage(t[0], [], t)?.rotationSeconds).get(get(id))!;
};

test("guide targets cover most KQM guide teams: the model is anchored to them (#37)", () => {
  const ratios: number[] = [];
  for (const k of KNOWN_TEAMS)
    for (const ids of k.teams) {
      const t = ids.map(get);
      const carry = get(k.carry);
      for (const [, e] of energyNeeds(t, carry, carryDamage(carry, [], t)?.rotationSeconds)) ratios.push(e.need / e.target);
    }
  ratios.sort((a, b) => a - b);
  const q = (p: number) => ratios[Math.floor(p * (ratios.length - 1))];
  // The calibration (ENERGY.standardParticles, otherEnergy): the target covers 3 in 4 guide-team members.
  expect(q(0.75)).toBeGreaterThan(0.95);
  expect(q(0.75)).toBeLessThan(1.02);
  expect(q(1)).toBeLessThan(1.3); // no guide team far short
});

test("same-element particles lower a member's ER need: Bennett feeds Xiangling (#37)", () => {
  const withBennett = needOf(["Raiden Shogun", "Xiangling", "Bennett", "Xingqiu"], "Xiangling").need;
  const withoutBennett = needOf(["Raiden Shogun", "Xiangling", "Kaedehara Kazuha", "Xingqiu"], "Xiangling").need;
  expect(withBennett).toBeLessThan(withoutBennett);
});

test("a team short of particles can't fund every Burst; a lone carry is never cut (#37)", () => {
  // Ineffa (no wiki count: a standard teammate), Columbina's 1.33 particles and no Electro battery.
  const ineffa = needOf(["Neuvillette", "Ineffa", "Columbina", "Sucrose"], "Ineffa");
  expect(ineffa.need).toBeGreaterThan(ineffa.target);
  expect(ineffa.share).toBeCloseTo(ineffa.target / ineffa.need, 2);
  expect(burstShare(get("Hu Tao"), [get("Hu Tao")], get("Hu Tao"))).toBe(1);
});

test("flat Energy counts: Raiden's Burst funds the team, beyond what ER scales (#37)", () => {
  const raiden = team("Raiden Shogun", "Xiangling", "Xingqiu", "Bennett");
  const withRaiden = energyNeeds(raiden, raiden[0], 18).get(get("Xingqiu"))!.need;
  const withFischl = energyNeeds(team("Fischl", "Xiangling", "Xingqiu", "Bennett"), null, 18).get(get("Xingqiu"))!.need;
  expect(withRaiden).toBeLessThan(withFischl);
  expect(ENERGY.offField).toBe(0.6); // 4-member party (wiki Energy § Particles and Orbs)
});
