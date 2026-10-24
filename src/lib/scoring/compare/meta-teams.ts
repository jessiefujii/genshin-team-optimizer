// Ranks the meta teams (#127, design doc Phase 4) in the scorer's best teams, as if the player owned everyone. The real
// roster check (Zibai Premium on Jessie's roster) is roster.compare.test.ts, run with it by `npm run meta`.
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run meta` (in parts, #336).
import { expect, test } from "vitest";
import { hasCarryKit } from "../damage";
import { loadScoringCharacters } from "../load";
import { META_TEAMS } from "../meta-teams";
import { scoreTeam } from "../score";
import { findBestTeams } from "../search";
import { inPart, writePart, type PartRow } from "./report";

const key = (ids: readonly string[]) => [...ids].sort().join("|");
const short = (ids: readonly string[], carry: string) => ids.filter((id) => id !== carry).join(", ");

export function compareMetaTeams(part: number) {
  test(`meta teams vs the scorer's best teams, part ${part}`, { timeout: 900_000 }, () => {
    const all = loadScoringCharacters();
    const byId = new Map(all.map((c) => [c.id, c]));
    const rows: PartRow[] = [];
    META_TEAMS.forEach(({ carry, metaIn, topPick, teams }, index) => {
      if (!inPart(index, part)) return;
      const listed = [topPick, ...teams.filter((t) => key(t) !== key(topPick))];
      for (const t of listed) for (const id of t) expect(byId.has(id), `${id} is not in tags.json`).toBe(true);

      // Same filter as `npm run compare`: only teams where this character is on-field and the main DPS (#96).
      const top = findBestTeams(all, { mustInclude: [carry], limit: 400 })
        .filter((t) => t.onField === carry && t.mainDps === carry)
        .slice(0, 100);
      const rank = (t: readonly string[]) => top.findIndex((s) => key(s.members) === key(t)) + 1 || null;
      const at = (t: readonly string[]) => {
        const s = scoreTeam(t.map((id) => byId.get(id)!));
        const led = s.mainDps && s.mainDps !== carry ? `, main DPS ${s.mainDps}` : "";
        return `${rank(t) ? `#${rank(t)}` : ">100"} (${s.score}${led})`;
      };
      const best = listed.reduce((a, b) => ((rank(a) ?? 999) <= (rank(b) ?? 999) ? a : b));
      const ours = top[0];

      rows.push({
        index,
        found: rank(best) !== null,
        row: [
          carry,
          hasCarryKit(carry) ? "yes" : "no (#137)",
          `${at(topPick)}: ${short(topPick, carry)}`,
          `${at(best)}: ${short(best, carry)}`,
          ours ? `${ours.score}: ${short(ours.members, carry)}` : "(none where they carry)",
          ours ? `${ours.members.filter((id) => topPick.includes(id)).length}/4` : "-",
          metaIn,
        ].join(" | "),
      });
    });
    writePart(
      "meta-teams",
      part,
      [
        "Carry | Damage model | Top pick: rank (score) | Best meta team | Our #1 | #1 overlap with top pick | Meta in",
        "--- | --- | --- | --- | --- | --- | ---",
      ],
      META_TEAMS.length,
      rows,
    );
  });
}
