import type { CharacterStats } from "@/types/build";
import type { Element } from "@/types/tags";

// Enka fight prop IDs for final stats. Percent stats come as fractions (0.489 = 48.9%).
// https://github.com/EnkaNetwork/API-docs/blob/master/docs/gi/api.md
const FINAL_HP = 2000;
const FINAL_ATK = 2001;
const FINAL_DEF = 2002;
const CRIT_RATE = 20;
const CRIT_DMG = 22;
const ENERGY_RECHARGE = 23;
const ELEMENTAL_MASTERY = 28;

const DMG_BONUS: Record<Element, number> = {
  Pyro: 40,
  Electro: 41,
  Hydro: 42,
  Dendro: 43,
  Anemo: 44,
  Geo: 45,
  Cryo: 46,
};

const flat = (v: number | undefined) => Math.round(v ?? 0);
const percent = (v: number | undefined) => Math.round((v ?? 0) * 1000) / 10; // one decimal, like the game

export function mapFightProps(props: Record<string, number>, element: Element): CharacterStats {
  return {
    hp: flat(props[FINAL_HP]),
    atk: flat(props[FINAL_ATK]),
    def: flat(props[FINAL_DEF]),
    critRate: percent(props[CRIT_RATE]),
    critDmg: percent(props[CRIT_DMG]),
    energyRecharge: percent(props[ENERGY_RECHARGE]),
    elementalMastery: flat(props[ELEMENTAL_MASTERY]),
    elementalDmgBonus: percent(props[DMG_BONUS[element]]),
  };
}
