// Ranks the meta teams (#127, design doc Phase 4) in the scorer's best teams, as if the player owned everyone, then
// checks a real roster: Jessie's best owned team, Zibai Premium, should be #1 or close (#127).
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run meta`.
import { expect, test } from "vitest";
import jessieRoster from "../../../data/test-rosters/jessie.json";
import type { CharacterBuild } from "../../types/build";
import { hasCarryKit } from "./damage";
import { characterEffects } from "./effects";
import { loadScoringCharacters } from "./load";
import { META_TEAMS } from "./meta-teams";
import { scoreTeam } from "./score";
import { findBestTeams } from "./search";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const key = (ids: readonly string[]) => [...ids].sort().join("|");
const short = (ids: readonly string[], carry: string) => ids.filter((id) => id !== carry).join(", ");

test("meta teams vs the scorer's best teams", { timeout: 300_000 }, () => {
  const rows: string[] = [];
  let found = 0;
  let scorable = 0;
  for (const { carry, metaIn, topPick, teams, unscorable } of META_TEAMS) {
    const listed = topPick ? [topPick, ...teams.filter((t) => key(t) !== key(topPick))] : teams;
    for (const t of listed) for (const id of t) expect(byId.has(id), `${id} is not in tags.json`).toBe(true);

    // Same filter as `npm run compare`: only teams this character carries.
    const top = findBestTeams(all, { mustInclude: [carry], limit: 400 }).filter((t) => t.carry === carry).slice(0, 100);
    const rank = (t: readonly string[]) => top.findIndex((s) => key(s.members) === key(t)) + 1 || null;
    const at = (t: readonly string[]) => {
      const s = scoreTeam(t.map((id) => byId.get(id)!));
      const led = s.carry && s.carry !== carry ? `, carry ${s.carry}` : "";
      return `${rank(t) ? `#${rank(t)}` : ">100"} (${s.score}${led})`;
    };
    const best = listed.reduce<readonly string[] | null>((a, b) => (a && (rank(a) ?? 999) <= (rank(b) ?? 999) ? a : b), null);
    if (listed.length) scorable++;
    if (best && rank(best)) found++;
    const ours = top[0];

    rows.push(
      [
        carry,
        hasCarryKit(carry) ? "yes" : "no (#137)",
        topPick ? `${at(topPick)}: ${short(topPick, carry)}` : "-",
        best ? `${at(best)}: ${short(best, carry)}` : "-",
        ours ? `${ours.score}: ${short(ours.members, carry)}` : "(none where they carry)",
        ours && topPick ? `${ours.members.filter((id) => topPick.includes(id)).length}/4` : "-",
        unscorable.length ? `${unscorable.length} (#136)` : "",
        metaIn,
      ].join(" | "),
    );
  }
  console.log(
    [
      "Carry | Damage model | Top pick: rank (score) | Best meta team | Our #1 | #1 overlap with top pick | Unscorable | Meta in",
      "--- | --- | --- | --- | --- | --- | --- | ---",
      ...rows,
      `\nMeta teams in our top 100: ${found}/${scorable} carries with a scorable team (${META_TEAMS.length} meta carries)`,
    ].join("\n"),
  );
});

// data/test-rosters/jessie.json: Jessie's roster as the planner stores it (gto.roster.v1), built 2026-10-12 from her
// Enka showcase (12 characters, UID left out) plus her saved builds for the 6 not showcased then (Zhongli, Raiden,
// Escoffier, Bennett, Neuvillette, Flins). Her Traveler is Cryo, which the import can't map yet (#136), so left out.
// Builds feed the scorer as in the planner (roster-planner.tsx `owned`).
const roster = jessieRoster as Record<string, { constellation: number; built: boolean; build?: CharacterBuild }>;
const owned = all
  .filter((c) => roster[c.id])
  .map((c) => {
    const { build, constellation, built } = roster[c.id];
    return { ...c, stats: build?.stats, talents: build?.talents, built, effects: characterEffects(c.id, constellation, build) };
  });

test("Jessie's roster: Zibai Premium near the top", { timeout: 300_000 }, () => {
  expect(owned.length, "every roster id is in tags.json").toBe(Object.keys(roster).length);
  const premium = ["Zibai", "Columbina", "Illuga", "Linnea"];
  const top = findBestTeams(owned, { limit: 20 });
  const rank = top.findIndex((s) => key(s.members) === key(premium)) + 1;
  console.log(
    [
      `Jessie's roster (${owned.length}): Zibai Premium (${short(premium, "Zibai")}) ${rank ? `#${rank}` : ">20"}`,
      ...top.slice(0, 5).map((t, i) => `#${i + 1} ${t.score}: ${t.members.join(", ")} (carry ${t.carry})`),
    ].join("\n"),
  );
});
