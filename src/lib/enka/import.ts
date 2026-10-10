import genshindb from "genshin-db";
import skillOrderJson from "../../../data/enka-skill-order.json";
import tagsJson from "../../../data/tags.json";
import type { CharacterBuild, ImportedCharacter, UidImport } from "../../types/build";
import type { CharacterTags, Element } from "../../types/tags";
import { mapFightProps } from "./stats";
import type { EnkaAvatar, EnkaResponse } from "./types";

// Server-side only: genshin-db is ~178 MB.

const TRAVELER_IDS = new Set([10000005, 10000007]); // Aether, Lumine
const { skillOrder, travelerElement } = skillOrderJson as {
  skillOrder: Record<string, number[]>;
  travelerElement: Record<string, Element>;
};
const tagIds = new Set((tagsJson as CharacterTags[]).map((t) => t.id));

type DbCharacter = NonNullable<ReturnType<typeof genshindb.characters>>;

// genshin-db is queried by name, so build ID lookups once per server process.
let lookups: {
  characters: Map<number, DbCharacter>;
  weapons: Map<number, string>;
  sets: Map<number, string>;
} | null = null;

function getLookups() {
  if (lookups) return lookups;
  const names = (fn: (q: string, o: object) => unknown) => fn("names", { matchCategories: true }) as string[];
  lookups = {
    characters: new Map(names(genshindb.characters).map((n) => genshindb.characters(n)!).map((c) => [c.id, c])),
    weapons: new Map(names(genshindb.weapons).map((n) => genshindb.weapons(n)!).map((w) => [w.id, w.name])),
    sets: new Map(names(genshindb.artifacts).map((n) => genshindb.artifacts(n)!).map((a) => [a.id, a.name])),
  };
  return lookups;
}

// The tags.json id and element for an Enka avatar, or null when tags.json has no such character.
function identify(avatar: EnkaAvatar): { id: string; element: Element } | null {
  if (TRAVELER_IDS.has(avatar.avatarId)) {
    const element = travelerElement[`${avatar.avatarId}-${avatar.skillDepotId}`];
    return element ? { id: `Traveler (${element})`, element } : null;
  }
  const db = getLookups().characters.get(avatar.avatarId);
  if (!db || !tagIds.has(db.name)) return null;
  return { id: db.name, element: db.elementText as Element };
}

// [normal, skill, burst] skill IDs. Characters missing from Enka's store (the newest ones) use
// IDs ending in 1, 2 and 5, so sorting the three IDs gives the right order.
function talentIds(avatar: EnkaAvatar): number[] {
  const key = TRAVELER_IDS.has(avatar.avatarId) ? `${avatar.avatarId}-${avatar.skillDepotId}` : `${avatar.avatarId}`;
  return skillOrder[key] ?? Object.keys(avatar.skillLevelMap).map(Number).sort((a, b) => a - b).slice(0, 3);
}

function talents(avatar: EnkaAvatar, characterId: string, constellation: number): CharacterBuild["talents"] {
  const [normal, skill, burst] = talentIds(avatar).map((id) => avatar.skillLevelMap[id] ?? 1);
  const levels = { normal, skill, burst };

  // C3 and C5 each add 3 levels to one talent; genshin-db names it in the constellation text.
  const cons = genshindb.constellations(characterId);
  const names = genshindb.talents(characterId);
  if (cons && names) {
    const talentByName = { normal: names.combat1.name, skill: names.combat2.name, burst: names.combat3.name };
    for (const c of [cons.c3, cons.c5].slice(0, constellation >= 5 ? 2 : constellation >= 3 ? 1 : 0)) {
      for (const [talent, name] of Object.entries(talentByName) as [keyof typeof levels, string][]) {
        if (c.descriptionRaw.includes(name)) levels[talent] += 3;
      }
    }
  }
  return levels;
}

function weapon(avatar: EnkaAvatar): CharacterBuild["weapon"] {
  const equip = avatar.equipList.find((e) => e.flat.itemType === "ITEM_WEAPON");
  const affix = equip?.weapon?.affixMap ? Object.values(equip.weapon.affixMap)[0] : undefined;
  return {
    id: (equip && getLookups().weapons.get(equip.itemId)) ?? "Unknown",
    level: equip?.weapon?.level ?? 1,
    refinement: (affix ?? 0) + 1,
    ascension: equip?.weapon?.promoteLevel ?? 0, // Enka leaves out fields that are 0
  };
}

// Set IDs come from the artifact icon name, e.g. UI_RelicIcon_15020_4 is Emblem of Severed Fate.
function artifactSets(avatar: EnkaAvatar): CharacterBuild["artifactSets"] {
  const counts = new Map<number, number>();
  for (const e of avatar.equipList) {
    const setId = Number(e.flat.icon?.match(/^UI_RelicIcon_(\d+)_/)?.[1]);
    if (setId) counts.set(setId, (counts.get(setId) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= 2)
    .map(([setId, n]) => ({ set: getLookups().sets.get(setId) ?? `Set ${setId}`, pieces: n >= 4 ? 4 : 2 }));
}

export function toUidImport(data: EnkaResponse, fetchedAt: string): UidImport {
  const characters: ImportedCharacter[] = [];
  const unmatched: number[] = [];
  for (const avatar of data.avatarInfoList ?? []) {
    const who = identify(avatar);
    if (!who) {
      unmatched.push(avatar.avatarId);
      continue;
    }
    const constellation = avatar.talentIdList?.length ?? 0;
    characters.push({
      id: who.id,
      constellation,
      build: {
        level: Number(avatar.propMap["4001"]?.val ?? 1),
        ascension: Number(avatar.propMap["1002"]?.val ?? 0), // "1002" = ascension phase; left out when 0
        talents: talents(avatar, who.id, constellation),
        weapon: weapon(avatar),
        artifactSets: artifactSets(avatar),
        stats: mapFightProps(avatar.fightPropMap, who.element),
      },
    });
  }
  return { uid: data.uid, nickname: data.playerInfo.nickname, fetchedAt, characters, unmatched };
}
