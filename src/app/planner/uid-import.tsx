"use client";

import { useEffect, useState } from "react";
import { control } from "@/lib/ui/elements";
import type { UidImport as UidImportResult } from "@/types/build";
import { mergeImport, type Roster } from "./use-roster";

const UID_KEY = "gto.uid.v1";
const LAST_IMPORT_KEY = "gto.lastImport.v1";

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the import still applies for this visit
  }
}

interface Props {
  roster: Roster;
  onImport: (result: UidImportResult) => void;
}

export default function UidImport({ roster, onImport }: Props) {
  const [uid, setUid] = useState("");
  const [last, setLast] = useState<UidImportResult | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "error" | "done"; message?: string }>({
    kind: "idle",
  });

  useEffect(() => {
    // Reading localStorage must wait until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUid(load<string>(UID_KEY) ?? "");
    setLast(load<UidImportResult>(LAST_IMPORT_KEY));
  }, []);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/enka/${encodeURIComponent(uid.trim())}`);
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: body.error ?? `Import failed (${res.status}).` });
        return;
      }
      const result = body as UidImportResult;
      const { kept } = mergeImport(roster, result);
      onImport(result);
      setLast(result);
      save(UID_KEY, result.uid);
      save(LAST_IMPORT_KEY, result);

      const notes = [`Imported ${result.characters.length} characters from ${result.nickname}'s showcase.`];
      if (result.characters.length === 0) notes[0] = "No character details found. Turn on “Show Character Details” in-game.";
      if (kept.length) notes.push(`Kept your newer manual edits for ${kept.join(", ")}.`);
      if (result.unmatched.length) notes.push(`${result.unmatched.length} showcase characters aren't in the app yet.`);
      setStatus({ kind: "done", message: notes.join(" ") });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server." });
    }
  }

  return (
    <section aria-labelledby="import-heading" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h2 id="import-heading" className="text-sm font-semibold">
        Import builds by UID
      </h2>
      <form onSubmit={runImport} className="mt-2 flex flex-wrap gap-2">
        <input
          inputMode="numeric"
          pattern="\d{9,10}"
          placeholder="UID"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          className={`${control} w-36`}
          aria-label="Genshin UID"
          required
        />
        <button
          type="submit"
          disabled={status.kind === "loading"}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60 dark:bg-blue-600"
        >
          {status.kind === "loading" ? "Fetching…" : "Fetch"}
        </button>
        {last && (
          <span className="self-center text-xs text-zinc-500">
            Last fetched {new Date(last.fetchedAt).toLocaleString()}
          </span>
        )}
      </form>
      <p className="mt-1 text-xs text-zinc-500">Imports the up to 12 characters in your in-game showcase.</p>

      {status.message && (
        <p
          className={`mt-2 text-sm ${status.kind === "error" ? "text-red-700 dark:text-red-400" : ""}`}
          aria-live="polite"
        >
          {status.message}
        </p>
      )}

      {last && last.characters.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Character</th>
                <th className="py-1 pr-2 font-medium">ATK</th>
                <th className="py-1 pr-2 font-medium">Crit</th>
                <th className="py-1 pr-2 font-medium">ER</th>
                <th className="py-1 font-medium">EM</th>
              </tr>
            </thead>
            <tbody>
              {last.characters.map(({ id, constellation, build: { stats } }) => (
                <tr key={id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {id} <span className="text-zinc-500">C{constellation}</span>
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{stats.atk}</td>
                  <td className="py-1 pr-2 tabular-nums whitespace-nowrap">
                    {stats.critRate}/{stats.critDmg}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{stats.energyRecharge}%</td>
                  <td className="py-1 tabular-nums">{stats.elementalMastery}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
