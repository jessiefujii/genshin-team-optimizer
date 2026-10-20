// Runs one part of the team search off the main thread (#215): the planner starts one worker per spare CPU core, gives
// each a part (SearchOptions.part), and merges their results (use-team-search.ts), the same teams as one whole search.
import { startSearch, type Search, type SearchOptions } from "./search";
import { suggestionCandidates } from "./suggest";
import type { ScoredTeam, ScoringCharacter } from "./types";

// `teams`: this part of the regular search, its first wave of carries (search.ts Search); `more` says whether the rest
// can follow. `rest`: the rest of that search's carries, above the merged first wave's last place. `candidates`: this
// part of the build-suggestion search, for the merged regular result `top` (suggest.ts pickSuggestions then runs on the
// merge).
export type SearchRequest =
  | { id: number; kind: "teams"; roster: ScoringCharacter[]; options: SearchOptions }
  | { id: number; kind: "rest"; above: number }
  | { id: number; kind: "candidates"; roster: ScoringCharacter[]; top: ScoredTeam[]; options: SearchOptions };

export type SearchResponse =
  | { id: number; kind: "teams"; teams: ScoredTeam[]; more: boolean }
  | { id: number; kind: "rest" | "candidates"; teams: ScoredTeam[] }
  | { id: number; kind: "error"; error: string };

// The DOM lib types `self` as a Window; in a worker it is a DedicatedWorkerGlobalScope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: SearchResponse): void;
};

// The latest regular search, kept for its `rest` wave.
let current: { id: number; search: Search } | null = null;

scope.onmessage = ({ data }) => {
  try {
    if (data.kind === "teams") {
      const search = startSearch(data.roster, data.options);
      current = { id: data.id, search };
      const teams = search.waves ? search.next(1) : search.next();
      scope.postMessage({ id: data.id, kind: "teams", teams, more: search.waves });
    } else if (data.kind === "rest") {
      if (current?.id !== data.id) return; // a newer search replaced it
      scope.postMessage({ id: data.id, kind: "rest", teams: current.search.next(Infinity, data.above) });
    } else {
      scope.postMessage({ id: data.id, kind: "candidates", teams: suggestionCandidates(data.roster, data.top, data.options) });
    }
  } catch (err) {
    scope.postMessage({ id: data.id, kind: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
