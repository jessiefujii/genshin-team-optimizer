import { describe, expect, test } from "vitest";
import { mergeImport } from "../../app/planner/use-roster";
import cryoFixture from "./__fixtures__/traveler-cryo.json";
import fixture from "./__fixtures__/uid-838859790.json";
import { toUidImport } from "./import";
import type { EnkaResponse } from "./types";

// Trimmed from UID 838859790: Raiden, Bennett (C6) and Ayaka, plus an unknown avatar ID.
const imported = toUidImport(fixture as unknown as EnkaResponse, "2026-10-07T10:00:00.000Z");
const byId = new Map(imported.characters.map((c) => [c.id, c]));

describe("toUidImport", () => {
  test("matches characters and reports unknown ones", () => {
    expect([...byId.keys()].sort()).toEqual(["Bennett", "Kamisato Ayaka", "Raiden Shogun"]);
    expect(imported.unmatched).toEqual([19999999]);
  });

  test("reads level, constellation, weapon and sets", () => {
    const raiden = byId.get("Raiden Shogun")!;
    expect(raiden.constellation).toBe(0);
    expect(raiden.build.level).toBe(90);
    expect(raiden.build.weapon).toEqual({ id: '"The Catch"', level: 90, refinement: 5, ascension: 6 });
    expect(raiden.build.ascension).toBe(6);
    expect(raiden.build.artifactSets).toEqual([{ set: "Emblem of Severed Fate", pieces: 4 }]);
    expect(raiden.build.talents).toEqual({ normal: 6, skill: 7, burst: 10 });
  });

  test("reads ascension: level 80 before ascending is phase 5 (#82)", () => {
    expect(byId.get("Kamisato Ayaka")!.build.ascension).toBe(5);
  });

  test("adds the C3 and C5 talent bonus", () => {
    const bennett = byId.get("Bennett")!;
    expect(bennett.constellation).toBe(6);
    expect(bennett.build.talents).toEqual({ normal: 6, skill: 9, burst: 11 }); // base 6 / 6 / 8
  });

  test("uses Enka's skill order when IDs are out of order", () => {
    // Ayaka's IDs: normal 10024, skill 10018, burst 10019, plus her sprint (10013).
    expect(byId.get("Kamisato Ayaka")!.build.talents).toEqual({ normal: 6, skill: 6, burst: 8 });
  });
});

describe("Traveler (Cryo) (#136)", () => {
  // Jessie's Lumine from Enka, 2026-10-12: skill depot 705, which Enka's store doesn't list yet.
  const cryo = toUidImport(cryoFixture as unknown as EnkaResponse, "2026-10-12T00:00:00.000Z");

  test("depot 705 is Traveler (Cryo), with normal, skill and burst in order", () => {
    expect(cryo.unmatched).toEqual([]);
    expect(cryo.characters.map((c) => [c.id, c.constellation])).toEqual([["Traveler (Cryo)", 4]]);
    // skillLevelMap: normal 100554 at 3, skill 10127 at 1, burst 10128 at 6 + 3 from C3.
    expect(cryo.characters[0].build.talents).toEqual({ normal: 3, skill: 1, burst: 9 });
  });
});

describe("mergeImport", () => {
  const raiden = byId.get("Raiden Shogun")!;

  test("replaces entries edited before the import was fetched", () => {
    const { roster, kept } = mergeImport(
      { "Raiden Shogun": { constellation: 2, built: false, updatedAt: "2026-10-01T00:00:00.000Z" } },
      imported,
    );
    expect(kept).toEqual([]);
    expect(roster["Raiden Shogun"]).toMatchObject({ constellation: 0, built: true, build: raiden.build });
  });

  test("a newer manual edit keeps its fields but gains the build", () => {
    const manual = { constellation: 2, built: false, updatedAt: "2026-10-07T11:00:00.000Z" };
    const { roster, kept } = mergeImport({ "Raiden Shogun": manual }, imported);
    expect(kept).toEqual(["Raiden Shogun"]);
    expect(roster["Raiden Shogun"]).toEqual({ ...manual, build: raiden.build });
  });
});
