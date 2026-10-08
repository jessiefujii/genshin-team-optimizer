// Compares the scorer's best teams with the teams build guides recommend (design doc Phase 4).
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run compare`.
import { expect, test } from "vitest";
import { KNOWN_TEAMS } from "./known-teams";
import { loadScoringCharacters } from "./load";
import { scoreTeam } from "./score";
import { findBestTeams } from "./search";

// Every character at benchmark builds, as if the player owned everyone.
const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const key = (ids: readonly string[]) => [...ids].sort().join("|");
const short = (ids: readonly string[], carry: string) => ids.filter((id) => id !== carry).join(", ");

test("guide teams vs the scorer's best teams", { timeout: 300_000 }, () => {
  const rows: string[] = [];
  let found = 0;
  for (const { carry, teams } of KNOWN_TEAMS) {
    for (const t of teams) for (const id of t) expect(byId.has(id), `${id} is not in tags.json`).toBe(true);

    const top = findBestTeams(all, { mustInclude: [carry], limit: 100 });
    const rank = (t: readonly string[]) => top.findIndex((s) => key(s.members) === key(t)) + 1 || null;
    const guide = teams.map((t) => ({ team: t, rank: rank(t), score: scoreTeam(t.map((id) => byId.get(id)!)).score }));
    const bestGuide = guide.reduce((a, b) => ((a.rank ?? 999) <= (b.rank ?? 999) ? a : b));
    const ours = top[0];
    const overlap = ours.members.filter((id) => teams[0].includes(id)).length;
    if (bestGuide.rank) found++;

    rows.push(
      [
        carry,
        `${bestGuide.rank ? `#${bestGuide.rank}` : ">100"} (${bestGuide.score})`,
        short(bestGuide.team, carry),
        `${ours.score}`,
        short(ours.members, carry),
        `${overlap}/4`,
      ].join(" | "),
    );
  }
  console.log(
    [
      "Carry | Best guide team: rank (score) | Guide team | Our #1 score | Our #1 team | #1 overlap with guide's top pick",
      "--- | --- | --- | --- | --- | ---",
      ...rows,
      `\nGuide teams in our top 100: ${found}/${KNOWN_TEAMS.length} carries`,
    ].join("\n"),
  );
});
