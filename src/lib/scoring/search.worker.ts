// Runs the team search off the main thread so the page stays responsive on large rosters.
import { findBestTeams, type SearchOptions } from "./search";
import { suggestBuilds, type BuildSuggestion } from "./suggest";
import type { ScoredTeam, ScoringCharacter } from "./types";

export interface SearchRequest {
  id: number;
  roster: ScoringCharacter[];
  options: SearchOptions;
}

// Teams arrive first; build suggestions take a second search and follow in their own message.
export type SearchResponse =
  | { id: number; teams: ScoredTeam[] }
  | { id: number; suggestions: BuildSuggestion[] }
  | { id: number; error: string };

// The DOM lib types `self` as a Window; in a worker it is a DedicatedWorkerGlobalScope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: SearchResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    const teams = findBestTeams(data.roster, data.options);
    scope.postMessage({ id: data.id, teams });
    scope.postMessage({ id: data.id, suggestions: suggestBuilds(data.roster, teams, data.options) });
  } catch (err) {
    scope.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
