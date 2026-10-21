import genshindb from "genshin-db";
import { loadScoringCharacters } from "@/lib/scoring/load";
import RosterPlanner from "./planner/roster-planner";
import type { BuildCatalog, PlannerCharacter } from "./planner/types";

function loadPlannerCharacters(): PlannerCharacter[] {
  return loadScoringCharacters()
    .map((c) => {
      const db = c.id.startsWith("Traveler (") ? null : genshindb.characters(c.id);
      // genshin-db has no Traveler entry per element: every Traveler shows Lumine's icon (Enka's PlayerGirl).
      const icon = db ? db.images?.filename_icon : "UI_AvatarIcon_PlayerGirl";
      return { ...c, rarity: db?.rarity ?? 5, ...(icon ? { icon } : {}) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function loadBuildCatalog(): BuildCatalog {
  const names = (fn: (q: string, o: object) => unknown) => fn("names", { matchCategories: true }) as string[];
  const weapons: BuildCatalog["weapons"] = {};
  const weaponRarity: BuildCatalog["weaponRarity"] = {};
  const weaponIcons: BuildCatalog["weaponIcons"] = {};
  const every = names(genshindb.weapons).map((n) => genshindb.weapons(n)!);
  for (const w of every) {
    weaponRarity[w.name] = w.rarity;
    if (w.images?.filename_icon) weaponIcons[w.name] = w.images.filename_icon;
  }
  const all = every
    .filter((w) => w.rarity >= 3) // 1-2 star weapons are never used
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
  for (const w of all) {
    const list = (weapons[w.weaponText] ??= []);
    if (!list.includes(w.name)) list.push(w.name); // some weapons (Prized Isshin Blade) are listed per variant
  }
  const sets = [...new Set(names(genshindb.artifacts))].sort((a, b) => a.localeCompare(b));
  // A set's icon in game is its flower; one-piece sets (Prayers) only have a circlet.
  const setIcons: BuildCatalog["setIcons"] = {};
  for (const s of sets) {
    const img = genshindb.artifacts(s)?.images;
    const icon = img?.filename_flower ?? img?.filename_circlet;
    if (icon) setIcons[s] = icon;
  }
  return { weapons, sets, weaponRarity, weaponIcons, setIcons };
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
      {/* Jump links to the planner's sections (#182): useful on phones, where the two columns stack. */}
      <nav aria-label="Sections" className="mt-2 flex gap-4 text-sm lg:hidden">
        <a href="#roster-heading" className="text-blue-700 hover:underline dark:text-blue-400">
          My roster
        </a>
        <a href="#results-heading" className="text-blue-700 hover:underline dark:text-blue-400">
          Best teams
        </a>
      </nav>
      <div className="mt-6">
        <RosterPlanner characters={characters} catalog={catalog} />
      </div>
    </main>
  );
}
