// Teams that build guides recommend, used by `npm run compare` to check the scorer (design doc Phase 4).
// The first team per carry is the guide's top pick; the others are its listed alternatives.
// Looked up 2026-10-08.

export interface KnownTeams {
  carry: string;
  teams: [string, string, string, string][];
  source: string;
}

export const KNOWN_TEAMS: KnownTeams[] = [
  {
    carry: "Hu Tao",
    teams: [
      ["Hu Tao", "Xingqiu", "Yelan", "Zhongli"],
      ["Hu Tao", "Xingqiu", "Kaedehara Kazuha", "Zhongli"],
      ["Hu Tao", "Xingqiu", "Sucrose", "Bennett"],
    ],
    source: "https://genshin-builds.com/en/teams/hu_tao",
  },
  {
    carry: "Raiden Shogun",
    teams: [["Raiden Shogun", "Xingqiu", "Xiangling", "Bennett"]],
    source: "https://afkgaming.com/gaming/genshin-impact/best-teams-for-raiden-shogun-in-genshin-impact-43",
  },
  {
    carry: "Neuvillette",
    teams: [
      ["Neuvillette", "Furina", "Kaedehara Kazuha", "Zhongli"],
      ["Neuvillette", "Fischl", "Kaedehara Kazuha", "Zhongli"],
    ],
    source: "https://afkgaming.com/gaming/genshin-impact/best-team-comps-for-neuvillette-in-genshin-impact",
  },
  {
    carry: "Kamisato Ayaka",
    teams: [
      ["Kamisato Ayaka", "Ganyu", "Kamisato Ayato", "Sangonomiya Kokomi"],
      ["Kamisato Ayaka", "Mona", "Venti", "Diona"],
    ],
    source: "https://gamewith.net/genshin-impact/article/show/38316",
  },
  {
    carry: "Alhaitham",
    teams: [
      ["Alhaitham", "Lauma", "Xingqiu", "Kuki Shinobu"],
      ["Alhaitham", "Nahida", "Xingqiu", "Kuki Shinobu"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/alhaitham-team-guide",
  },
  {
    carry: "Arlecchino",
    teams: [
      ["Arlecchino", "Citlali", "Xilonen", "Bennett"],
      ["Arlecchino", "Citlali", "Rosaria", "Bennett"],
      ["Arlecchino", "Yelan", "Xilonen", "Bennett"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/arlecchino-team-guide",
  },
  {
    carry: "Mavuika",
    teams: [
      ["Mavuika", "Citlali", "Xilonen", "Bennett"],
      ["Mavuika", "Furina", "Xilonen", "Bennett"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/mavuika-team-guide",
  },
  {
    carry: "Flins",
    teams: [["Flins", "Aino", "Xilonen", "Ineffa"]],
    source: "https://www.icy-veins.com/genshin-impact/flins-team-guide",
  },
  {
    carry: "Nefer",
    teams: [
      ["Nefer", "Lauma", "Yaoyao", "Aino"],
      ["Nefer", "Lauma", "Nilou", "Diona"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/nefer-team-guide",
  },
  {
    carry: "Zibai",
    teams: [
      ["Zibai", "Illuga", "Columbina", "Gorou"],
      ["Zibai", "Illuga", "Columbina", "Zhongli"],
      ["Zibai", "Columbina", "Aino", "Xilonen"],
    ],
    source: "https://gamewith.net/genshin-impact/article/show/72186",
  },
  {
    carry: "Skirk",
    teams: [
      ["Skirk", "Shenhe", "Furina", "Escoffier"],
      ["Skirk", "Citlali", "Furina", "Escoffier"],
      ["Skirk", "Yelan", "Furina", "Escoffier"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/skirk-team-guide",
  },
  {
    carry: "Clorinde",
    teams: [
      ["Clorinde", "Furina", "Nahida", "Baizhu"],
      ["Clorinde", "Fischl", "Yun Jin", "Zhongli"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/clorinde-team-guide",
  },
  {
    carry: "Varesa",
    teams: [
      ["Varesa", "Mavuika", "Chevreuse", "Iansan"],
      ["Varesa", "Bennett", "Chevreuse", "Iansan"],
    ],
    source: "https://genshin-builds.com/en/teams/varesa",
  },
  {
    carry: "Xiao",
    teams: [
      ["Xiao", "Xianyun", "Faruzan", "Furina"],
      ["Xiao", "Xianyun", "Zhongli", "Furina"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/xiao-team-guide",
  },
  {
    carry: "Wriothesley",
    teams: [
      ["Wriothesley", "Furina", "Xilonen", "Charlotte"],
      ["Wriothesley", "Xilonen", "Xiangling", "Bennett"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/wriothesley-team-guide",
  },
  {
    carry: "Kinich",
    teams: [
      ["Kinich", "Emilie", "Xiangling", "Bennett"],
      ["Kinich", "Emilie", "Xiangling", "Zhongli"],
    ],
    source: "https://www.icy-veins.com/genshin-impact/kinich-team-guide",
  },
];
