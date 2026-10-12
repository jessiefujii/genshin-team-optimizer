// Meta teams for `npm run meta` (#127, design doc Phase 4): does the scorer rank what's meta now near the top?
// Meta carries (Jessie, 2026-10-12): Main DPS in 2+ sources, fetched 2026-10-12:
// - Game8 7.1 tier list, Main DPS SS/S (updated 2026-09-30): https://game8.co/games/Genshin-Impact/archives/297465
// - genshin-builds 7.1 teams, SS tier (no date shown): https://genshin-builds.com/en/teams
// Left out: Lohen (genshin-builds only), Wriothesley (S on genshin-builds), Traveler (Cryo) (Game8 only).
// Teams: the carry's KeqingMains quick guide with the #108 rules (see known-teams.ts); genshin-builds where KQM has no
// page (Vesna) or is outdated (Cyno: "Updated for Version 4.2"). topPick = genshin-builds' first SS team for the carry
// (it lists teams with tier labels, not numbered ranks).
// Traveler (Cryo) isn't in our data yet (#136): teams that need them are kept in `unscorable` and only counted.
import { KNOWN_TEAMS } from "./known-teams";

type Team = [string, string, string, string];

export interface MetaCarry {
  carry: string;
  topPick: Team | null; // null when genshin-builds' first SS team can't be scored yet
  teams: Team[];
  unscorable: string[];
  source: string;
}

const kqm = (carry: string) => KNOWN_TEAMS.find((k) => k.carry === carry)!.teams;

export const META_TEAMS: MetaCarry[] = [
  {
    carry: "Sandrone",
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
    topPick: null,
    // No KQM page. genshin-builds' two Vesna teams are the same four, both with Traveler (Cryo).
    teams: [],
    unscorable: ["Vesna, Odette, Vodyanitsa, Traveler (Cryo)"],
    source: "https://genshin-builds.com/en/teams",
  },
  {
    carry: "Varka",
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
  { carry: "Zibai", topPick: ["Zibai", "Linnea", "Columbina", "Gorou"], teams: kqm("Zibai"), unscorable: [], source: "KQM via known-teams.ts" },
  { carry: "Nefer", topPick: ["Nefer", "Lauma", "Yaoyao", "Columbina"], teams: kqm("Nefer"), unscorable: [], source: "KQM via known-teams.ts" },
  { carry: "Flins", topPick: ["Flins", "Aino", "Jahoda", "Ineffa"], teams: kqm("Flins"), unscorable: [], source: "KQM via known-teams.ts" },
  { carry: "Skirk", topPick: ["Skirk", "Dahlia", "Furina", "Escoffier"], teams: kqm("Skirk"), unscorable: [], source: "KQM via known-teams.ts" },
  {
    carry: "Mavuika",
    topPick: ["Mavuika", "Ororon", "Chevreuse", "Bennett"],
    teams: kqm("Mavuika"),
    unscorable: [],
    source: "KQM via known-teams.ts",
  },
  {
    carry: "Cyno",
    topPick: ["Cyno", "Chevreuse", "Xiangling", "Bennett"],
    // genshin-builds' SS Cyno teams (the second is listed under Kuki Shinobu). KQM's guide is from 4.2.
    teams: [["Cyno", "Nahida", "Yelan", "Kuki Shinobu"]],
    unscorable: [],
    source: "https://genshin-builds.com/en/teams",
  },
  {
    carry: "Yumemizuki Mizuki",
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
];
