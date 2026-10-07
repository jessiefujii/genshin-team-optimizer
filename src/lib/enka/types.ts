// The parts of Enka's /api/uid/{uid} response the app reads.
// Full format: https://github.com/EnkaNetwork/API-docs

export interface EnkaResponse {
  uid: string;
  ttl: number; // seconds until Enka will serve a fresh profile
  playerInfo: {
    nickname: string;
    level: number;
    showAvatarInfoList?: { avatarId: number; level: number }[];
  };
  // Missing when the player hides character details in their showcase.
  avatarInfoList?: EnkaAvatar[];
}

export interface EnkaAvatar {
  avatarId: number;
  propMap: Record<string, { type: number; val?: string }>; // "4001" = level
  talentIdList?: number[]; // unlocked constellations
  fightPropMap: Record<string, number>; // final stats, keyed by fight prop ID
  skillLevelMap: Record<string, number>;
  equipList: EnkaEquip[];
}

export interface EnkaEquip {
  itemId: number;
  weapon?: { level: number; affixMap?: Record<string, number> }; // affix value + 1 = refinement
  reliquary?: { level: number };
  flat: {
    itemType: "ITEM_WEAPON" | "ITEM_RELIQUARY";
    nameTextMapHash: string;
    setNameTextMapHash?: string;
    equipType?: string;
  };
}
