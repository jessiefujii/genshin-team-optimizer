// Runs one part of the team search off the main thread (#215): the planner starts one worker per spare CPU core, gives
// each a part (SearchOptions.part), and merges their results (use-team-search.ts), the same teams as one whole search.
import { findBestTeams, type SearchOptions } from "./search";
import { suggestionCandidates } from "./suggest";
import type { ScoredTeam, ScoringCharacter } from "./types";

// `teams`: this part of the regular search. `candidates`: this part of the build-suggestion search, for the merged
// regular result `top` (suggest.ts pickSuggestions then runs on the merge).
export type SearchRequest =
  | { id: number; kind: "teams"; roster: ScoringCharacter[]; options: SearchOptions }
  | { id: number; kind: "candidates"; roster: ScoringCharacter[]; top: ScoredTeam[]; options: SearchOptions };

export type SearchResponse =
  | { id: number; kind: "teams" | "candidates"; teams: ScoredTeam[] }
  | { id: number; kind: "error"; error: string };

// The DOM lib types `self` as a Window; in a worker it is a DedicatedWorkerGlobalScope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: SearchResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    const teams = data.kind === "teams" ? findBestTeams(data.roster, data.options) : suggestionCandidates(data.roster, data.top, data.options);
    scope.postMessage({ id: data.id, kind: data.kind, teams });
  } catch (err) {
    scope.postMessage({ id: data.id, kind: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
