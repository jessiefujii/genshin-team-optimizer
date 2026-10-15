"use client";

import { useState } from "react";
import type { BuildSuggestion } from "@/lib/scoring/suggest";
import { elementChip } from "@/lib/ui/elements";
import type { PlannerCharacter } from "./types";

const SHOWN = 5;

// Owned characters whose build keeps one of their teams out of the list (design doc: build suggestions).
export default function WorthBuilding({
  suggestions,
  byId,
}: {
  suggestions: BuildSuggestion[];
  byId: Map<string, PlannerCharacter>;
}) {
  const [all, setAll] = useState(false);
  if (suggestions.length === 0) return null;
  const shown = all ? suggestions : suggestions.slice(0, SHOWN);

  return (
    <details open className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <summary className="cursor-pointer font-medium">Worth building ({suggestions.length})</summary>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Built to the benchmark (CV 200, ER at target, talents at 9), these characters would put a team in the list.
      </p>
      <ul className="mt-2 space-y-2">
        {shown.map((s) => (
          <li key={s.id}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`${elementChip(byId.get(s.id)?.element ?? "")} font-semibold`}>{s.id}</span>
              <span className="text-red-700 dark:text-red-400">{s.gaps.join(" · ")}</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              → {s.team.members.join(" · ")} would rank #{s.rank} (score {Math.round(s.team.score)})
            </div>
          </li>
        ))}
      </ul>
      {suggestions.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-2 text-xs text-blue-700 hover:underline dark:text-blue-400"
        >
          {all ? "Show fewer" : `Show all ${suggestions.length}`}
        </button>
      )}
    </details>
  );
}
