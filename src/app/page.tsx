import genshindb from "genshin-db";
import { loadScoringCharacters } from "@/lib/scoring/load";
import RosterPlanner from "./planner/roster-planner";
import type { PlannerCharacter } from "./planner/types";

function loadPlannerCharacters(): PlannerCharacter[] {
  return loadScoringCharacters()
    .map((c) => {
      const db = c.id.startsWith("Traveler (") ? null : genshindb.characters(c.id);
      return { ...c, weapon: db?.weaponText ?? "Sword", rarity: db?.rarity ?? 5 };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export default function Home() {
  const characters = loadPlannerCharacters();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Genshin Team Optimizer</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Tick the characters you own; the best teams update as you go. Your roster is saved in this browser.
      </p>
      <div className="mt-6">
        <RosterPlanner characters={characters} />
      </div>
    </main>
  );
}
