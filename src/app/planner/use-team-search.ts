"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchOptions } from "@/lib/scoring/search";
import type { SearchRequest, SearchResponse } from "@/lib/scoring/search.worker";
import type { ScoredTeam, ScoringCharacter } from "@/lib/scoring/types";

type SearchState =
  | { status: "idle" | "searching"; teams: ScoredTeam[] }
  | { status: "done"; teams: ScoredTeam[]; ms: number }
  | { status: "error"; teams: ScoredTeam[]; error: string };

const DEBOUNCE_MS = 250;

// Re-runs the search in a Web Worker whenever the roster or options change; stale results are dropped.
export function useTeamSearch(roster: ScoringCharacter[], options: SearchOptions): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle", teams: [] });
  const workerRef = useRef<Worker | null>(null);
  const latest = useRef({ id: 0, started: 0 });

  useEffect(() => {
    const worker = new Worker(new URL("../../lib/scoring/search.worker.ts", import.meta.url));
    worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
      if (data.id !== latest.current.id) return;
      if ("error" in data) {
        setState((s) => ({ status: "error", teams: s.teams, error: data.error }));
      } else {
        setState({ status: "done", teams: data.teams, ms: Math.round(performance.now() - latest.current.started) });
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const key = JSON.stringify({ ids: roster.map((c) => c.id), options });
  useEffect(() => {
    if (roster.length < 4) {
      latest.current.id++; // drop any search still in flight
      return;
    }
    const timer = setTimeout(() => {
      const id = ++latest.current.id;
      latest.current.started = performance.now();
      setState((s) => ({ status: "searching", teams: s.teams }));
      const request: SearchRequest = { id, roster, options };
      workerRef.current?.postMessage(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` captures roster ids and options; the arrays themselves change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return roster.length < 4 ? { status: "idle", teams: [] } : state;
}
