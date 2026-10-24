// Merges the parts of a compare report (#336, src/lib/scoring/compare/report.ts) into one table.
// `node scripts/compare-report.mjs clear <report>` deletes old parts before a run; `print <report>` prints the table
// and fails if a part is missing (a part that failed or timed out).
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [command, report] = process.argv.slice(2);
const dir = join(process.cwd(), ".compare");
const partFiles = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${report}-`) && f.endsWith(".json")) : []);

if (command === "clear") {
  for (const f of partFiles()) rmSync(join(dir, f));
} else if (command === "print") {
  const parts = partFiles().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const expected = parts[0]?.parts ?? 0;
  if (!parts.length || parts.length !== expected) {
    console.error(`${report}: ${parts.length} of ${expected || "?"} parts in .compare/; a part failed or didn't run`);
    process.exit(1);
  }
  const rows = parts.flatMap((p) => p.rows).sort((a, b) => a.index - b.index);
  const found = rows.filter((r) => r.found).length;
  const label = report === "meta-teams" ? "Meta teams" : "Guide teams";
  console.log([...parts[0].header, ...rows.map((r) => r.row), `\n${label} in our top 100: ${found}/${parts[0].total} carries`].join("\n"));
} else {
  console.error("usage: node scripts/compare-report.mjs clear|print <known-teams|meta-teams>");
  process.exit(1);
}
