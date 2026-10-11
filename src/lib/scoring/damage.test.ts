import { describe, expect, test } from "vitest";
import kit from "../../../data/kit.json";
import { carryDamage, hasCarryKit } from "./damage";
import { KNOWN_TEAMS } from "./known-teams";
import { loadScoringCharacters } from "./load";
import type { ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const carries = (kit as unknown as { carries: Record<string, { missing?: string[] }> }).carries;

describe("carry damage (#101)", () => {
  test("every carry npm run compare measures has kit data", () => {
    for (const { carry } of KNOWN_TEAMS) expect(hasCarryKit(carry), carry).toBe(true);
  });

  test("a carry's damage is positive, and null without kit data", () => {
    for (const { carry } of KNOWN_TEAMS) expect(carryDamage(byId.get(carry)!)!.perSecond, carry).toBeGreaterThan(0);
    expect(carryDamage(byId.get("Bennett")!)).toBeNull();
  });

  test("the main reaction only counts when the team can trigger it (Vaporize for Hu Tao)", () => {
    const huTao = byId.get("Hu Tao")!;
    expect(carryDamage(huTao, ["vaporize"])!.perSecond).toBeGreaterThan(carryDamage(huTao, [])!.perSecond * 1.3);
  });

  test("Mavuika's own damage grows with the Fighting Spirit her team builds", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const mavuika = byId.get("Mavuika")!;
    // No other Nightsoul member: her Skill's 80 is under the 100 her Burst needs, so E only: no Burst hits (#116).
    const none = carryDamage(mavuika, [], team("Mavuika", "Bennett", "Furina", "Xingqiu"))!.perSecond;
    const one = carryDamage(mavuika, [], team("Mavuika", "Furina", "Xilonen", "Bennett"))!.perSecond; // 80 + 90 = 170
    const two = carryDamage(mavuika, [], team("Mavuika", "Citlali", "Xilonen", "Bennett"))!.perSecond; // 200, the limit
    expect(one).toBeGreaterThan(none * 2);
    expect(two).toBeGreaterThan(one * 1.05);
  });

  test("a build's stats change the damage", () => {
    const raiden = byId.get("Raiden Shogun")!;
    const built: ScoringCharacter = {
      ...raiden,
      stats: { atk: 2600, baseAtk: 950, hp: 20000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 250, elementalMastery: 0, elementalDmgBonus: 46.6 },
    };
    // More ATK and ER (her passive 2: Electro DMG Bonus per ER over 100%) than the benchmark.
    expect(carryDamage(built)!.perSecond).toBeGreaterThan(carryDamage(raiden)!.perSecond);
  });
});

for (const [id, c] of Object.entries(carries)) {
  for (const m of c.missing ?? []) test.todo(`kit-overrides hitRates: ${id} ${m}`);
}
