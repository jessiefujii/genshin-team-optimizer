"use client";

import { useEffect, useRef, useState } from "react";
import { effectKey } from "@/lib/scoring/effects";
import type { SearchOptions } from "@/lib/scoring/search";
import type { SearchRequest, SearchResponse } from "@/lib/scoring/search.worker";
import type { BuildSuggestion } from "@/lib/scoring/suggest";
import type { ScoredTeam, ScoringCharacter } from "@/lib/scoring/types";

type Results = { teams: ScoredTeam[]; suggestions: BuildSuggestion[] };
type SearchState =
  | ({ status: "idle" | "searching" } & Results)
  | ({ status: "done"; ms: number } & Results)
  | ({ status: "error"; error: string } & Results);

const EMPTY: Results = { teams: [], suggestions: [] };

const DEBOUNCE_MS = 250;

// Re-runs the search in a Web Worker whenever the roster or options change; stale results are dropped.
export function useTeamSearch(roster: ScoringCharacter[], options: SearchOptions): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle", ...EMPTY });
  const workerRef = useRef<Worker | null>(null);
  const latest = useRef({ id: 0, started: 0 });

  useEffect(() => {
    const worker = new Worker(new URL("../../lib/scoring/search.worker.ts", import.meta.url));
    worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
      if (data.id !== latest.current.id) return;
      if ("error" in data) {
        setState((s) => ({ ...s, status: "error", error: data.error }));
      } else if ("suggestions" in data) {
        setState((s) => ({ ...s, suggestions: data.suggestions }));
      } else {
        // The previous suggestions stay until the new ones arrive.
        const ms = Math.round(performance.now() - latest.current.started);
        setState((s) => ({ status: "done", teams: data.teams, suggestions: s.suggestions, ms }));
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const key = JSON.stringify({ roster: roster.map((c) => [c.id, c.stats, c.talents, c.built, c.effects?.map(effectKey)]), options });
  useEffect(() => {
    if (roster.length < 4) {
      latest.current.id++; // drop any search still in flight
      return;
    }
    const timer = setTimeout(() => {
      const id = ++latest.current.id;
      latest.current.started = performance.now();
      setState((s) => ({ status: "searching", teams: s.teams, suggestions: s.suggestions }));
      const request: SearchRequest = { id, roster, options };
      workerRef.current?.postMessage(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` captures roster ids, builds, effects and options; the arrays themselves change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return roster.length < 4 ? { status: "idle", ...EMPTY } : state;
}
