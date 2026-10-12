// Ranks the meta teams (#127, design doc Phase 4) in the scorer's best teams, as if the player owned everyone.
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run meta`.
import { expect, test } from "vitest";
import { hasCarryKit } from "./damage";
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
  for (const { carry, topPick, teams, unscorable } of META_TEAMS) {
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
      ].join(" | "),
    );
  }
  console.log(
    [
      "Carry | Damage model | Top pick: rank (score) | Best meta team | Our #1 | #1 overlap with top pick | Unscorable",
      "--- | --- | --- | --- | --- | --- | ---",
      ...rows,
      `\nMeta teams in our top 100: ${found}/${scorable} carries with a scorable team (${META_TEAMS.length} meta carries)`,
    ].join("\n"),
  );
});
