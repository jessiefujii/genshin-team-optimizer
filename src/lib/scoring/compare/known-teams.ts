// Compares the scorer's best teams with the teams build guides recommend (design doc Phase 4).
// Kept out of `npm test`: it is a report to read, not a pass/fail check. Run with `npm run compare` (in parts, #336).
import { expect, test } from "vitest";
import { KNOWN_TEAMS } from "../known-teams";
import { loadScoringCharacters } from "../load";
import { scoreTeam } from "../score";
import { findBestTeams } from "../search";
import { inPart, writePart, type PartRow } from "./report";

const key = (ids: readonly string[]) => [...ids].sort().join("|");
const short = (ids: readonly string[], carry: string) => ids.filter((id) => id !== carry).join(", ");

export function compareKnownTeams(part: number) {
  test(`guide teams vs the scorer's best teams, part ${part}`, { timeout: 900_000 }, () => {
    // Every character at benchmark builds, as if the player owned everyone.
    const all = loadScoringCharacters();
    const byId = new Map(all.map((c) => [c.id, c]));
    const rows: PartRow[] = [];
    KNOWN_TEAMS.forEach(({ carry, teams, ranked, constellationTeams = [] }, index) => {
      if (!inPart(index, part)) return;
      for (const t of [...teams, ...constellationTeams.map((c) => c.team)]) for (const id of t) expect(byId.has(id), `${id} is not in tags.json`).toBe(true);

      // Only teams where this character is on-field and the main DPS: a flex DPS (Mavuika) can also be a support in
      // someone else's team, and an off-field DPS who out-damages them makes it that DPS's team (#96).
      const top = findBestTeams(all, { mustInclude: [carry], limit: 400 })
        .filter((t) => t.onField === carry && t.mainDps === carry)
        .slice(0, 100);
      const rank = (t: readonly string[]) => top.findIndex((s) => key(s.members) === key(t)) + 1 || null;
      const guide = teams.map((t) => {
        const s = scoreTeam(t.map((id) => byId.get(id)!));
        return { team: t, rank: rank(t), score: s.score, mainDps: s.mainDps };
      });
      // Teams with a guide's constellation (#106): the search's teams are all C0, so their rank is where their score
      // would place among the top 100.
      for (const { team: t, constellations } of constellationTeams) {
        const s = scoreTeam(t.map((id) => ({ ...byId.get(id)!, constellation: constellations[id] ?? 0 })));
        const above = top.filter((x) => x.score > s.score).length;
        const shown = t.map((id) => (constellations[id] ? `C${constellations[id]} ${id}` : id)) as typeof t;
        guide.push({ team: shown, rank: above < top.length ? above + 1 : null, score: s.score, mainDps: s.mainDps });
      }
      const bestGuide = guide.reduce((a, b) => ((a.rank ?? 999) <= (b.rank ?? 999) ? a : b));
      const ours = top[0];
      const overlap = ours ? ours.members.filter((id) => teams[0].includes(id)).length : 0;
      const led = bestGuide.mainDps && bestGuide.mainDps !== carry ? `, main DPS ${bestGuide.mainDps}` : "";

      rows.push({
        index,
        found: bestGuide.rank !== null,
        row: [
          carry,
          `${bestGuide.rank ? `#${bestGuide.rank}` : ">100"} (${bestGuide.score}${led})`,
          short(bestGuide.team, carry),
          ours ? `${ours.score}` : "-",
          ours ? short(ours.members, carry) : "(none where they are the main DPS)",
          ranked ? `${overlap}/4` : "unranked",
        ].join(" | "),
      });
    });
    writePart(
      "known-teams",
      part,
      [
        "Carry | Best guide team: rank (score) | Guide team | Our #1 score | Our #1 team | #1 overlap with guide's top pick",
        "--- | --- | --- | --- | --- | ---",
      ],
      KNOWN_TEAMS.length,
      rows,
    );
  });
}
