import { describe, expect, test } from "vitest";
import kit from "../../../data/kit.json";
import { carryDamage, expectedCrit, hasCarryKit } from "./damage";
import { KNOWN_TEAMS } from "./known-teams";
import { loadScoringCharacters } from "./load";
import type { Reaction, ScoringCharacter } from "./types";

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

  describe("the carry's combo is picked by team (#114)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const comboOf = (ids: string[], active: Reaction[]) => carryDamage(byId.get(ids[0])!, active, team(...ids))!.combo;

    test("Mavuika: Melt with Citlali as the only Cryo, Vaporize by Hydro unit, C8F without either", () => {
      expect(comboOf(["Mavuika", "Citlali", "Xilonen", "Bennett"], ["melt"])).toBe("E Q C3F D C3F");
      expect(comboOf(["Mavuika", "Citlali", "Diona", "Bennett"], ["melt"])).toBe("E Q C2D C3D C4"); // double Cryo
      expect(comboOf(["Mavuika", "Kaeya", "Xilonen", "Bennett"], ["melt"])).toBe("E Q J C8");
      expect(comboOf(["Mavuika", "Furina", "Xilonen", "Bennett"], ["vaporize"])).toBe("E Q C2D C3D C4");
      expect(comboOf(["Mavuika", "Yelan", "Kachina", "Bennett"], ["vaporize"])).toBe("E Q 4[C2D] C");
      expect(comboOf(["Mavuika", "Xilonen", "Kachina", "Bennett"], [])).toBe("E Q C8F");
      // Citlali without Melt active (no team reaction passed): the default.
      expect(comboOf(["Mavuika", "Citlali", "Xilonen", "Bennett"], [])).toBe("E Q C8F");
    });

    test("Mavuika's Melt combo melts the hits KQM says, so it outdamages C8F in a Melt team", () => {
      const ids = ["Mavuika", "Citlali", "Xilonen", "Bennett"];
      const melt = carryDamage(byId.get("Mavuika")!, ["melt"], team(...ids))!.perSecond;
      const none = carryDamage(byId.get("Mavuika")!, [], team(...ids))!.perSecond;
      expect(melt).toBeGreaterThan(none * 1.3);
    });

    test("Wriothesley: E 3[N5CD] N2 when the team triggers Stellar-Conduct, else E 5[N3C]", () => {
      expect(comboOf(["Wriothesley", "Sandrone", "Fischl", "Furina"], ["stellar-conduct", "electrocharged"])).toBe("E 3[N5CD] N2");
      expect(comboOf(["Wriothesley", "Furina", "Fischl", "Bennett"], ["freeze"])).toBe("E 5[N3C] (Q)");
    });

    test("carries with one combo report none", () => {
      expect(carryDamage(byId.get("Varesa")!)!.combo).toBeUndefined();
    });
  });

  test("Neuvillette's passive 1 grows with the kinds of reaction his team triggers (#129)", () => {
    const neuvillette = byId.get("Neuvillette")!;
    const dps = (active: Reaction[]) => carryDamage(neuvillette, active)!.perSecond;
    // 110%/125%/160% on Equitable Judgment for 1/2/3 kinds; reactions outside his list (Melt) add none.
    expect(dps(["swirl"])).toBeGreaterThan(dps([]));
    expect(dps(["swirl", "crystallize", "vaporize"])).toBeGreaterThan(dps(["swirl", "crystallize"]));
    expect(dps(["melt"])).toBe(dps([]));
  });

  test("Spread and Aggravate add flat damage to the hits that react (#129)", () => {
    const alhaitham = byId.get("Alhaitham")!;
    const clorinde = byId.get("Clorinde")!;
    expect(carryDamage(alhaitham, ["spread"])!.perSecond).toBeGreaterThan(carryDamage(alhaitham, [])!.perSecond * 1.2);
    expect(carryDamage(clorinde, ["aggravate"])!.perSecond).toBeGreaterThan(carryDamage(clorinde, [])!.perSecond * 1.2);
    // Aggravate only adds to Electro hits: Alhaitham (Dendro) gains nothing from it.
    expect(carryDamage(alhaitham, ["aggravate"])!.perSecond).toBe(carryDamage(alhaitham, [])!.perSecond);
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

  test("hits count at expected crit: the build's, else the benchmark's (#152)", () => {
    const raiden = byId.get("Raiden Shogun")!;
    const stats = { atk: 2200, baseAtk: 950, hp: 20000, def: 900, energyRecharge: 100, elementalMastery: 100, elementalDmgBonus: 60 };
    expect(expectedCrit(raiden)).toBeCloseTo(1.72); // benchmark 60% / 120%
    expect(expectedCrit({ ...raiden, stats: { ...stats, critRate: 80, critDmg: 200 } })).toBeCloseTo(2.6);
    expect(expectedCrit({ ...raiden, stats: { ...stats, critRate: 130, critDmg: 100 } })).toBeCloseTo(2); // rate caps at 100%
    // Same ATK and DMG bonus, better crit: damage grows by the crit ratio alone.
    const crit = { ...raiden, stats: { ...stats, critRate: 80, critDmg: 200 } };
    const plain = { ...raiden, stats: { ...stats, critRate: 60, critDmg: 120 } };
    expect(carryDamage(crit)!.perSecond / carryDamage(plain)!.perSecond).toBeCloseTo(2.6 / 1.72);
  });
});

for (const [id, c] of Object.entries(carries)) {
  for (const m of c.missing ?? []) test.todo(`kit-overrides hitRates: ${id} ${m}`);
}
