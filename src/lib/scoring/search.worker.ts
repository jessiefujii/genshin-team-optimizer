// Runs the team search off the main thread so the page stays responsive on large rosters.
import { findBestTeams, type SearchOptions } from "./search";
import type { ScoredTeam, ScoringCharacter } from "./types";

export interface SearchRequest {
  id: number;
  roster: ScoringCharacter[];
  options: SearchOptions;
}

export type SearchResponse = { id: number; teams: ScoredTeam[] } | { id: number; error: string };

// The DOM lib types `self` as a Window; in a worker it is a DedicatedWorkerGlobalScope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: SearchResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, teams: findBestTeams(data.roster, data.options) });
  } catch (err) {
    scope.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
