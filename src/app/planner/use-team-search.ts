"use client";

import { useEffect, useRef, useState } from "react";
import { effectKey } from "@/lib/scoring/effects";
import { mergeTop, type SearchOptions } from "@/lib/scoring/search";
import type { SearchRequest, SearchResponse } from "@/lib/scoring/search.worker";
import { pickSuggestions, suggestionGaps, type BuildSuggestion } from "@/lib/scoring/suggest";
import type { ScoredTeam, ScoringCharacter } from "@/lib/scoring/types";

type Results = { teams: ScoredTeam[]; suggestions: BuildSuggestion[] };
type SearchState =
  | ({ status: "idle" | "searching" } & Results)
  | ({ status: "done"; ms: number } & Results)
  | ({ status: "error"; error: string } & Results);

const EMPTY: Results = { teams: [], suggestions: [] };

const DEBOUNCE_MS = 250;

// One worker per spare core, each searching a part of the teams (#215): the main thread keeps one core, at most 4. On a
// 12-thread laptop (i7-1250U: 2 performance + 8 efficiency cores) 4 workers finished the 50-character search in 1.3-2.1 s
// and 8 in 1.8-3.5 s: parts run at the same time slow each other down.
const workerCount = () => Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));

// Re-runs the search in Web Workers whenever the roster or options change; stale results are dropped. Two rounds,
// each split across the workers and merged here: the teams, then the build-suggestion candidates for them.
export function useTeamSearch(roster: ScoringCharacter[], options: SearchOptions): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle", ...EMPTY });
  const workersRef = useRef<Worker[]>([]);
  const latest = useRef({ id: 0, started: 0 });
  // Parts received for the current search and round.
  type Round = "teams" | "rest" | "candidates";
  const parts = useRef<{ id: number; kind: Round; teams: ScoredTeam[][]; more: boolean }>({ id: 0, kind: "teams", teams: [], more: false });
  // `first`: the merged first wave of the regular search, until the rest arrives (search.ts Search).
  const request = useRef<{ roster: ScoringCharacter[]; options: SearchOptions; top: ScoredTeam[]; first: ScoredTeam[] } | null>(null);
  const sendRef = useRef<((id: number, kind: "teams" | "candidates") => void) | null>(null);

  useEffect(() => {
    const send = (id: number, kind: Round, above = -Infinity) => {
      const r = request.current!;
      parts.current = { id, kind, teams: [], more: false };
      workersRef.current.forEach((w, index) => {
        const part = { index, count: workersRef.current.length };
        const message: SearchRequest =
          kind === "teams"
            ? { id, kind, roster: r.roster, options: { ...r.options, part } }
            : kind === "rest"
              ? { id, kind, above }
              : { id, kind, roster: r.roster, top: r.top, options: { ...r.options, part } };
        w.postMessage(message);
      });
    };
    const onMessage = ({ data }: MessageEvent<SearchResponse>) => {
      if (data.id !== latest.current.id) return;
      if (data.kind === "error") {
        setState((s) => ({ ...s, status: "error", error: data.error }));
        return;
      }
      const p = parts.current;
      if (p.id !== data.id || p.kind !== data.kind) return;
      p.teams.push(data.teams);
      if (data.kind === "teams" && data.more) p.more = true;
      if (p.teams.length < workersRef.current.length) return;
      const r = request.current!;
      const limit = r.options.limit ?? 20;
      if (data.kind === "teams" && p.more) {
        // The rest only needs teams that can make the merged list: above its last place, a hair lower so a tie whose
        // ids sort first still gets in, as in the whole search.
        r.first = mergeTop(p.teams, limit);
        send(data.id, "rest", r.first.length === limit ? r.first[limit - 1].score - 1e-9 : -Infinity);
        return;
      }
      if (data.kind === "teams" || data.kind === "rest") {
        // The previous suggestions stay until the new ones arrive.
        r.top = mergeTop(data.kind === "rest" ? [r.first, ...p.teams] : p.teams, limit);
        const ms = Math.round(performance.now() - latest.current.started);
        setState((s) => ({ status: "done", teams: r.top, suggestions: s.suggestions, ms }));
        const gaps = suggestionGaps(r.roster, r.options);
        if (gaps.size === 0) setState((s) => ({ ...s, suggestions: [] }));
        else send(data.id, "candidates");
      } else {
        const candidates = mergeTop(p.teams, limit + r.top.length);
        const suggestions = pickSuggestions(suggestionGaps(r.roster, r.options), candidates, r.top, limit);
        setState((s) => ({ ...s, suggestions }));
      }
    };
    workersRef.current = Array.from({ length: workerCount() }, () => {
      const w = new Worker(new URL("../../lib/scoring/search.worker.ts", import.meta.url));
      w.onmessage = onMessage;
      return w;
    });
    sendRef.current = send;
    return () => workersRef.current.forEach((w) => w.terminate());
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
      request.current = { roster, options, top: [], first: [] };
      sendRef.current?.(id, "teams");
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` captures roster ids, builds, effects and options; the arrays themselves change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return roster.length < 4 ? { status: "idle", ...EMPTY } : state;
}
