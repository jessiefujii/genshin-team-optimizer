import genshindb from "genshin-db";
import { loadScoringCharacters } from "@/lib/scoring/load";
import RosterPlanner from "./planner/roster-planner";
import type { BuildCatalog, PlannerCharacter } from "./planner/types";

function loadPlannerCharacters(): PlannerCharacter[] {
  return loadScoringCharacters()
    .map((c) => {
      const db = c.id.startsWith("Traveler (") ? null : genshindb.characters(c.id);
      return { ...c, rarity: db?.rarity ?? 5 };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadBuildCatalog(): BuildCatalog {
  const names = (fn: (q: string, o: object) => unknown) => fn("names", { matchCategories: true }) as string[];
  const weapons: BuildCatalog["weapons"] = {};
  const weaponRarity: BuildCatalog["weaponRarity"] = {};
  const every = names(genshindb.weapons).map((n) => genshindb.weapons(n)!);
  for (const w of every) weaponRarity[w.name] = w.rarity;
  const all = every
    .filter((w) => w.rarity >= 3) // 1-2 star weapons are never used
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
  for (const w of all) {
    const list = (weapons[w.weaponText] ??= []);
    if (!list.includes(w.name)) list.push(w.name); // some weapons (Prized Isshin Blade) are listed per variant
  }
  return { weapons, sets: [...new Set(names(genshindb.artifacts))].sort((a, b) => a.localeCompare(b)), weaponRarity };
}

export default function Home() {
  const characters = loadPlannerCharacters();
  const catalog = loadBuildCatalog();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Genshin Team Optimizer</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Tick the characters you own; the best teams update as you go. Your roster is saved in this browser.
      </p>
      <div className="mt-6">
        <RosterPlanner characters={characters} catalog={catalog} />
      </div>
    </main>
  );
}
