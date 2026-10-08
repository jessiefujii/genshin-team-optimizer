"use client";

import { useCallback, useEffect, useState } from "react";
import type { CharacterBuild, UidImport } from "@/types/build";

export interface OwnedEntry {
  constellation: number; // 0-6
  built: boolean;
  hexereiUnlocked?: boolean; // Witch's Homework quest done (Hexerei characters only); unset = not done
  revelationUnlocked?: boolean; // Witch's Revelation quest done (characters who got Stellar Glimmer later); unset = not done
  build?: CharacterBuild; // from a UID import (later also the build editor)
  updatedAt?: string; // ISO time of the last manual edit or import; ticking with defaults doesn't count
}

export type Roster = Record<string, OwnedEntry>;

const STORAGE_KEY = "gto.roster.v1";

function read(): Roster {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Roster) : {};
  } catch {
    return {}; // private mode or corrupted data: start empty
  }
}

function write(roster: Roster) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  } catch {
    // storage unavailable: the roster still works for this visit
  }
}

// Owned characters, saved in this browser. `loaded` stays false until localStorage has been read,
// so the server render and the first client render match.
export function useRoster() {
  const [roster, setRoster] = useState<Roster>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reading localStorage must wait until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoster(read());
    setLoaded(true);
  }, []);

  const update = useCallback((change: (prev: Roster) => Roster) => {
    setRoster((prev) => {
      const next = change(prev);
      write(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (id: string) =>
      update((prev) => {
        const next = { ...prev };
        if (next[id]) delete next[id];
        else next[id] = { constellation: 0, built: true };
        return next;
      }),
    [update],
  );

  const setEntry = useCallback(
    (id: string, entry: Partial<OwnedEntry>) =>
      update((prev) =>
        prev[id] ? { ...prev, [id]: { ...prev[id], ...entry, updatedAt: new Date().toISOString() } } : prev,
      ),
    [update],
  );

  const setMany = useCallback(
    (ids: string[], owned: boolean) =>
      update((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          if (owned) next[id] ??= { constellation: 0, built: true };
          else delete next[id];
        }
        return next;
      }),
    [update],
  );

  const importBuilds = useCallback(
    (imported: UidImport) => update((prev) => mergeImport(prev, imported).roster),
    [update],
  );

  return { roster, loaded, toggle, setEntry, setMany, importBuilds };
}

// Adds imported characters to the roster. A character edited by hand after the import was fetched
// keeps its manual fields (design doc: whichever was updated more recently wins), but still gets
// the imported build if it had none.
export function mergeImport(roster: Roster, imported: UidImport) {
  const next = { ...roster };
  const kept: string[] = [];
  for (const c of imported.characters) {
    const current = next[c.id];
    if (current?.updatedAt && current.updatedAt > imported.fetchedAt) {
      if (!current.build) next[c.id] = { ...current, build: c.build };
      kept.push(c.id);
      continue;
    }
    next[c.id] = { constellation: c.constellation, built: true, build: c.build, updatedAt: imported.fetchedAt };
  }
  return { roster: next, kept };
}
