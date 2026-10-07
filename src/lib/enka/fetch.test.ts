import { describe, expect, test } from "vitest";
import { parseUid } from "./fetch";

describe("parseUid", () => {
  test("accepts 9 and 10 digit UIDs", () => {
    expect(parseUid("618285856")).toBe("618285856");
    expect(parseUid("1801234567")).toBe("1801234567");
  });

  test("rejects anything else", () => {
    for (const bad of ["", "12345678", "12345678901", "61828585a", " 618285856", "../618285856"]) {
      expect(parseUid(bad)).toBeNull();
    }
  });
});
