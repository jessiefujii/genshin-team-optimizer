// The compare reports run in parts (#336): vitest runs each test file in its own worker, so `npm run compare` and
// `npm run meta` split their carries over PARTS files (known-teams-1.compare.test.ts …) and each part writes its rows
// to .compare/. scripts/compare-report.mjs prints them as one table, in list order, after the parts finish.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PARTS = 8;

// Every PARTS-th carry from `part` (1-based): neighbors in the list go to different parts, which spreads the slow ones.
export const inPart = (index: number, part: number) => index % PARTS === part - 1;

export interface PartRow {
  index: number; // the carry's place in the list, for the merged table's order
  row: string;
  found: boolean; // a listed team is in our top 100
}

export function writePart(report: string, part: number, header: string[], total: number, rows: PartRow[]) {
  const dir = join(process.cwd(), ".compare");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${report}-${part}.json`), JSON.stringify({ parts: PARTS, header, total, rows }));
}
