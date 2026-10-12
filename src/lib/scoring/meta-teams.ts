// Meta teams for `npm run meta` (#127, design doc Phase 4): does the scorer rank what's meta near the top?
// Meta carries (Jessie, 2026-10-12): Main DPS rated top tier (SS/S) in 2+ sources from 6.5 to 7.1, not only 7.1
// (7.1 lists favor 7.x content like Stellar Glimmer). Sources, fetched 2026-10-12:
// - Game8 7.1 tier list (updated 2026-09-30) and its tier changelog (6.6 05-20, 6.7 07-01, 7.0 08-12, 7.1 09-23):
//   https://game8.co/games/Genshin-Impact/archives/297465
// - genshin-builds 7.1 teams, SS tier (no date shown): https://genshin-builds.com/en/teams
// - gamemarket.gg 6.7 Main DPS tier list (2026-07-08):
//   https://gamemarket.gg/news/genshin-impact/version-6-7-dps-tier-list-top-main-damage-dealers
// - The Phrasemaker 6.5 DPS tier list (2026-05-04):
//   https://thephrasemaker.com/2026/05/04/genshin-impact-complete-dps-tier-list-6-5-may-2026/
// Left out: Lohen, Alhaitham, Chasca (one source each), Wriothesley and Traveler (Cryo) (Game8 only), Columbina (S as
// a DPS in gamemarket and Phrasemaker, but Game8, KQM and our tags use her as a sub-DPS/support: Jessie kept her there).
// Teams: the carry's KeqingMains quick guide with the #108 rules (see known-teams.ts); genshin-builds where KQM has no
// page (Vesna) or is outdated (Cyno: "Updated for Version 4.2"). topPick = genshin-builds' first SS team for the carry
// (it lists teams with tier labels, not numbered ranks).
// Traveler (Cryo) isn't in our data yet (#136): teams that need them are kept in `unscorable` and only counted.
import { KNOWN_TEAMS } from "./known-teams";

type Team = [string, string, string, string];

export interface MetaCarry {
  carry: string;
  metaIn: string; // where and when the carry was rated top tier
  topPick: Team | null; // null when genshin-builds' first SS team can't be scored yet
  teams: Team[];
  unscorable: string[];
  source: string;
}

const kqm = (carry: string) => KNOWN_TEAMS.find((k) => k.carry === carry)!.teams;

export const META_TEAMS: MetaCarry[] = [
  {
    carry: "Sandrone",
    metaIn: "Game8 SS 7.0-7.1 (S 6.7); gamemarket 6.7 SS; genshin-builds SS",
    topPick: ["Sandrone", "Yae Miko", "Odette", "Alyosha"],
    // KQM 7.1. Left out: C6 Qiqi / C6 Alyosha / C6 Beidou / C6 Diona options and the two teams built on them; the
    // Limited Roster Alternative (Alyosha, Charlotte / Diona, Sucrose).
    teams: [
      ["Sandrone", "Yae Miko", "Odette", "Escoffier"],
      ["Sandrone", "Yae Miko", "Odette", "Sucrose"],
      ["Sandrone", "Yae Miko", "Qiqi", "Escoffier"],
      ["Sandrone", "Yae Miko", "Qiqi", "Nicole"],
      ["Sandrone", "Yae Miko", "Escoffier", "Nicole"],
      ["Sandrone", "Columbina", "Ineffa", "Yae Miko"],
    ],
    unscorable: ["Sandrone, Odette, Sucrose, Traveler (Cryo)"],
    source: "https://keqingmains.com/q/sandrone-quickguide/",
  },
  {
    carry: "Vesna",
    metaIn: "Game8 SS 7.1; genshin-builds SS",
    topPick: null,
    // No KQM page. genshin-builds' two Vesna teams are the same four, both with Traveler (Cryo).
    teams: [],
    unscorable: ["Vesna, Odette, Vodyanitsa, Traveler (Cryo)"],
    source: "https://genshin-builds.com/en/teams",
  },
  {
    carry: "Varka",
    metaIn: "Game8 SS from 6.6 (2026-05-20), S in 7.1; gamemarket 6.7 S; genshin-builds SS",
    topPick: ["Varka", "Prune", "Nicole", "Bennett"],
    // KQM 7.1. "Venti over Prune when she isn't C6" and Faruzan's extra pre-C6 step are preferences, not requirements.
    // Left out: Limited Roster Alternatives.
    teams: [
      ["Varka", "Prune", "Nicole", "Durin"],
      ["Varka", "Venti", "Nicole", "Durin"],
      ["Varka", "Venti", "Bennett", "Durin"],
      ["Varka", "Faruzan", "Bennett", "Durin"],
      ["Varka", "Prune", "Nicole", "Bennett"],
      ["Varka", "Venti", "Nicole", "Bennett"],
      ["Varka", "Prune", "Vodyanitsa", "Furina"],
      ["Varka", "Prune", "Vodyanitsa", "Mona"],
      ["Varka", "Prune", "Mona", "Furina"],
      ["Varka", "Prune", "Mona", "Yelan"],
      ["Varka", "Prune", "Odette", "Escoffier"],
      ["Varka", "Prune", "Escoffier", "Shenhe"],
      ["Varka", "Venti", "Iansan", "Fischl"],
    ],
    unscorable: ["Varka, Prune, Odette, Traveler (Cryo)"],
    source: "https://keqingmains.com/q/varka-quickguide/",
  },
  {
    carry: "Zibai",
    metaIn: "Game8 SS 7.1; Phrasemaker 6.5 S; genshin-builds SS",
    topPick: ["Zibai", "Linnea", "Columbina", "Gorou"],
    teams: kqm("Zibai"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Nefer",
    metaIn: "Game8 SS since 2025-11; Phrasemaker 6.5 S; genshin-builds SS",
    topPick: ["Nefer", "Lauma", "Yaoyao", "Columbina"],
    teams: kqm("Nefer"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Flins",
    metaIn: "Game8 SS since 2025-11; Phrasemaker 6.5 S; genshin-builds SS",
    topPick: ["Flins", "Aino", "Jahoda", "Ineffa"],
    teams: kqm("Flins"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Skirk",
    metaIn: "Game8 SS from 2025-06, S in 7.1; gamemarket 6.7 SS; Phrasemaker 6.5 S; genshin-builds SS",
    topPick: ["Skirk", "Dahlia", "Furina", "Escoffier"],
    teams: kqm("Skirk"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Mavuika",
    metaIn: "Game8 SS 7.1; gamemarket 6.7 SS; Phrasemaker 6.5 S; genshin-builds SS",
    topPick: ["Mavuika", "Ororon", "Chevreuse", "Bennett"],
    teams: kqm("Mavuika"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Cyno",
    metaIn: "Game8 SS 7.0-7.1; genshin-builds SS",
    topPick: ["Cyno", "Chevreuse", "Xiangling", "Bennett"],
    // genshin-builds' SS Cyno teams (the second is listed under Kuki Shinobu). KQM's guide is from 4.2.
    teams: [["Cyno", "Nahida", "Yelan", "Kuki Shinobu"]],
    unscorable: [],
    source: "https://genshin-builds.com/en/teams",
  },
  {
    carry: "Yumemizuki Mizuki",
    metaIn: "Game8 S 7.0, SS 7.1; genshin-builds SS",
    topPick: ["Yumemizuki Mizuki", "Furina", "Ororon", "Venti"],
    // KQM 7.0. Left out: Odette + C6 Qiqi, and C6 Diona teams.
    teams: [
      ["Yumemizuki Mizuki", "Fischl", "Ororon", "Furina"],
      ["Yumemizuki Mizuki", "Yae Miko", "Fischl", "Nahida"],
      ["Yumemizuki Mizuki", "Ineffa", "Columbina", "Xilonen"],
      ["Yumemizuki Mizuki", "Ineffa", "Columbina", "Durin"],
    ],
    unscorable: [
      "Mizuki, Traveler (Cryo), Qiqi, Sucrose",
      "Mizuki, Odette, Traveler (Cryo), Faruzan / Sucrose",
      "Mizuki, Odette, Traveler (Cryo), Qiqi",
      "Mizuki, Odette, Traveler (Cryo), Lan Yan / Zhongli",
    ],
    source: "https://keqingmains.com/q/mizuki-quickguide/",
  },
  // Meta before 7.0's Stellar Glimmer: Game8 S until 2026-08-12 (then A), so 6.7 and earlier.
  {
    carry: "Neuvillette",
    metaIn: "Game8 S 2025-11 to 7.0 (A since); gamemarket 6.7 SS; genshin-builds SS",
    topPick: ["Neuvillette", "Furina", "Xilonen", "Ineffa"],
    teams: kqm("Neuvillette"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Arlecchino",
    metaIn: "Game8 S 2025-11 to 7.0 (A since); gamemarket 6.7 S; genshin-builds SS",
    topPick: ["Arlecchino", "Citlali", "Xilonen", "Bennett"],
    teams: kqm("Arlecchino"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Varesa",
    metaIn: "Game8 SS 2025-11 to 6.6, S to 7.0 (A+ since); gamemarket 6.7 S; genshin-builds SS",
    topPick: ["Varesa", "Mavuika", "Chevreuse", "Iansan"],
    teams: kqm("Varesa"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
];
