import type { Metadata } from "next";
import genshindb from "genshin-db";
import tagsJson from "../../../data/tags.json";
import type { CharacterTags } from "@/types/tags";
import TagsTable, { type TagRow } from "./tags-table";

export const metadata: Metadata = {
  title: "Character tags",
  description: "Review the hand-maintained tags in data/tags.json",
};

const tags = tagsJson as CharacterTags[];

// Traveler ids look like 'Traveler (Anemo)'; everyone else is looked up in genshin-db.
function toRow(tag: CharacterTags): TagRow {
  const traveler = tag.id.match(/^Traveler \((\w+)\)$/);
  if (traveler) {
    return { ...tag, element: traveler[1], weapon: "Sword", rarity: 5 };
  }
  const character = genshindb.characters(tag.id);
  return {
    ...tag,
    element: character?.elementText ?? "Unknown",
    weapon: character?.weaponText ?? "Unknown",
    rarity: character?.rarity ?? 4,
  };
}

export default function TagsPage() {
  const rows = tags.map(toRow).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Character tags</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Draft of <code className="font-mono">data/tags.json</code>. Rows marked VERIFY were drafted from talent text only.
      </p>
      <TagsTable rows={rows} />
    </main>
  );
}
