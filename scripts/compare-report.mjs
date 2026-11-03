// Merges the parts of a compare report (#336, src/lib/scoring/compare/report.ts) into one table.
// `node scripts/compare-report.mjs clear <report>` deletes old parts before a run; `print <report>` prints the table
// and fails if a part is missing (a part that failed or timed out), and records the run in data/compare-history.json
// (#409), which the Model quality page (#406) reads.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [command, report] = process.argv.slice(2);
const dir = join(process.cwd(), ".compare");
const partFiles = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${report}-`) && f.endsWith(".json")) : []);

// One entry per report and commit: printing a run again replaces its entry. `dirty`: the run had uncommitted changes.
function record(report, found, total, columns, rows) {
  const file = join(process.cwd(), "data", "compare-history.json");
  const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
  const commit = git("rev-parse --short HEAD");
  const entry = {
    report,
    commit,
    dirty: git("status --porcelain --untracked-files=no -- src data/kit.json data/tags.json").length > 0,
    date: new Date().toISOString().slice(0, 10),
    found,
    total,
    columns,
    rows: rows.map((r) => ({ carry: r.row.split(" | ")[0], found: r.found, row: r.row })),
  };
  const history = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const kept = history.filter((e) => e.report !== report || e.commit !== commit);
  writeFileSync(file, `${JSON.stringify([...kept, entry], null, 2)}\n`);
}

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
  record(report, found, parts[0].total, parts[0].header[0], rows);
} else {
  console.error("usage: node scripts/compare-report.mjs clear|print <known-teams|meta-teams>");
  process.exit(1);
}
