// Final stats as shown on the in-game Attributes screen. Percent stats are in percent
// (critRate 48.9 means 48.9%), so CV = 2 × critRate + critDmg lands near the ~200 benchmark.
export interface CharacterStats {
  atk: number;
  hp: number;
  def: number;
  critRate: number;
  critDmg: number;
  energyRecharge: number;
  elementalMastery: number;
  elementalDmgBonus: number; // for the character's own element
}
