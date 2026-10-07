"use client";

import { useMemo, useState } from "react";
import { ELEMENTS } from "@/types/tags";
import { control, elementChip } from "@/lib/ui/elements";
import type { PlannerCharacter } from "./types";
import type { OwnedEntry, Roster } from "./use-roster";

const WEAPONS = ["Sword", "Claymore", "Polearm", "Bow", "Catalyst"];

interface Props {
  characters: PlannerCharacter[];
  roster: Roster;
  onToggle: (id: string) => void;
  onSetEntry: (id: string, entry: Partial<OwnedEntry>) => void;
  onSetMany: (ids: string[], owned: boolean) => void;
}

export default function RosterGrid({ characters, roster, onToggle, onSetEntry, onSetMany }: Props) {
  const [search, setSearch] = useState("");
  const [element, setElement] = useState("");
  const [weapon, setWeapon] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return characters.filter(
      (c) =>
        (!q || c.id.toLowerCase().includes(q)) &&
        (!element || c.element === element) &&
        (!weapon || c.weapon === weapon) &&
        (!ownedOnly || roster[c.id]),
    );
  }, [characters, search, element, weapon, ownedOnly, roster]);

  const ownedCount = Object.keys(roster).length;

  return (
    <section aria-labelledby="roster-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="roster-heading" className="text-lg font-semibold">
          My roster
        </h2>
        <span className="text-sm text-zinc-500">{ownedCount} owned</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${control} w-full sm:w-40`}
        />
        <select value={element} onChange={(e) => setElement(e.target.value)} className={control} aria-label="Element">
          <option value="">All elements</option>
          {ELEMENTS.map((el) => (
            <option key={el}>{el}</option>
          ))}
        </select>
        <select value={weapon} onChange={(e) => setWeapon(e.target.value)} className={control} aria-label="Weapon">
          <option value="">All weapons</option>
          {WEAPONS.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
          Owned only
        </label>
      </div>
      <div className="mt-2 flex gap-3 text-sm">
        <button type="button" className="text-blue-700 hover:underline dark:text-blue-400" onClick={() => onSetMany(visible.map((c) => c.id), true)}>
          Own all shown ({visible.length})
        </button>
        <button type="button" className="text-blue-700 hover:underline dark:text-blue-400" onClick={() => onSetMany(visible.map((c) => c.id), false)}>
          Clear all shown
        </button>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((c) => {
          const owned = roster[c.id];
          return (
            <li
              key={c.id}
              className={`rounded-lg border p-2 ${
                owned
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(c.id)}
                aria-pressed={!!owned}
                className="w-full text-left"
              >
                <span className="block truncate text-sm font-medium">{c.id}</span>
                <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                  <span className={elementChip(c.element)}>{c.element}</span>
                  {c.rarity}★
                </span>
              </button>
              {owned && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <select
                    value={owned.constellation}
                    onChange={(e) => onSetEntry(c.id, { constellation: Number(e.target.value) })}
                    className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                    aria-label={`${c.id} constellation`}
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        C{n}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={owned.built}
                      onChange={(e) => onSetEntry(c.id, { built: e.target.checked })}
                    />
                    Built
                  </label>
                  {owned.build && (
                    <span className="text-zinc-500" title="Build imported from your UID">
                      Lv{owned.build.level}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
