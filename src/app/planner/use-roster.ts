"use client";

import { useCallback, useEffect, useState } from "react";

export interface OwnedEntry {
  constellation: number; // 0-6
  built: boolean;
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
      update((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...entry } } : prev)),
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

  return { roster, loaded, toggle, setEntry, setMany };
}
