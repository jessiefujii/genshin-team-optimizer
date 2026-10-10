"use client";

import { useEffect, useRef, useState } from "react";
import { ascensionOf, isAscensionLevel, levelCap } from "@/lib/build/ascension";
import { control } from "@/lib/ui/elements";
import type { CharacterBuild } from "@/types/build";
import { parseForm, STAT_FIELDS, toForm, type BuildForm } from "./build-form";
import type { BuildCatalog, PlannerCharacter } from "./types";
import type { OwnedEntry } from "./use-roster";

interface Props {
  character: PlannerCharacter;
  entry: OwnedEntry;
  catalog: BuildCatalog;
  onSave: (build: CharacterBuild) => void;
  onClear: () => void;
  onClose: () => void;
}

const field = `${control} w-full`;

// At an ascension level (20, 40, ... 80) the game shows 80/80 before ascending and 80/90 after; base stats
// differ, so the editor asks (#82). Nothing to ask at other levels.
interface AscensionChoiceProps {
  level: string;
  ascended: boolean;
  onChange: (ascended: boolean) => void;
  className: string;
}

function AscensionChoice({ level, ascended, onChange, className }: AscensionChoiceProps) {
  const n = Number(level);
  if (!isAscensionLevel(n)) return null;
  return (
    <label className={className}>
      Ascended?
      <select value={ascended ? "after" : "before"} onChange={(e) => onChange(e.target.value === "after")} className={field}>
        <option value="before">
          {n}/{n}, not yet
        </option>
        <option value="after">
          {n}/{levelCap(ascensionOf(n, true))}, ascended
        </option>
      </select>
    </label>
  );
}
const label = "block text-xs text-zinc-600 dark:text-zinc-400";

// Base ATK from the character's and weapon's levels (genshin-db, on the server, #80). If the lookup fails the
// build is still saved; the scorer then assumes a benchmark weapon's base ATK.
async function fetchBaseAtk(characterId: string, build: CharacterBuild): Promise<number | undefined> {
  const q = new URLSearchParams({
    character: characterId,
    level: String(build.level),
    ascension: String(build.ascension ?? ""),
    weapon: build.weapon.id,
    weaponLevel: String(build.weapon.level),
    weaponAscension: String(build.weapon.ascension ?? ""),
  });
  try {
    const res = await fetch(`/api/base-atk?${q}`);
    return res.ok ? ((await res.json()) as { baseAtk: number }).baseAtk : undefined;
  } catch {
    return undefined;
  }
}

// Modal form for one character's build. Opens pre-filled with the current (imported or saved) build.
export default function BuildEditor({ character, entry, catalog, onSave, onClear, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<BuildForm>(() => toForm(entry.build));
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof BuildForm>(key: K, value: BuildForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setStat = (key: keyof BuildForm["stats"], value: string) =>
    setForm((f) => ({ ...f, stats: { ...f.stats, [key]: value } }));

  const weapons = catalog.weapons[character.weapon] ?? [];
  // Keep a saved weapon selectable even if the catalog no longer lists it.
  const weaponOptions = form.weapon && !weapons.includes(form.weapon) ? [form.weapon, ...weapons] : weapons;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = parseForm(form);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    const { build } = result;
    const baseAtk = await fetchBaseAtk(character.id, build);
    onSave(baseAtk === undefined ? build : { ...build, stats: { ...build.stats, baseAtk } });
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="build-editor-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <form onSubmit={submit} className="space-y-4 p-4" noValidate>
        <div>
          <h2 id="build-editor-title" className="text-lg font-semibold">
            {character.id} build
          </h2>
          <p className="text-xs text-zinc-500">
            {entry.build ? "Editing saves over the imported or saved build." : "No build yet."} Copy final stats from
            the in-game Attributes screen.
          </p>
        </div>

        <fieldset className="grid grid-cols-4 gap-2">
          <legend className="mb-1 text-sm font-medium">Character</legend>
          {(
            [
              ["level", "Level"],
              ["normal", "Normal"],
              ["skill", "Skill"],
              ["burst", "Burst"],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className={label}>
              {text}
              <input inputMode="numeric" value={form[key]} onChange={(e) => set(key, e.target.value)} className={field} />
            </label>
          ))}
          <AscensionChoice
            level={form.level}
            ascended={form.ascended}
            onChange={(v) => set("ascended", v)}
            className={`${label} col-span-4`}
          />
        </fieldset>

        <fieldset className="grid grid-cols-[1fr_5rem_4rem] gap-2">
          <legend className="mb-1 text-sm font-medium">Weapon ({character.weapon})</legend>
          <label className={label}>
            Weapon
            <select value={form.weapon} onChange={(e) => set("weapon", e.target.value)} className={field}>
              <option value="">Pick a weapon…</option>
              {weaponOptions.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Level
            <input
              inputMode="numeric"
              value={form.weaponLevel}
              onChange={(e) => set("weaponLevel", e.target.value)}
              className={field}
            />
          </label>
          <label className={label}>
            Refine
            <select value={form.refinement} onChange={(e) => set("refinement", e.target.value)} className={field}>
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  R{r}
                </option>
              ))}
            </select>
          </label>
          <AscensionChoice
            level={form.weaponLevel}
            ascended={form.weaponAscended}
            onChange={(v) => set("weaponAscended", v)}
            className={`${label} col-span-3`}
          />
        </fieldset>

        <fieldset className="grid grid-cols-[1fr_5rem] gap-2">
          <legend className="mb-1 text-sm font-medium">Artifact sets</legend>
          <label className={label}>
            Set
            <select value={form.set1} onChange={(e) => set("set1", e.target.value)} className={field}>
              <option value="">No set bonus</option>
              {catalog.sets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Pieces
            <select
              value={form.set1Pieces}
              onChange={(e) => set("set1Pieces", e.target.value as BuildForm["set1Pieces"])}
              className={field}
            >
              <option value="4">4pc</option>
              <option value="2">2pc</option>
            </select>
          </label>
          {form.set1 && form.set1Pieces === "2" && (
            <label className={`${label} col-span-2`}>
              Second 2pc set
              <select value={form.set2} onChange={(e) => set("set2", e.target.value)} className={field}>
                <option value="">None</option>
                {catalog.sets.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <legend className="mb-1 text-sm font-medium">Final stats</legend>
          {STAT_FIELDS.map(({ key, label: text, percent }) => (
            <label key={key} className={label}>
              {text}
              {percent ? " (%)" : ""}
              <input
                inputMode="decimal"
                value={form.stats[key]}
                onChange={(e) => setStat(key, e.target.value)}
                className={field}
              />
            </label>
          ))}
        </fieldset>

        {errors.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400" role="alert">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {entry.build ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                onClose();
              }}
              className="text-sm text-red-700 hover:underline dark:text-red-400"
            >
              Remove build
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
            >
              Save build
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
