// Guide teams for main DPS outside the compare's carries (known-teams.ts, meta-teams.ts), so each has a per-carry
// reference (#210, team-reference.ts). KQM quick guides first, as in #108; their example lists are unranked ("not a
// comprehensive list", "inclusion does not reflect power level"), so every team is listed and the reference keeps the
// best. A slash in a guide ("Fischl/Durin") is one team per option. Fetched 2026-10-15; the sources are on #210.
type Team = [string, string, string, string];

export interface GuideCarry {
  carry: string;
  source: string;
  teams: Team[];
}

export const GUIDE_TEAMS: GuideCarry[] = [
  {
    carry: "Klee",
    source: "https://keqingmains.com/q/klee-quickguide/",
    teams: [
      ["Klee", "Chevreuse", "Durin", "Fischl"],
      ["Klee", "Chevreuse", "Fischl", "Bennett"],
      ["Klee", "Furina", "Albedo", "Xilonen"],
      ["Klee", "Furina", "Fischl", "Bennett"],
      ["Klee", "Fischl", "Columbina", "Ineffa"],
      ["Klee", "Durin", "Columbina", "Ineffa"],
      ["Klee", "Fischl", "Xingqiu", "Bennett"],
      ["Klee", "Emilie", "Durin", "Bennett"],
    ],
  },
  {
    carry: "Tartaglia",
    source: "https://keqingmains.com/q/tartaglia-quickguide/",
    teams: [
      ["Tartaglia", "Albedo", "Xiangling", "Bennett"],
      ["Tartaglia", "Kaedehara Kazuha", "Xiangling", "Bennett"],
      ["Tartaglia", "Sucrose", "Xiangling", "Bennett"],
      ["Tartaglia", "Fischl", "Beidou", "Bennett"],
      ["Tartaglia", "Kujou Sara", "Beidou", "Bennett"], // the guide's Sara is C2; scored at C0 like everyone
      ["Tartaglia", "Diona", "Kamisato Ayaka", "Kaedehara Kazuha"],
      ["Tartaglia", "Thoma", "Traveler (Dendro)", "Diona"],
      ["Tartaglia", "Thoma", "Traveler (Dendro)", "Rosaria"],
    ],
  },
  {
    carry: "Tighnari",
    source: "https://keqingmains.com/q/tighnari-quickguide/",
    teams: [
      ["Tighnari", "Fischl", "Yae Miko", "Yaoyao"],
      ["Tighnari", "Fischl", "Kuki Shinobu", "Kaedehara Kazuha"],
      ["Tighnari", "Fischl", "Nahida", "Zhongli"],
    ],
  },
  {
    carry: "Yoimiya",
    source: "https://keqingmains.com/q/yoimiya-quickguide/",
    teams: [
      ["Yoimiya", "Yelan", "Ineffa", "Bennett"],
      ["Yoimiya", "Yelan", "Yun Jin", "Zhongli"],
      ["Yoimiya", "Xingqiu", "Bennett", "Citlali"],
      ["Yoimiya", "Yelan", "Kaedehara Kazuha", "Bennett"],
      ["Yoimiya", "Yelan", "Furina", "Xilonen"],
      ["Yoimiya", "Xingqiu", "Fischl", "Bennett"],
      ["Yoimiya", "Xingqiu", "Bennett", "Lan Yan"],
      ["Yoimiya", "Fischl", "Bennett", "Chevreuse"],
      ["Yoimiya", "Ororon", "Mavuika", "Chevreuse"],
      ["Yoimiya", "Bennett", "Chiori", "Zhongli"],
      ["Yoimiya", "Bennett", "Emilie", "Kaedehara Kazuha"],
      ["Yoimiya", "Bennett", "Escoffier", "Citlali"],
      ["Yoimiya", "Bennett", "Furina", "Escoffier"],
      ["Yoimiya", "Bennett", "Xiangling", "Furina"],
      ["Yoimiya", "Bennett", "Emilie", "Furina"],
      ["Yoimiya", "Bennett", "Emilie", "Fischl"],
    ],
  },
  {
    // No KQM guide; genshin-builds' main-DPS teams, all rated SS (one source only).
    carry: "Traveler (Cryo)",
    source: "https://genshin-builds.com/en/teams/traveler_cryo",
    teams: [
      ["Traveler (Cryo)", "Yae Miko", "Odette", "Alyosha"],
      ["Traveler (Cryo)", "Qiqi", "Odette", "Alyosha"],
      ["Traveler (Cryo)", "Yae Miko", "Nicole", "Odette"],
    ],
  },
];
