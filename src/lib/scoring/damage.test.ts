import { describe, expect, test } from "vitest";
import kit from "../../../data/kit.json";
import { carryDamage, expectedCrit, hasCarryKit, modelsAscendantGleam } from "./damage";
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

  describe("direct Lunar reaction DMG (#135)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const dps = (ids: string[], active: Reaction[], stats?: Partial<NonNullable<ScoringCharacter["stats"]>>) => {
      const c = byId.get(ids[0])!;
      const built = stats ? { ...c, stats: { atk: 2200, baseAtk: 950, hp: 16000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 120, elementalMastery: 100, elementalDmgBonus: 0, ...stats } } : c;
      return carryDamage(built, active, team(...ids).map((m) => (m.id === c.id ? built : m)))!.perSecond;
    };

    test("Lunar hits ignore Elemental DMG Bonus but grow with EM", () => {
      // Flins' Normal Attacks and Northland Spearstorm are plain Electro DMG: a 46.6% DMG bonus reaches only them.
      const flins = ["Flins", "Bennett", "Xingqiu", "Zhongli"];
      const base = dps(flins, [], {});
      const goblet = dps(flins, [], { elementalDmgBonus: 46.6 });
      expect(goblet).toBeGreaterThan(base);
      expect(goblet).toBeLessThan(base * 1.466);
      // Nefer's shades (Lunar-Bloom) scale on EM, inside the reaction's EM bonus too.
      const nefer = ["Nefer", "Lauma", "Xingqiu", "Zhongli"];
      expect(dps(nefer, ["lunar-bloom"], { elementalMastery: 900 })).toBeGreaterThan(dps(nefer, ["lunar-bloom"], { elementalMastery: 700 }) * 1.2);
    });

    test("Nefer's Phantasm Performance needs Lunar-Bloom (Verdant Dew)", () => {
      const ids = ["Nefer", "Lauma", "Xingqiu", "Zhongli"];
      expect(dps(ids, ["lunar-bloom"])).toBeGreaterThan(dps(ids, []) * 2);
    });

    test("Ascendant Gleam adds Zibai's N4 hit and Flins' thundercloud hit", () => {
      // Two Moonsign members (Columbina) vs one.
      expect(dps(["Zibai", "Columbina", "Furina", "Zhongli"], [])).toBeGreaterThan(dps(["Zibai", "Bennett", "Furina", "Zhongli"], []));
      const flinsGleam = ["Flins", "Ineffa", "Xingqiu", "Bennett"];
      // Flins' extra hit also needs thunderclouds: a Lunar-Charged reaction.
      expect(dps(flinsGleam, ["lunar-charged"])).toBeGreaterThan(dps(flinsGleam, []));
      expect(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], ["lunar-charged"])).toBe(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], []));
    });

    test("Flins' passive 2 EM counts for an imported build too (#149)", () => {
      // A build with the benchmark's own stats (ATK 2200, EM 100, 60% DMG bonus) deals what no build does: Enka's EM
      // leaves the passive out, so it's added either way.
      const ids = ["Flins", "Ineffa", "Xingqiu", "Bennett"];
      for (const active of [[], ["lunar-charged"]] as Reaction[][]) {
        expect(dps(ids, active, { elementalDmgBonus: 60 })).toBeCloseTo(dps(ids, active), 6);
      }
    });

    test("Flins' passive 1 adds 20% Reaction Bonus to his Lunar-Charged hits at Ascendant Gleam (#147)", () => {
      // With Ineffa (Moonsign) but no Lunar-Charged reaction the thundercloud hit can't land: only passive 1 differs.
      expect(dps(["Flins", "Ineffa", "Xingqiu", "Bennett"], [])).toBeGreaterThan(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], []));
    });

    test("Nefer's Veil of Falsehood needs Lunar-Bloom and Ascendant Gleam (#148)", () => {
      // Lauma (Moonsign) gives Ascendant Gleam, Nahida doesn't: 3 stacks = +24% Phantasm Performance and +100 EM.
      const gleam = dps(["Nefer", "Lauma", "Xingqiu", "Zhongli"], ["lunar-bloom"]);
      const none = dps(["Nefer", "Nahida", "Xingqiu", "Zhongli"], ["lunar-bloom"]);
      expect(gleam).toBeGreaterThan(none * 1.2);
      expect(dps(["Nefer", "Lauma", "Xingqiu", "Zhongli"], [])).toBe(dps(["Nefer", "Nahida", "Xingqiu", "Zhongli"], []));
    });

    test("Zibai's passive 1 is a Reaction Additive Base DMG Bonus, added after the Lunar coefficient (#146)", () => {
      const zibai = carries.Zibai as unknown as { hits: { label: string; lunar?: string; additive?: boolean }[] };
      expect(zibai.hits.find((h) => h.label === "passive1 bonus")).toMatchObject({ lunar: "lunar-crystallize", additive: true });
    });

    test("modelsAscendantGleam: carries whose own Ascendant Gleam upgrade is in their damage (#150)", () => {
      for (const id of ["Zibai", "Flins", "Nefer"]) expect(modelsAscendantGleam(id), id).toBe(true);
      expect(modelsAscendantGleam("Neuvillette")).toBe(false);
      expect(modelsAscendantGleam("Bennett")).toBe(false);
    });
  });

  test("a build's stats change the damage", () => {
    const raiden = byId.get("Raiden Shogun")!;
    const built: ScoringCharacter = {
      ...raiden,
      // DMG bonus as the character screen shows it: 46.6% goblet + her passive 2 (0.4% per ER over 100%) at 250% ER.
      stats: { atk: 2600, baseAtk: 950, hp: 20000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 250, elementalMastery: 0, elementalDmgBonus: 106.6 },
    };
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

  test("an imported build's DMG bonus already holds Raiden's ER passive: it isn't added again (#161)", () => {
    const raiden = byId.get("Raiden Shogun")!;
    // Jessie's Raiden from Enka: 108.8% Electro DMG Bonus = 46.6% goblet + 0.4 x 155.6 ER.
    const stats = { atk: 1952, baseAtk: 950, hp: 18886, def: 981, critRate: 42.3, critDmg: 112.2, energyRecharge: 255.6, elementalMastery: 23, elementalDmgBonus: 108.8 };
    const jessie: ScoringCharacter = { ...raiden, stats };
    const moreEr: ScoringCharacter = { ...raiden, stats: { ...stats, energyRecharge: 300 } };
    // ER only reaches her damage through the panel's DMG bonus, so more ER alone changes nothing.
    expect(carryDamage(moreEr)!.perSecond).toBeCloseTo(carryDamage(jessie)!.perSecond, 6);
  });
});

for (const [id, c] of Object.entries(carries)) {
  for (const m of c.missing ?? []) test.todo(`kit-overrides hitRates: ${id} ${m}`);
}
