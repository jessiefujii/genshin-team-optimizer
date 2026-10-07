import { cacheLife } from "next/cache";
import type { EnkaResponse } from "./types";

// Enka asks for a descriptive User-Agent so they can contact the app's owner.
const USER_AGENT = "genshin-team-optimizer/0.1 (personal team planner)";

// Game UIDs are 9 digits (10 on some newer accounts).
export function parseUid(raw: string): string | null {
  return /^\d{9,10}$/.test(raw) ? raw : null;
}

// Enka's documented status codes, as messages the UI can show.
export const ENKA_ERRORS: Record<number, string> = {
  400: "That UID has the wrong format.",
  404: "No player has that UID.",
  424: "Enka is down for game maintenance. Try again after the patch.",
  429: "Too many requests to Enka. Wait a minute and try again.",
  500: "Enka had a server error. Try again later.",
  503: "Enka is temporarily unavailable. Try again later.",
};

export type EnkaResult =
  | { ok: true; data: EnkaResponse; fetchedAt: string }
  | { ok: false; status: number; message: string };

// One cached fetch per UID. Successes stay cached for Enka's `ttl`, so repeat imports never hit
// their rate limit; errors are cached for a minute so a retry loop can't hammer them either.
export async function fetchEnkaProfile(uid: string): Promise<EnkaResult> {
  "use cache";

  let res: Response;
  try {
    res = await fetch(`https://enka.network/api/uid/${uid}`, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch {
    cacheLife({ revalidate: 60, expire: 120 });
    return { ok: false, status: 502, message: "Could not reach Enka. Check your connection." };
  }

  if (!res.ok) {
    cacheLife({ revalidate: 60, expire: 120 });
    const message = ENKA_ERRORS[res.status] ?? `Enka returned an unexpected error (${res.status}).`;
    return { ok: false, status: res.status, message };
  }

  const data = (await res.json()) as EnkaResponse;
  // `expire` just past `ttl`: once Enka allows a refresh, the next import waits for fresh data
  // instead of being served the old profile.
  const ttl = Math.max(data.ttl ?? 60, 60);
  cacheLife({ revalidate: ttl, expire: ttl + 60 });
  return { ok: true, data, fetchedAt: new Date().toISOString() };
}
