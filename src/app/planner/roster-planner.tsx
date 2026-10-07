"use client";

import { useMemo, useState } from "react";
import { control, quietChip } from "@/lib/ui/elements";
import ResultsList from "./results-list";
import RosterGrid from "./roster-grid";
import type { PlannerCharacter } from "./types";
import UidImport from "./uid-import";
import { useRoster } from "./use-roster";
import { useTeamSearch } from "./use-team-search";

function CharacterPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
        className={control}
        aria-label={label}
      >
        <option value="">{label}…</option>
        {options
          .filter((id) => !selected.includes(id))
          .map((id) => (
            <option key={id}>{id}</option>
          ))}
      </select>
      {selected.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(selected.filter((s) => s !== id))}
          className={`${quietChip} hover:line-through`}
          aria-label={`Remove ${id}`}
        >
          {id} ×
        </button>
      ))}
    </div>
  );
}

export default function RosterPlanner({ characters }: { characters: PlannerCharacter[] }) {
  const { roster, loaded, toggle, setEntry, setMany, importBuilds } = useRoster();
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);

  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const owned = useMemo(() => characters.filter((c) => roster[c.id]), [characters, roster]);
  const ownedIds = owned.map((c) => c.id);

  // Drop filters for characters that are no longer owned.
  const include = mustInclude.filter((id) => roster[id]).slice(0, 4);
  const skip = exclude.filter((id) => roster[id]);
  // useTeamSearch keys on the option values, so a fresh object each render is fine.
  const search = useTeamSearch(owned, { mustInclude: include, exclude: skip, limit: 20 });

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <UidImport roster={roster} onImport={importBuilds} />
        <RosterGrid characters={characters} roster={roster} onToggle={toggle} onSetEntry={setEntry} onSetMany={setMany} />
      </div>

      <section aria-labelledby="results-heading" aria-busy={search.status === "searching"}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="results-heading" className="text-lg font-semibold">
            Best teams
          </h2>
          <span className="text-sm text-zinc-500" aria-live="polite">
            {search.status === "searching" && "Searching…"}
            {search.status === "done" && `Top ${search.teams.length} · ${search.ms} ms`}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          <CharacterPicker label="Must include" options={ownedIds} selected={include} onChange={setMustInclude} />
          <CharacterPicker label="Exclude" options={ownedIds} selected={skip} onChange={setExclude} />
        </div>

        {!loaded ? null : owned.length < 4 ? (
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
            Pick at least 4 characters you own to see team suggestions.
          </p>
        ) : search.status === "error" ? (
          <p className="mt-6 text-sm text-red-700 dark:text-red-400">{search.error}</p>
        ) : (
          <div className={search.status === "searching" ? "opacity-60" : ""}>
            <ResultsList teams={search.teams} byId={byId} />
          </div>
        )}
      </section>
    </div>
  );
}
