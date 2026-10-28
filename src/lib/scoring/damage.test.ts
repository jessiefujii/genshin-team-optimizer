import { describe, expect, test } from "vitest";
import kit from "../../../data/kit.json";
import { carryDamage, expectedCrit, hasCarryKit, modelsAscendantGleam, modelsReaction, modelsSecretRite, setBuffs, setsOf, weaponBuffs, weaponDmgBonus } from "./damage";
import { NO_TEAM_BUFFS, memberBuffStats, partySetBuffs, teamBuffStats } from "./kit";
import { characterEffects } from "./effects";
import { scoreTeam } from "./score";
import { resShredGain } from "./benchmark";
import { KNOWN_TEAMS } from "./known-teams";
import { loadScoringCharacters } from "./load";
import type { Reaction, ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const carries = (kit as unknown as { carries: Record<string, { missing?: string[] }> }).carries;
// A benchmark carry's guide weapon (#206), for builds that should hold the same one.
const benchWeapon = (id: string) => {
  const b = (kit as unknown as { benchmarkWeapons: Record<string, { weapon: string; refinement: number }> }).benchmarkWeapons[id];
  return { id: b.weapon, level: 90, refinement: b.refinement };
};

describe("carry damage (#101)", () => {
  test("every carry npm run compare measures has kit data", () => {
    for (const { carry } of KNOWN_TEAMS) expect(hasCarryKit(carry), carry).toBe(true);
  });

  test("a carry's damage is positive, and null without kit data", () => {
    for (const { carry } of KNOWN_TEAMS) expect(carryDamage(byId.get(carry)!)!.perSecond, carry).toBeGreaterThan(0);
    expect(carryDamage(byId.get("Bennett")!)).toBeNull();
  });

  test("measured reaction shares: the part of the carry's damage a bonus to each reaction reaches (#94)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const shares = (active: Reaction[], ...ids: string[]) => carryDamage(byId.get(ids[0])!, active, team(...ids))!.shares;
    // Hu Tao's Vaporize multiplies most of her hits; Clorinde's Aggravate only adds flat damage to some.
    const vape = shares(["vaporize"], "Hu Tao", "Xingqiu", "Yelan", "Zhongli").vaporize!;
    const aggravate = shares(["aggravate", "quicken", "overloaded"], "Clorinde", "Fischl", "Nahida", "Kaedehara Kazuha").aggravate!;
    expect(vape).toBeGreaterThan(0.6);
    expect(vape).toBeLessThanOrEqual(1);
    expect(aggravate).toBeGreaterThan(0.05);
    expect(aggravate).toBeLessThan(vape);
    // No reaction in the team: nothing to reach.
    expect(shares([], "Hu Tao", "Xingqiu", "Yelan", "Zhongli")).toEqual({});
  });

  test("rotation length: a sourced team length, else the carry's sourced default, else the Burst cooldown (#103)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const seconds = (...ids: string[]) => carryDamage(byId.get(ids[0])!, [], team(...ids))!.rotationSeconds;
    expect(seconds("Alhaitham", "Nahida", "Yae Miko", "Zhongli")).toBe(23.5); // KQM's 21-26s, midpoint
    expect(seconds("Alhaitham", "Nilou", "Xingqiu", "Yaoyao")).toBe(27);
    expect(seconds("Alhaitham", "Kuki Shinobu", "Furina", "Nahida")).toBe(30);
    expect(seconds("Flins", "Aino", "Ineffa", "Sucrose")).toBe(16);
    expect(seconds("Flins", "Fischl", "Columbina", "Sucrose")).toBe(17.5);
    expect(seconds("Arlecchino", "Kachina", "Bennett", "Chiori")).toBe(20);
    expect(seconds("Arlecchino", "Bennett", "Furina", "Xilonen")).toBe(15); // no default stated: Burst cooldown
    expect(seconds("Hu Tao", "Xingqiu", "Yelan", "Zhongli")).toBe(15); // unsourced: Burst cooldown
    // Klee (#250): Furina teams ~18s, Chevreuse Overload 17s even with Furina, else her Burst cooldown.
    expect(seconds("Klee", "Furina", "Xilonen", "Albedo")).toBe(18);
    expect(seconds("Klee", "Chevreuse", "Furina", "Fischl")).toBe(17);
    expect(seconds("Klee", "Bennett", "Xingqiu", "Fischl")).toBe(15);
  });

  test("Hu Tao's passive 2 needs no teammate healing her; Furina in Ousia doesn't (#2)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const dps = (...ids: string[]) => carryDamage(byId.get("Hu Tao")!, ["vaporize"], team("Hu Tao", ...ids))!.perSecond;
    const shield = dps("Xingqiu", "Yelan", "Zhongli");
    expect(dps("Xingqiu", "Yelan", "Bennett")).toBeLessThan(shield * 0.9); // +33% Pyro DMG off
    expect(dps("Xingqiu", "Furina", "Zhongli")).toBeCloseTo(dps("Xingqiu", "Yelan", "Zhongli"), 0);
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

    test("combos by set and by a teammate's constellation (#119): Cyno and Keqing on 4pc TF, Yanfei", () => {
      // Cyno's benchmark wears 4pc Thundering Fury: KQM's TF combo. Keqing's has no 4pc set: her default, until a build
      // wears TF.
      expect(comboOf(["Cyno", "Nahida", "Yelan", "Kuki Shinobu"], ["aggravate"])).toBe("E Q E 6[N4E]");
      const keqing = ["Keqing", "Fischl", "Nahida", "Kaedehara Kazuha"];
      expect(comboOf(keqing, ["aggravate"])).toBe("EQE 5[N1C]");
      const tf = { ...byId.get("Keqing")!, sets: [{ set: "Thundering Fury", pieces: 4 as const }] };
      expect(carryDamage(tf, ["aggravate"], [tf, ...team(...keqing.slice(1))])!.combo).toBe("EQE N1C N1 E 3[N1C]");
      // Yanfei: Xianyun with Furina as the only Hydro member; 4[N2C] beside C6 Xingqiu; 5[N2C] in Overloaded teams.
      expect(comboOf(["Yanfei", "Xianyun", "Furina", "Bennett"], ["vaporize"])).toBe("E 8[JhPD], with Xianyun");
      const xq = (constellation: number) => [byId.get("Yanfei")!, { ...byId.get("Xingqiu")!, constellation }, ...team("Bennett", "Kaedehara Kazuha")];
      expect(carryDamage(byId.get("Yanfei")!, ["vaporize"], xq(6))!.combo).toBe("N1 Q N1C N1 E C 4[N2C]");
      expect(carryDamage(byId.get("Yanfei")!, ["vaporize"], xq(5))!.combo).toBe("N1 Q N1C N1 E C 3[N3C]");
      expect(comboOf(["Yanfei", "Fischl", "Chevreuse", "Bennett"], ["overloaded"])).toBe("N1 Q N1C N1 E C 5[N2C]");
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

  test("Clorinde's passive 2 is up on every hit: 2 stacks of +10% CRIT Rate (#125)", () => {
    const clorinde = (kit.carries as Record<string, { buffs: { kind: string; value?: number; labels?: string[] }[] }>).Clorinde;
    const crit = clorinde.buffs.find((b) => b.kind === "critRate")!;
    expect(crit.value).toBeCloseTo(0.2, 6);
    expect(crit.labels).toEqual(["Swift Hunt DMG", "Impale the Night DMG", "Surging Blade DMG", "Skill DMG"]);
  });

  test("Wriothesley's Radiance turns his 3rd and 5th hits and Luster into Stellar-Conduct DMG (#123)", () => {
    type Hit = { label: string; scaling: { atk: number }; reacting?: number };
    const wrio = (kit.carries as unknown as Record<string, { hits: Hit[]; combos: { combo: string; hits: Hit[]; buffs: { kind: string; labels?: string[] }[] }[] }>).Wriothesley;
    const stellar = wrio.combos.find((k) => k.combo === "E 3[N5CD] N2")!;
    const hit = (hits: Hit[], label: string) => hits.find((h) => h.label === label)!;
    // 60% and 80% of the 3rd and 5th hits, 100% of the Charged Attack; they don't apply Cryo, so none react.
    expect(hit(stellar.hits, "3-Hit Stellar-Conduct DMG").scaling.atk).toBeCloseTo(hit(wrio.hits, "3-Hit DMG").scaling.atk * 0.6, 5);
    expect(hit(stellar.hits, "Luster: Vaulting Fist DMG").scaling.atk).toBeCloseTo(hit(wrio.hits, "Charged Attack DMG").scaling.atk, 5);
    for (const l of ["3-Hit Stellar-Conduct DMG", "5-Hit Stellar-Conduct DMG", "Luster: Vaulting Fist DMG"]) expect(hit(stellar.hits, l).reacting).toBe(0);
    // His +30% Stellar-Conduct DMG reaches only those hits.
    expect(stellar.buffs.find((b) => b.kind === "dmgBonus")!.labels).toHaveLength(3);
  });

  test("the Polestar Field gives an on-field Cryo or Electro carry +40% DMG Bonus with Stellar-Conduct (#327)", () => {
    const team = ["Wriothesley", "Odette", "Fischl", "Furina"].map((id) => byId.get(id)!);
    const bonus = (c: string, active: Reaction[]) => teamBuffStats(byId.get(c)!, active, team).dmgBonus;
    expect(bonus("Wriothesley", ["stellar-conduct"]) - bonus("Wriothesley", ["superconduct"])).toBeCloseTo(0.4, 6);
    expect(bonus("Furina", ["stellar-conduct"])).toBeCloseTo(bonus("Furina", ["superconduct"]), 6); // Hydro: no bonus
  });

  describe("direct Lunar reaction DMG (#135)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    // `sets`, `weapon`: the build's (default none; a carry without a build wears and holds their guide's, #206).
    const dps = (
      ids: string[],
      active: Reaction[],
      stats?: Partial<NonNullable<ScoringCharacter["stats"]>>,
      sets?: ScoringCharacter["sets"],
      weapon?: ScoringCharacter["weaponBuild"],
    ) => {
      const c = byId.get(ids[0])!;
      const built = stats ? { ...c, sets, weaponBuild: weapon, stats: { atk: 2200, baseAtk: 950, hp: 16000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 120, elementalMastery: 100, elementalDmgBonus: 0, ...stats } } : c;
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
      // Flins' extra hit also needs thunderclouds: a Lunar-Charged reaction (a build without his guide's Night of the
      // Sky's Unveiling, whose CRIT Rate also needs a Lunar reaction, #206).
      expect(dps(flinsGleam, ["lunar-charged"], {})).toBeGreaterThan(dps(flinsGleam, [], {}));
      expect(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], ["lunar-charged"], {})).toBe(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], [], {}));
    });

    test("Flins' passive 2 EM counts for an imported build too (#149)", () => {
      // A build with the benchmark's own stats (ATK 2200, EM 100, 60% DMG bonus), set and weapon (his guides' Night of the
      // Sky's Unveiling and Deathmatch, #206) deals what no build does: Enka's EM leaves the passive out, so it's added
      // either way.
      const ids = ["Flins", "Ineffa", "Xingqiu", "Bennett"];
      for (const active of [[], ["lunar-charged"]] as Reaction[][]) {
        const night = [{ set: "Night of the Sky's Unveiling", pieces: 4 as const }];
        // The benchmark wears a CRIT DMG circlet when its set's CRIT Rate is up (a Lunar reaction, #279): 60 - 31.1 CRIT
        // Rate, 120 + 62.2 CRIT DMG.
        const crit = active.length ? { critRate: 28.9, critDmg: 182.2 } : {};
        expect(dps(ids, active, { elementalDmgBonus: 60, ...crit }, night, benchWeapon("Flins"))).toBeCloseTo(dps(ids, active), 6);
      }
    });

    test("Flins' passive 1 adds 20% Reaction Bonus to his Lunar-Charged hits at Ascendant Gleam (#147)", () => {
      // With Ineffa (Moonsign) but no Lunar-Charged reaction the thundercloud hit can't land: only passive 1 differs.
      expect(dps(["Flins", "Ineffa", "Xingqiu", "Bennett"], [])).toBeGreaterThan(dps(["Flins", "Xingqiu", "Bennett", "Zhongli"], []));
    });

    test("Nefer's Veil of Falsehood needs Lunar-Bloom and Ascendant Gleam (#148)", () => {
      // Lauma (Moonsign) gives Ascendant Gleam, Nahida doesn't: 3 stacks = +24% Phantasm Performance and +100 EM. Both
      // without their guide sets (SMS, Deepwood: #338), so only Veil differs. A Nefer of her own: carryDamage caches by
      // member ids, and other tests read her with the benchmark Lauma and Nahida.
      const nefer = { ...byId.get("Nefer")! };
      const veil = (mate: string, active: Reaction[]) => {
        const t = [nefer, { ...byId.get(mate)!, sets: [] }, byId.get("Xingqiu")!, byId.get("Zhongli")!];
        return carryDamage(t[0], active, t)!.perSecond;
      };
      expect(veil("Lauma", ["lunar-bloom"])).toBeGreaterThan(veil("Nahida", ["lunar-bloom"]) * 1.2);
      expect(veil("Lauma", [])).toBe(veil("Nahida", []));
    });

    test("Zibai's passive 1 is a Reaction Additive Base DMG Bonus, added after the Lunar coefficient (#146)", () => {
      const zibai = carries.Zibai as unknown as { hits: { label: string; lunar?: string; additive?: boolean }[] };
      expect(zibai.hits.find((h) => h.label === "passive1 bonus")).toMatchObject({ lunar: "lunar-crystallize", additive: true });
    });

    test("Illuga's Nightingale's Song adds to Zibai's Lunar-Crystallize hits, on 21 of her 26 hits (#186)", () => {
      const team = ["Zibai", "Illuga", "Linnea", "Columbina"].map((id) => byId.get(id)!);
      const active: Reaction[] = ["crystallize", "lunar-crystallize"];
      const tb = teamBuffStats(team[0], active, team);
      // EM (benchmark 800 + 120 from his own 4pc Silken Moon's Serenade at Ascendant Gleam, #338) x (384.06% Burst +
      // 160% passive 2 at 3+ Hydro/Geo members) x 21 stacks / 26 Geo hits.
      expect(tb.lunarAdditive?.["lunar-crystallize"]).toBeCloseTo((920 * 5.44064 * 21) / 26, 3);
      const zibai = (buffs: typeof tb) => carryDamage(team[0], active, team, buffs)!.perSecond;
      expect(zibai(tb)).toBeGreaterThan(zibai({ ...tb, lunarAdditive: undefined }) * 1.1);
      // Only Zibai's direct Lunar hits: a team without Illuga has none.
      const zhongli = ["Zibai", "Zhongli", "Linnea", "Columbina"].map((id) => byId.get(id)!);
      expect(teamBuffStats(zhongli[0], active, zhongli).lunarAdditive).toBeUndefined();
    });

    test("Xianyun's flat Plunge DMG reaches Xiao's plunge shockwaves only, not his Skill hits (#299)", () => {
      const team = ["Xiao", "Xianyun", "Faruzan", "Furina"].map((id) => byId.get(id)!);
      const tb = teamBuffStats(team[0], [], team);
      const plunge = tb.byHit?.plunge?.flat ?? 0;
      expect(tb.flat).toBe(0);
      expect(plunge).toBeGreaterThan(0);
      const xiao = (buffs: typeof tb) => carryDamage(team[0], [], team, buffs)!.perSecond;
      // Before #299 the same flat DMG went on every hit: his 2 Skill hits got it too.
      const everyHit = { ...tb, flat: plunge, byHit: undefined };
      expect(xiao(tb)).toBeLessThan(xiao(everyHit));
      expect(xiao(tb)).toBeGreaterThan(xiao({ ...tb, byHit: undefined }));
    });

    test("Sethos's Dusk Bolts: Charged Attack DMG, 18 a rotation, each with his Burst's EM part (#232)", () => {
      const sethos = carries.Sethos as unknown as { hits: { label: string; type: string; count: number; instances?: number; addOn?: boolean; scaling: Record<string, number> }[] };
      const bolts = sethos.hits.filter((h) => h.label !== "Skill DMG" && !h.addOn);
      expect(bolts.every((h) => h.type === "charged")).toBe(true);
      expect(bolts.reduce((a, h) => a + h.count * (h.instances ?? 1), 0)).toBe(18);
      expect(sethos.hits.find((h) => h.addOn)).toMatchObject({ count: 18, type: "charged", scaling: { em: expect.any(Number) } });
      const team = ["Sethos", "Fischl", "Nahida", "Zhongli"].map((id) => byId.get(id)!);
      expect(carryDamage(team[0], ["aggravate"], team)!.rotationSeconds).toBe(15);
    });

    test("modelsAscendantGleam: carries whose own Ascendant Gleam upgrade is in their damage (#150)", () => {
      for (const id of ["Zibai", "Flins", "Nefer"]) expect(modelsAscendantGleam(id), id).toBe(true);
      expect(modelsAscendantGleam("Neuvillette")).toBe(false);
      expect(modelsAscendantGleam("Bennett")).toBe(false);
    });

    test("modelsReaction: a reaction the carry's combos, hits or buffs need is in their damage (#200, #205)", () => {
      const models = (id: string, r: Reaction) => modelsReaction(byId.get(id)!, r);
      expect(models("Nefer", "lunar-bloom")).toBe(true); // Phantasm Performance needs Verdant Dew
      expect(models("Flins", "lunar-charged")).toBe(true); // Thunderous Symphony Additional DMG needs thunderclouds
      // Zibai's Lunar hits land with any team, but 2 of her 4 Strides need the team's Lunar-Crystallize (#248).
      expect(models("Zibai", "lunar-crystallize")).toBe(true);
      // Any reaction a combo, hit or buff needs (#205): Navia's shards, Freminet's and Wriothesley's combos.
      expect(models("Navia", "crystallize")).toBe(true);
      expect(models("Freminet", "superconduct")).toBe(true);
      expect(models("Wriothesley", "stellar-conduct")).toBe(true);
      expect(models("Shikanoin Heizou", "swirl")).toBe(true);
      expect(models("Navia", "swirl")).toBe(false);
    });

    test("Klee's Boom-Boom Strikes and Boom Badges need Secret Rite (#241)", () => {
      // Fischl (Hexerei) gives Secret Rite, Zhongli doesn't: 5 Strikes at 150% of 1.5x a Charged Attack, ~+65%.
      const rite = dps(["Klee", "Fischl", "Bennett", "Xingqiu"], []);
      const none = dps(["Klee", "Zhongli", "Bennett", "Xingqiu"], []);
      expect(rite / none).toBeGreaterThan(1.5);
      expect(rite / none).toBeLessThan(1.8);
      expect(modelsSecretRite("Klee")).toBe(true);
      expect(modelsSecretRite("Varka")).toBe(true); // his second Four Winds' Ascension (#233)
    });

    test("Varka: two claymores, his right one by PHEC priority; passive 1's 140%/220% by the party (#233)", () => {
      const v = (...ids: string[]) => carryDamage(byId.get("Varka")!, [], ids.map((id) => byId.get(id)!))!;
      // 2 Anemo members (Kazuha) against none besides him: his Sturm und Drang attacks deal 140%.
      const twoAnemo = v("Varka", "Kaedehara Kazuha", "Bennett", "Xingqiu").perSecond;
      const one = v("Varka", "Zhongli", "Bennett", "Xingqiu").perSecond;
      expect(twoAnemo / one).toBeGreaterThan(1.3);
      expect(twoAnemo / one).toBeLessThan(1.4);
      // 2 Anemo and 2 Pyro: 220%.
      expect(v("Varka", "Kaedehara Kazuha", "Bennett", "Xiangling").perSecond / one).toBeGreaterThan(1.9);
    });

    test("Lohen: E 2[N1C] E/Q 4[N1C] E 5[N1C] E at full Will to Win; Secret Rite's +40% on his attacks (#356)", () => {
      const lohen = kit.carries.Lohen;
      expect(lohen.combo).toBe("E 2[N1C] E/Q 4[N1C] E 5[N1C] E");
      // 100 Will to Win at 0.4% of his ATK per point, on each instance of Etched Into Bone and Soul and his Burst.
      const wtw = lohen.buffs.filter((b) => b.kind === "addPerStack").map((b) => ("stacks" in b ? b.value * b.stacks : 0));
      expect(wtw.map((v) => Math.round(v * 100) / 100)).toEqual([0.4, 0.4]);
      const ids = ["Lohen", "Durin", "Nicole", "Citlali"];
      const rite = carryDamage(byId.get("Lohen")!, ["melt"], team(...ids))!;
      const none = carryDamage(byId.get("Lohen")!, ["melt"], team(...ids).map((c) => (c.id === "Lohen" ? c : { ...c, families: [] })))!;
      expect(rite.perSecond).toBeGreaterThan(none.perSecond * 1.1);
      // Freeze: N1C strings only (KQM's low Will to Win combo, GameWith's Freeze team).
      expect(carryDamage(byId.get("Lohen")!, ["freeze"], team("Lohen", "Escoffier", "Furina", "Mona"))!.combo).toBe("E 16[N1C]");
    });

    test("Sandrone: 3[C E] (Q); in Radiance her beams, second Prism Shot (400%) and Ray (200%) are direct Stellar hits (#234)", () => {
      const comboOf = (ids: string[], active: Reaction[]) => carryDamage(byId.get(ids[0])!, active, team(...ids))!.combo;
      const ids = ["Sandrone", "Yae Miko", "Odette", "Escoffier"];
      expect(comboOf(ids, ["stellar-conduct"])).toBe("3[C E] (Q), Radiance: Stellar-Conduct");
      expect(comboOf(["Sandrone", "Odette", "Sucrose", "Traveler (Cryo)"], ["stellar-swirl"])).toBe("3[C E] (Q), Radiance: Stellar Swirl");
      expect(comboOf(["Sandrone", "Bennett", "Xingqiu", "Zhongli"], ["melt"])).toBe("3[C E] (Q)");
      const stellar = carryDamage(byId.get("Sandrone")!, ["stellar-conduct"], team(...ids))!;
      const plain = carryDamage(byId.get("Sandrone")!, [], team(...ids))!;
      expect(stellar.perSecond).toBeGreaterThan(plain.perSecond * 1.5);
    });
  });

  test("a build's stats change the damage", () => {
    const raiden = byId.get("Raiden Shogun")!;
    const built: ScoringCharacter = {
      ...raiden,
      // DMG bonus as the character screen shows it: 46.6% goblet + her passive 2 (0.4% per ER over 100%) at 250% ER.
      stats: { atk: 2600, baseAtk: 950, hp: 20000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 250, elementalMastery: 0, elementalDmgBonus: 106.6 },
      weaponBuild: benchWeapon("Raiden Shogun"), // the benchmark's own weapon (#206): only the stats differ
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

  // Carry batch 2 (#203): stacks that scale on HP, CRIT Rate for some hits only, a combo for Crystallize teams.
  test("Ayato's Namisen adds Max HP to each Shunsuiken hit: more HP alone raises his damage", () => {
    const ayato = byId.get("Kamisato Ayato")!;
    const stats = { atk: 1900, baseAtk: 900, hp: 20000, def: 800, critRate: 60, critDmg: 120, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 46.6 };
    const more: ScoringCharacter = { ...ayato, stats: { ...stats, hp: 30000 } };
    expect(carryDamage(more)!.perSecond).toBeGreaterThan(carryDamage({ ...ayato, stats })!.perSecond);
  });

  test("Ganyu's passive 1 crit only reaches her Frostflake Arrows, and is lost past 100% CRIT Rate", () => {
    const ganyu = byId.get("Ganyu")!;
    const stats = { atk: 2200, baseAtk: 950, hp: 15000, def: 700, critDmg: 200, energyRecharge: 110, elementalMastery: 0, elementalDmgBonus: 46.6 };
    const at = (critRate: number) => carryDamage({ ...ganyu, stats: { ...stats, critRate } })!.perSecond;
    // From 90% to 100%, her arrows (already at 100% with the passive) gain nothing; only her Skill hits do.
    expect(at(100) / at(90)).toBeGreaterThan(1);
    expect(at(100) / at(90)).toBeLessThan(3 / 2.8);
  });

  test("Ganyu plays KQM's Melt rotation in Melt teams, and it Melts (#228)", () => {
    const ganyu = byId.get("Ganyu")!;
    expect(carryDamage(ganyu, ["melt"])!.combo).toBe("E Q 4[C]");
    expect(carryDamage(ganyu, ["freeze"])!.combo).toBe("E C EQ 4[C]");
    // Reverse Melt (x1.5) on her arrows outweighs the Freeze rotation's extra arrow and Skill, at the same build: no set
    // (without one she'd wear Blizzard Strayer in Freeze, #279).
    const noSet = { ...ganyu, sets: [] };
    expect(carryDamage(noSet, ["melt"])!.perSecond).toBeGreaterThan(carryDamage(noSet, ["freeze"])!.perSecond);
  });

  // #222: hits of their own damage type.
  test("Eula's Physical hits take Physical DMG Bonus, her Cryo hits Cryo DMG Bonus", () => {
    const eula = byId.get("Eula")!;
    const stats = { atk: 2400, baseAtk: 950, hp: 15000, def: 1000, critRate: 60, critDmg: 140, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 0 };
    const at = (extra: object) => carryDamage({ ...eula, stats: { ...stats, ...extra } })!.perSecond;
    const physical = at({ physicalDmgBonus: 58.3 }) - at({});
    const cryo = at({ elementalDmgBonus: 46.6 }) - at({});
    expect(cryo).toBeGreaterThan(0);
    expect(physical).toBeGreaterThan(cryo * 2); // Lightfall Sword and her Normal Attacks are most of her damage
  });

  test("a buff for the carry's element skips hits of another type (#222)", () => {
    const eula = byId.get("Eula")!;
    // Flat DMG read for her element (Cryo) reaches her 5 Cryo hit instances only (Press, Burst cast, Hold, 2 Icewhirl
    // Brands); her Physical hits read their own team buffs, none here. Benchmark: no Cryo DMG Bonus (Physical goblet).
    // The 2 Icewhirl Brands land under her own 24% Cryo RES shred (#204). Her benchmark weapon, Serpent Spine (#206), adds
    // 30% DMG (5 stacks of 6%) to every hit.
    const gain = carryDamage(eula, [], [eula], { ...NO_TEAM_BUFFS, flat: 1000 })!.perSecond - carryDamage(eula, [], [eula])!.perSecond;
    expect(gain).toBeCloseTo((1000 * (3 + 2 * (1 + resShredGain(0.24))) * 1.3 * expectedCrit(eula)) / 20, 6);
  });

  // #233: hits that take teammates' elements, counted by the team.
  test("Chasca's Shining Shells grow with her Pyro, Hydro, Cryo and Electro teammates", () => {
    const dps = (...ids: string[]) => {
      const team = ["Chasca", ...ids].map((id) => byId.get(id)!);
      return carryDamage(team[0], [], team)!.perSecond;
    };
    const none = dps("Zhongli", "Nahida", "Chiori"); // no conversion: 28 Anemo Shells
    const one = dps("Bennett", "Zhongli", "Nahida"); // 1 Pyro teammate
    const three = dps("Bennett", "Xingqiu", "Fischl"); // 3 teammates of 3 types
    expect(one).toBeGreaterThan(none);
    expect(three).toBeGreaterThan(one);
    // Two Pyro teammates convert as many Shells as two of different types, but one type: fewer for passive 1.
    expect(dps("Bennett", "Xingqiu", "Zhongli")).toBeGreaterThan(dps("Bennett", "Xiangling", "Zhongli"));
  });

  test("Freminet plays his Physical combo in Superconduct teams, with a Physical goblet (#231)", () => {
    const freminet = byId.get("Freminet")!;
    expect(carryDamage(freminet, ["freeze"])!.combo).toBe("EQE 4[2E N1] 2E");
    expect(carryDamage(freminet, ["superconduct"])!.combo).toBe("EQ N2E 3[EN2E N1]");
    // An import's Physical DMG Bonus reaches the Physical combo's Level 4 Shattering Pressures and Normal Attacks.
    const stats = { atk: 2000, baseAtk: 850, hp: 15000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 130, elementalMastery: 0, elementalDmgBonus: 0 };
    const at = (physicalDmgBonus: number) => carryDamage({ ...freminet, stats: { ...stats, physicalDmgBonus } }, ["superconduct"])!.perSecond;
    expect(at(58.3)).toBeGreaterThan(at(0) * 1.3);
  });

  test("Superconduct's 40% Physical RES shred reaches Eula's Physical hits (#204)", () => {
    const eula = byId.get("Eula")!;
    const physicalShare = carryDamage(eula, ["superconduct"])!.perSecond / carryDamage(eula, [])!.perSecond;
    expect(physicalShare).toBeGreaterThan(1.1); // ~2/3 of her damage is Physical: x1.18
    expect(physicalShare).toBeLessThan(1 + resShredGain(0.4)); // her Cryo hits don't get it
  });

  test("Navia's Shardshots hit harder with Crystallize (Crystal Shrapnel)", () => {
    const navia = byId.get("Navia")!;
    expect(carryDamage(navia, ["crystallize"])!.perSecond).toBeGreaterThan(carryDamage(navia, [])!.perSecond * 1.2);
  });

  // Carry batch 3 (#203): DMG from EM on hits counted elsewhere, ATK from DEF.
  test("Cyno's passive 2 DMG from EM adds no Aggravate of its own", () => {
    const cyno = byId.get("Cyno")!;
    const kitHits = (kit as unknown as { carries: Record<string, { hits: { addOn?: boolean; count: number; instances?: number }[] }> }).carries.Cyno.hits;
    const instances = (h: { count: number; instances?: number }) => h.count * (h.instances ?? 1);
    // Aggravate's flat DMG lands on his own hits only: 29 Burst Normal Attack instances, 9 bolts, 5 Skills.
    expect(kitHits.filter((h) => !h.addOn).reduce((a, h) => a + instances(h), 0)).toBe(43);
    expect(carryDamage(cyno, ["aggravate"])!.perSecond).toBeGreaterThan(carryDamage(cyno, [])!.perSecond);
  });

  test("Kinich's Hunter's Experience: 3.2x ATK on a Cannon per party Nightsoul Burst, more with more Natlanese (#288)", () => {
    const team = (...ids: string[]) => ids.map((id) => byId.get(id)!);
    const kinich = byId.get("Kinich")!;
    const dps = (...ids: string[]) => carryDamage(kinich, ["burning"], team("Kinich", ...ids))!.perSecond;
    const one = dps("Emilie", "Xiangling", "Bennett"); // every 18s: 1 stack per 18s rotation
    const two = dps("Mavuika", "Emilie", "Bennett"); // every 12s: 1.5
    const three = dps("Xilonen", "Citlali", "Bennett"); // every 9s: 2 (Xilonen, Citlali don't change his own hits)
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    // The extra 0.5 stack per rotation is 0.5 x 3.2 = 1.6 ATK of Cannon-type damage: under one Cannon (11.7 ATK).
    const hunter = (kit as unknown as { carries: { Kinich: { hits: { label: string; scaling: { atk: number }; nightsoulBursts?: string }[] } } }).carries.Kinich.hits.find((h) => h.nightsoulBursts)!;
    expect(hunter.scaling.atk).toBe(3.2);
    expect(two / one - 1).toBeLessThan(0.1);
  });

  test("Noelle's Burst turns DEF into ATK: more DEF alone raises her damage", () => {
    const noelle = byId.get("Noelle")!;
    const stats = { atk: 1500, baseAtk: 750, hp: 15000, def: 2000, critRate: 60, critDmg: 120, energyRecharge: 140, elementalMastery: 0, elementalDmgBonus: 46.6 };
    expect(carryDamage({ ...noelle, stats: { ...stats, def: 2600 } })!.perSecond).toBeGreaterThan(carryDamage({ ...noelle, stats })!.perSecond);
  });

  test("Mualani's Surging Bites scale on Max HP", () => {
    const mualani = byId.get("Mualani")!;
    const stats = { atk: 1100, baseAtk: 650, hp: 35000, def: 700, critRate: 60, critDmg: 120, energyRecharge: 110, elementalMastery: 100, elementalDmgBonus: 46.6 };
    const at = (hp: number) => carryDamage({ ...mualani, stats: { ...stats, hp } })!.perSecond;
    expect(at(42000) / at(35000)).toBeCloseTo(1.2, 2); // every hit scales on HP alone
  });

  // Carry batch 4 (#203): a hit that needs a reaction, a combo for Melt.
  test("Heizou's Windmuster Iris lands only with an element to Swirl", () => {
    const heizou = byId.get("Shikanoin Heizou")!;
    expect(carryDamage(heizou, ["swirl"])!.perSecond).toBeGreaterThan(carryDamage(heizou, [])!.perSecond);
  });

  test("Gaming plays fewer Skill plunges in Melt teams (KQM)", () => {
    const gaming = byId.get("Gaming")!;
    expect(carryDamage(gaming, ["melt"])!.combo).toBe("Q 5.5[EP]");
    expect(carryDamage(gaming, ["vaporize"])!.combo).toBe("Q 7[EP]");
  });

  // Carry batch 5 (#203): rows that already hold their hit count are one hit with that many instances.
  test("Keqing's Burst slashes are 8 instances of one row, each Aggravating", () => {
    const hits = (kit as unknown as { carries: Record<string, { hits: { label: string; count: number; instances?: number; scaling: { atk: number } }[] }> }).carries.Keqing.hits;
    const slash = hits.find((h) => h.label === "Consecutive Slash DMG")!;
    expect([slash.count, slash.instances, slash.scaling.atk]).toEqual([1, 8, 3.264]); // 40.8% x 8
    const keqing = byId.get("Keqing")!;
    expect(carryDamage(keqing, ["aggravate"])!.perSecond).toBeGreaterThan(carryDamage(keqing, [])!.perSecond);
  });

  test("Diluc's combo Vaporizes inside Dawn's infusion", () => {
    const diluc = byId.get("Diluc")!;
    expect(carryDamage(diluc, ["vaporize"])!.perSecond).toBeGreaterThan(carryDamage(diluc, [])!.perSecond * 1.3);
  });
});

for (const [id, c] of Object.entries(carries)) {
  for (const m of c.missing ?? []) test.todo(`kit-overrides hitRates: ${id} ${m}`);
}

describe("weapon passives on the holder's hits (#40)", () => {
  const get = (id: string) => byId.get(id)!;
  const holding = (id: string, weapon: string, refinement = 1): ScoringCharacter => ({ ...get(id), weaponBuild: { id: weapon, level: 90, refinement } });
  const bonus = (c: ScoringCharacter, team: ScoringCharacter[], type: "normal" | "charged" | "skill" | "burst") => weaponDmgBonus(weaponBuffs(c, [c, ...team]), type);

  test("Watatsumi weapons: Burst DMG per point of the party's max Energy, capped, by refinement", () => {
    const team = ["Bennett", "Xingqiu", "Xiangling"].map(get);
    const energy = [holding("Raiden Shogun", "Wavebreaker's Fin"), ...team].reduce((a, m) => a + m.burstCost!, 0);
    expect(bonus(holding("Raiden Shogun", "Wavebreaker's Fin"), team, "burst")).toBeCloseTo(Math.min(0.4, 0.0012 * energy));
    expect(bonus(holding("Raiden Shogun", "Wavebreaker's Fin", 5), team, "burst")).toBeCloseTo(Math.min(0.8, 0.0024 * energy));
    expect(bonus(holding("Raiden Shogun", "Wavebreaker's Fin"), team, "skill")).toBe(0);
  });

  test("Mountain-Bracing Bolt's second 12% needs a teammate who uses their Skill", () => {
    expect(weaponDmgBonus(weaponBuffs(holding("Kachina", "Mountain-Bracing Bolt"), []), "skill")).toBeCloseTo(0.12);
    expect(bonus(holding("Kachina", "Mountain-Bracing Bolt"), [get("Bennett")], "skill")).toBeCloseTo(0.24);
  });

  test("Uraku Misugiri doubles with a Geo member", () => {
    const chiori = holding("Chiori", "Uraku Misugiri");
    expect(bonus(chiori, [get("Furina")], "skill")).toBeCloseTo(0.48); // Chiori is Geo herself
    const ayaka = holding("Kamisato Ayaka", "Uraku Misugiri");
    expect(bonus(ayaka, [get("Shenhe")], "normal")).toBeCloseTo(0.16);
    expect(bonus(ayaka, [get("Zhongli")], "normal")).toBeCloseTo(0.32);
  });

  test("Splendor of Tranquil Waters needs the party's HP to change (a healer)", () => {
    const furina = holding("Furina", "Splendor of Tranquil Waters");
    expect(weaponBuffs(furina, [furina, get("Xingqiu")]).length).toBeGreaterThan(0); // Furina heals
    const kazuha = holding("Kaedehara Kazuha", "Splendor of Tranquil Waters");
    expect(weaponBuffs(kazuha, [kazuha, get("Xingqiu")])).toEqual([]);
    expect(bonus(kazuha, [get("Bennett")], "skill")).toBeCloseTo(0.24); // 8% x 3 stacks
  });

  test("more passives on the holder's own damage (#206): Bond of Life, auras, HP drain, every hit", () => {
    expect(bonus(holding("Arlecchino", "Crimson Moon's Semblance"), [], "normal")).toBeCloseTo(0.36); // 12% + 24%
    expect(bonus(holding("Raiden Shogun", "Crimson Moon's Semblance"), [], "normal")).toBe(0); // no Bond of Life
    expect(bonus(holding("Raiden Shogun", "Dragon's Bane"), [get("Xingqiu")], "burst")).toBeCloseTo(0.2);
    expect(bonus(holding("Raiden Shogun", "Dragon's Bane"), [get("Kujou Sara")], "burst")).toBe(0);
    expect(bonus(holding("Neuvillette", "Tome of the Eternal Flow"), [], "charged")).toBeCloseTo(0.42); // his HP drain
    expect(bonus(holding("Raiden Shogun", '"The Catch"', 5), [], "burst")).toBeCloseTo(0.32);
    // Against a weapon whose passive does nothing in damage (Favonius Lance).
    const sands = holding("Raiden Shogun", "Staff of the Scarlet Sands");
    expect(carryDamage(sands)!.perSecond).toBeGreaterThan(carryDamage(holding("Raiden Shogun", "Favonius Lance"))!.perSecond);
  });

  test("Zibai Premium's weapons (#306): Harbinger with a healer or shielder, Snare Hook by reaction and Moonsign", () => {
    const sum = (c: ScoringCharacter, team: ScoringCharacter[], active: Reaction[], kind: string) =>
      weaponBuffs(c, [c, ...team], active).reduce((a, b) => a + (b.kind === kind ? b.value : 0), 0);
    const zibai = holding("Zibai", "Harbinger of Dawn", 5);
    expect(sum(zibai, [get("Linnea")], [], "critRate")).toBeCloseTo(0.28);
    expect(sum(zibai, [get("Illuga")], [], "critRate")).toBe(0);
    expect(sum(zibai, [get("Linnea"), get("Furina")], [], "critRate")).toBe(0); // Furina drains HP
    const linnea = holding("Linnea", "Snare Hook");
    expect(sum(linnea, [get("Zibai")], ["lunar-crystallize"], "em")).toBe(120); // Ascendant Gleam
    expect(sum(linnea, [get("Bennett")], ["lunar-crystallize"], "em")).toBe(60);
    expect(sum(linnea, [get("Zibai")], [], "em")).toBe(0);
    expect(sum(holding("Columbina", "The Widsith", 4), [], [], "em")).toBeCloseTo(420 / 9); // 1 of 3 songs, 10s of 30s
  });

  test("a benchmark carry holds their guide's weapon, a benchmark support none; a build's weapon raises its hits (#206)", () => {
    // Raiden's KQM pick, R5 "The Catch": 16% x 2 Burst DMG at R5 (its Burst CRIT Rate is left out).
    expect(weaponBuffs(get("Raiden Shogun"), [get("Raiden Shogun")])).toEqual([{ kind: "dmgBonus", types: ["burst"], value: 0.32 }]);
    expect(weaponBuffs(get("Bennett"), [get("Bennett")])).toEqual([]);
    // A build holds its own weapon, not the benchmark's.
    expect(weaponBuffs(holding("Raiden Shogun", "Favonius Lance"), [get("Raiden Shogun")])).toEqual([]);
    const team = ["Bennett", "Xingqiu", "Xiangling"].map(get);
    const raiden = holding("Raiden Shogun", "Favonius Lance");
    const fin = holding("Raiden Shogun", "Wavebreaker's Fin");
    expect(carryDamage(fin, [], [fin, ...team])!.perSecond).toBeGreaterThan(carryDamage(raiden, [], [raiden, ...team])!.perSecond);
  });
});

describe("set bonuses on the wearer's own damage (#206)", () => {
  const get = (id: string) => byId.get(id)!;
  const team = (...ids: string[]) => ids.map(get);
  const STATS = { atk: 2200, baseAtk: 950, hp: 16000, def: 900, critRate: 60, critDmg: 120, energyRecharge: 120, elementalMastery: 100, elementalDmgBonus: 60 };
  const wearing = (id: string, set: string, pieces: 2 | 4 = 4): ScoringCharacter => ({ ...get(id), stats: STATS, sets: [{ set, pieces }] });
  const value = (c: ScoringCharacter, mates: string[], active: Reaction[], kind: string) =>
    setBuffs(c, active, [c, ...team(...mates)]).filter((b) => b.kind === kind).reduce((a, b) => a + b.value, 0);

  test("a benchmark carry wears their guide's set, by team where the guide says so", () => {
    expect(setsOf(get("Neuvillette"), [])).toEqual([{ set: "Marechaussee Hunter", pieces: 4 }]);
    expect(setsOf(get("Skirk"), [], team("Skirk", "Furina"))).toEqual([{ set: "Marechaussee Hunter", pieces: 4 }]);
    expect(setsOf(get("Skirk"), [], team("Skirk", "Escoffier"))).toEqual([{ set: "Finale of the Deep Galleries", pieces: 4 }]);
    expect(setsOf(get("Kamisato Ayaka"), [], team("Kamisato Ayaka", "Shenhe"))).toEqual([]);
    expect(setsOf(wearing("Neuvillette", "Gilded Dreams"), [])).toEqual([{ set: "Gilded Dreams", pieces: 4 }]);
  });

  test("the supports whose buffs come from their set wear their guide's (#352)", () => {
    const of = (id: string, ...mates: string[]) => setsOf(get(id), [], team(id, ...mates))[0]?.set;
    expect(of("Venti", "Mavuika", "Bennett", "Furina")).toBe("Viridescent Venerer");
    expect(of("Venti", "Wanderer", "Bennett", "Furina")).toBe("Scroll of the Hero of Cinder City"); // an on-field Anemo DPS
    expect(of("Lan Yan", "Xiao", "Furina", "Bennett")).toBe("Scroll of the Hero of Cinder City");
    expect(of("Kachina", "Mualani", "Furina", "Bennett")).toBe("Scroll of the Hero of Cinder City");
    expect(of("Xinyan", "Eula", "Bennett", "Furina")).toBe("Tenacity of the Millelith");
    // One wearer per party set (#348): with Kazuha on VV, Jean takes Noblesse; with Bennett on Noblesse too, Clam.
    expect(of("Jean", "Kaedehara Kazuha", "Furina", "Xiao")).toBe("Noblesse Oblige");
    expect(of("Jean", "Kaedehara Kazuha", "Bennett", "Xiao")).toBe("Ocean-Hued Clam");
    expect(of("Candace", "Kachina", "Furina", "Bennett")).toBe("Silken Moon's Serenade"); // Scroll and Noblesse taken
  });

  test("Marechaussee's CRIT Rate needs the wearer's HP to change: HP drain or a healer", () => {
    expect(value(get("Neuvillette"), ["Kaedehara Kazuha"], [], "critRate")).toBeCloseTo(0.36); // his own drain
    expect(value(wearing("Kamisato Ayaka", "Marechaussee Hunter"), ["Shenhe"], [], "critRate")).toBe(0);
    expect(value(wearing("Kamisato Ayaka", "Marechaussee Hunter"), ["Furina"], [], "critRate")).toBeCloseTo(0.36);
  });

  test("2pc bonuses the character screen doesn't show count for imports only", () => {
    expect(value(wearing("Neuvillette", "Marechaussee Hunter", 2), ["Furina"], [], "dmgBonus")).toBeCloseTo(0.15);
    expect(value(get("Neuvillette"), ["Furina"], [], "dmgBonus")).toBe(0); // the benchmark's generic DMG bonus has it
    expect(value(wearing("Neuvillette", "Marechaussee Hunter", 2), ["Furina"], [], "critRate")).toBe(0); // no 4pc
  });

  test("Gilded Dreams counts the other members' elements, once the wearer reacts", () => {
    const mates = ["Nahida", "Fischl", "Kuki Shinobu"];
    expect(value(get("Alhaitham"), mates, ["spread"], "atkPctPerSame")).toBeCloseTo(0.14); // Nahida
    expect(value(get("Alhaitham"), mates, ["spread"], "emPerOther")).toBe(100);
    expect(value(get("Alhaitham"), mates, [], "emPerOther")).toBe(0);
  });

  test("Night of the Sky's Unveiling: 15% CRIT Rate at Nascent Gleam, 30% at Ascendant, with a Lunar reaction", () => {
    expect(value(get("Flins"), ["Xingqiu", "Bennett"], ["lunar-charged"], "critRate")).toBeCloseTo(0.15);
    expect(value(get("Flins"), ["Ineffa", "Bennett"], ["lunar-charged"], "critRate")).toBeCloseTo(0.15); // no gleam passed
    expect(setBuffs(get("Flins"), ["lunar-charged"], team("Flins", "Ineffa"), true).find((b) => b.kind === "critRate")!.value).toBeCloseTo(0.3);
    expect(value(get("Flins"), ["Ineffa", "Bennett"], [], "critRate")).toBe(0);
  });

  test("Crimson Witch: 1 stack and +15% Vaporize; Gaming's guide gives him 3 stacks", () => {
    expect(value(get("Hu Tao"), ["Xingqiu"], ["vaporize"], "dmgBonus")).toBeCloseTo(0.075);
    expect(value(get("Gaming"), ["Xingqiu"], ["vaporize"], "dmgBonus")).toBeCloseTo(0.225);
    const vape = (c: ScoringCharacter) => carryDamage(c, ["vaporize"], [c, get("Xingqiu")])!.perSecond / carryDamage(c, [], [c, get("Xingqiu")])!.perSecond;
    expect(vape(get("Hu Tao"))).toBeGreaterThan(vape({ ...get("Hu Tao"), stats: STATS, sets: [] }));
  });

  test("Gleaming Moon sets (#306): 10% per different effect, party-wide; Silken's EM by Moonsign level", () => {
    const silken = wearing("Illuga", "Silken Moon's Serenade");
    const night = wearing("Zibai", "Night of the Sky's Unveiling");
    const lc: Reaction[] = ["lunar-crystallize"];
    // Night's Intent needs its wearer on field and a Lunar reaction; Silken's Devotion doesn't.
    expect(partySetBuffs([night, silken, get("Columbina")], lc, night)).toEqual({ em: 120, lunar: 0.2, stellar: 0 });
    expect(partySetBuffs([night, silken, get("Columbina")], lc, silken).lunar).toBeCloseTo(0.1);
    expect(partySetBuffs([night, silken, get("Columbina")], [], night).lunar).toBeCloseTo(0.1);
    // A second Silken adds nothing ("Effects from Gleaming Moon cannot stack"); one Moonsign member: Nascent Gleam, 60.
    expect(partySetBuffs([silken, wearing("Columbina", "Silken Moon's Serenade")], lc, null)).toEqual({ em: 120, lunar: 0.1, stellar: 0 });
    expect(partySetBuffs([silken, get("Bennett")], lc, null)).toEqual({ em: 60, lunar: 0.1, stellar: 0 });
  });

  test("Aubade (#306): the wearer's own Lunar Reaction Bonus, off-field only, 60% at Ascendant Gleam", () => {
    const aubade = wearing("Columbina", "Aubade of Morningstar and Moon");
    const bonus = (onField: boolean, gleam: boolean) =>
      setBuffs(aubade, ["lunar-crystallize"], [aubade, get("Zibai")], gleam, onField).reduce((a, b) => a + b.value, 0);
    expect(bonus(false, true)).toBeCloseTo(0.6);
    expect(bonus(false, false)).toBeCloseTo(0.2);
    expect(bonus(true, true)).toBe(0);
  });

  test("a set's buff raises the carry's damage", () => {
    const raiden = { ...get("Raiden Shogun"), stats: STATS };
    const fate = { ...raiden, sets: [{ set: "Emblem of Severed Fate", pieces: 4 as const }] };
    expect(carryDamage(fate)!.perSecond).toBeGreaterThan(carryDamage({ ...raiden, sets: [] })!.perSecond);
  });
});

describe("support gear's party effects in damage (#206)", () => {
  const get = (id: string) => byId.get(id)!;
  const STATS = { atk: 2000, baseAtk: 800, hp: 30000, def: 900, critRate: 50, critDmg: 100, energyRecharge: 200, elementalMastery: 100, elementalDmgBonus: 0 };
  const geared = (id: string, gear: { set?: string; weapon?: string; refinement?: number }): ScoringCharacter => {
    const build = { weapon: { id: gear.weapon ?? "none", level: 90, refinement: gear.refinement ?? 1 }, artifactSets: gear.set ? [{ set: gear.set, pieces: 4 as const }] : [] };
    return { ...get(id), stats: STATS, sets: build.artifactSets, weaponBuild: gear.weapon ? build.weapon : undefined, effects: characterEffects(id, 0, build as never) };
  };
  // Without a build or their guide's set (#338): the teams to compare gear against.
  const bare = (id: string): ScoringCharacter => ({ ...get(id), sets: [] });
  const carryGets = (team: ScoringCharacter[], active: Reaction[] = []) => teamBuffStats(team[0], [], team, undefined, active);
  const memberGets = (m: ScoringCharacter, team: ScoringCharacter[], active: Reaction[] = []) => memberBuffStats(m, team[0], active, team);

  test("Noblesse's ATK reaches the carry and the other members; a benchmark Bennett wears it too (#338)", () => {
    const noblesse = [get("Hu Tao"), geared("Bennett", { set: "Noblesse Oblige" }), get("Xingqiu"), get("Zhongli")];
    const plain = [get("Hu Tao"), bare("Bennett"), get("Xingqiu"), get("Zhongli")];
    expect(carryGets(noblesse).atkPct - carryGets(plain).atkPct).toBeCloseTo(0.2, 5);
    expect(memberGets(noblesse[2], noblesse).atkPct - memberGets(plain[2], plain).atkPct).toBeCloseTo(0.2, 5);
    const benchmark = [get("Hu Tao"), get("Bennett"), get("Xingqiu"), get("Zhongli")];
    expect(carryGets(benchmark).atkPct).toBeCloseTo(carryGets(noblesse).atkPct, 5);
  });

  test("Millennial Movement ATK doesn't stack; Thrilling Tales is the carry's only", () => {
    const one = [get("Hu Tao"), geared("Sucrose", { weapon: "Elegy for the End" }), get("Xingqiu"), bare("Zhongli")]; // no Tenacity (#338)
    const two = [get("Hu Tao"), geared("Sucrose", { weapon: "Elegy for the End" }), get("Xingqiu"), geared("Zhongli", { weapon: "Song of Broken Pines" })];
    expect(carryGets(one).atkPct).toBeGreaterThan(carryGets([get("Hu Tao"), get("Sucrose"), get("Xingqiu"), bare("Zhongli")]).atkPct);
    expect(carryGets(two).atkPct).toBeCloseTo(carryGets(one).atkPct, 5);
    // 24% ATK at R1 for 10s of every 20s, for "the new character taking the field": the carry, not Xingqiu.
    const ttds = [get("Hu Tao"), geared("Bennett", { weapon: "Thrilling Tales of Dragon Slayers" }), get("Xingqiu"), get("Zhongli")];
    const base = [get("Hu Tao"), bare("Bennett"), get("Xingqiu"), get("Zhongli")];
    expect(carryGets(ttds).atkPct - carryGets(base).atkPct).toBeCloseTo(0.12, 5);
    expect(memberGets(ttds[2], ttds).atkPct).toBeCloseTo(memberGets(base[2], base).atkPct, 5);
  });

  test("VV shreds the swirled elements only, while the team Swirls", () => {
    const vv = [get("Hu Tao"), geared("Kaedehara Kazuha", { set: "Viridescent Venerer" }), get("Xingqiu"), get("Zhongli")];
    const plain = [get("Hu Tao"), bare("Kaedehara Kazuha"), get("Xingqiu"), get("Zhongli")];
    const swirl: Reaction[] = ["swirl", "vaporize"];
    expect(carryGets(vv, swirl).resShred - carryGets(plain, swirl).resShred).toBeCloseTo(0.4, 5);
    expect(carryGets(vv, ["vaporize"]).resShred).toBeCloseTo(carryGets(plain, ["vaporize"]).resShred, 5);
    expect(memberGets(vv[3], vv, swirl).resShred).toBeCloseTo(memberGets(plain[3], plain, swirl).resShred, 5); // Zhongli: Geo
  });

  test("one wearer per party set: a teammate already wearing it moves a benchmark support to their next pick (#348)", () => {
    const sets = (...ids: string[]) => {
      const t = ids.map((id) => get(id));
      return Object.fromEntries(t.map((m) => [m.id, setsOf(m, ["overloaded", "melt"], t)[0]?.set]));
    };
    // Chevreuse gives Noblesse up to Bennett ("if no one else is holding it"), in any team order.
    expect(sets("Clorinde", "Bennett", "Chevreuse", "Furina")).toMatchObject({ Bennett: "Noblesse Oblige", Chevreuse: "Tenacity of the Millelith" });
    expect(sets("Chevreuse", "Furina", "Clorinde", "Bennett")).toMatchObject({ Bennett: "Noblesse Oblige", Chevreuse: "Tenacity of the Millelith" });
    // Xilonen keeps Scroll ("her best artifact set by far"); Citlali takes Tenacity.
    expect(sets("Arlecchino", "Citlali", "Xilonen", "Bennett")).toMatchObject({ Xilonen: "Scroll of the Hero of Cinder City", Citlali: "Tenacity of the Millelith" });
    // A build's set stays: a built Bennett on Noblesse moves Chevreuse too.
    const t = [get("Clorinde"), geared("Bennett", { set: "Noblesse Oblige" }), get("Chevreuse"), get("Furina")];
    expect(setsOf(t[2], ["overloaded"], t)[0]?.set).toBe("Tenacity of the Millelith");
  });

  test("Instructor, Celestial Gift, Heart of the Furnace (#345)", () => {
    // Instructor: 120 EM to the party while its wearer triggers one of the team's reactions.
    const instructor = geared("Bennett", { set: "Instructor" });
    expect(partySetBuffs([get("Hu Tao"), instructor, get("Xingqiu")], ["vaporize"]).em).toBe(120);
    expect(partySetBuffs([get("Hu Tao"), instructor, get("Zhongli")], []).em).toBe(0);
    // Celestial Gift: 20% to the wearer's element; with Secret Rite 40% to the wearer's and the on-field carry's.
    const gift = geared("Nicole", { set: "Celestial Gift" });
    const dmg = (carry: string, ...mates: ScoringCharacter[]) => carryGets([get(carry), ...mates]).dmgBonus;
    expect(dmg("Mavuika", gift, get("Xingqiu")) - dmg("Mavuika", bare("Nicole"), get("Xingqiu"))).toBeCloseTo(0.2, 5);
    expect(dmg("Clorinde", gift, get("Xingqiu")) - dmg("Clorinde", bare("Nicole"), get("Xingqiu"))).toBeCloseTo(0, 5); // Electro
    expect(dmg("Clorinde", gift, bare("Fischl")) - dmg("Clorinde", bare("Nicole"), bare("Fischl"))).toBeCloseTo(0.4, 5); // Mortal Hymn
    // Heart of the Furnace: the party's Stellar Glimmer reaction DMG.
    expect(partySetBuffs([get("Wriothesley"), geared("Alyosha", { set: "Heart of the Furnace" })], ["stellar-conduct"]).stellar).toBe(0.5);
  });

  test("Husk of Opulent Dreams: 24% DEF and 24% Geo DMG at full stacks on a DEF-scaled carry (#346)", () => {
    const itto = (set?: string) => {
      const c = geared("Arataki Itto", { set });
      return carryDamage(c, [], [c, get("Gorou"), get("Albedo"), get("Zhongli")])!.perSecond;
    };
    // His hits scale on DEF and his Burst converts DEF to ATK: more than the 24% Geo DMG alone.
    expect(itto("Husk of Opulent Dreams") / itto()).toBeGreaterThan(1.24);
  });

  test("Xilonen shreds Geo and party Pyro/Hydro/Cryo/Electro only, not Dendro (#337)", () => {
    const xilonen = [get("Alhaitham"), get("Ineffa"), get("Xilonen"), get("Yelan")];
    const plain = [get("Alhaitham"), get("Ineffa"), get("Bennett"), get("Yelan")];
    expect(carryGets(xilonen).resShred).toBeCloseTo(carryGets(plain).resShred, 5);
    expect(memberGets(xilonen[3], xilonen).resShred - memberGets(plain[3], plain).resShred).toBeCloseTo(0.33, 5);
  });

  test("for a modeled carry the gear's effects.json line scores 0, in team damage", () => {
    const t = [get("Hu Tao"), geared("Bennett", { set: "Noblesse Oblige" }), get("Xingqiu"), get("Zhongli")];
    expect(scoreTeam(t).breakdown.find((l) => /^Bennett .*Noblesse Oblige.*in team damage/.test(l.reason))).toMatchObject({ points: 0 });
  });
});
