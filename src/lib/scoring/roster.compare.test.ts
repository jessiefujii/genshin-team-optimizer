// Jessie's best owned team, Zibai Premium, should be #1 or close (#127): the quick check after a scoring change (design
// doc Phase 4: every PR runs npm test and reads the reference diff; this takes seconds (6 s on 697dc76), the full compares ~40 min).
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run roster` (also in `npm run meta`).
import { expect, test } from "vitest";
import jessieRoster from "../../../data/test-rosters/jessie.json";
import type { CharacterBuild } from "../../types/build";
import { characterEffects } from "./effects";
import { loadScoringCharacters } from "./load";
import { scoreTeam } from "./score";
import { findBestTeams } from "./search";

const all = loadScoringCharacters();
const key = (ids: readonly string[]) => [...ids].sort().join("|");
const short = (ids: readonly string[], carry: string) => ids.filter((id) => id !== carry).join(", ");

// data/test-rosters/jessie.json: Jessie's roster as the planner stores it (gto.roster.v1), built 2026-10-12 from eight
// Enka showcases (UID left out), her saved builds for Zhongli and Escoffier, and her list of what she owns and has
// built (Jessie: level 60 and below isn't built). Her Traveler is Cryo (#136).
// Builds feed the scorer as in the planner (roster-planner.tsx `owned`).
const roster = jessieRoster as Record<string, { constellation: number; built: boolean; build?: CharacterBuild }>;
const owned = all
  .filter((c) => roster[c.id])
  .map((c) => {
    const { build, constellation, built } = roster[c.id];
    return { ...c, stats: build?.stats, talents: build?.talents, built, effects: characterEffects(c.id, constellation, build) };
  });

test("Jessie's roster: Zibai Premium near the top", { timeout: 900_000 }, () => {
  expect(owned.length, "every roster id is in tags.json").toBe(Object.keys(roster).length);
  const premium = ["Zibai", "Columbina", "Illuga", "Linnea"];
  const started = performance.now();
  const top = findBestTeams(owned, { limit: 20 });
  const seconds = Math.round((performance.now() - started) / 1000);
  const rank = top.findIndex((s) => key(s.members) === key(premium)) + 1;
  const own = scoreTeam(premium.map((id) => owned.find((c) => c.id === id)!)).score;
  console.log(
    [
      `Jessie's roster (${owned.length}, searched in ${seconds}s): Zibai Premium (${short(premium, "Zibai")}) ${rank ? `#${rank}` : ">20"}, ${own.toFixed(1)} (#20: ${top[top.length - 1]?.score.toFixed(1)})`,
      ...top.slice(0, 5).map((t, i) => `#${i + 1} ${t.score.toFixed(1)}: ${t.members.join(", ")} (main DPS ${t.mainDps})`),
    ].join("\n"),
  );
});
