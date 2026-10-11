import { describe, expect, test } from "vitest";
import { loadScoringCharacters } from "./load";
import { generateRotation } from "./rotation";
import { scoreTeam } from "./score";

const all = loadScoringCharacters();
const team = (...ids: string[]) => ids.map((id) => all.find((c) => c.id === id)!);
const flat = (steps: { character: string; action: string }[]) => steps.map((s) => `${s.character} ${s.action}`);

describe("generateRotation", () => {
  test("setup first (longest effect first), then buffers (shortest buff last), then the carry", () => {
    const steps = generateRotation(team("Hu Tao", "Kaedehara Kazuha", "Xingqiu", "Bennett"), "Hu Tao");
    expect(flat(steps)).toEqual([
      "Xingqiu Q", "Xingqiu E",
      "Bennett Q", "Bennett E", // 12 s buff
      "Kaedehara Kazuha E", "Kaedehara Kazuha plunge", "Kaedehara Kazuha Q", // 8 s: last before the carry
      "Hu Tao E", "Hu Tao N2C x7", "Hu Tao Q",
    ]);
  });

  test("among setup, the longer-lasting effect goes first", () => {
    const steps = flat(generateRotation(team("Hu Tao", "Xingqiu", "Zhongli", "Yelan"), "Hu Tao"));
    expect(steps.indexOf("Zhongli hold E")).toBeLessThan(steps.indexOf("Yelan E")); // 20 s before 15 s
    expect(steps.indexOf("Yelan Q")).toBeLessThan(steps.indexOf("Xingqiu Q")); // no duration: last
  });

  test("a second main DPS supports with skill and burst only", () => {
    const steps = generateRotation(team("Hu Tao", "Raiden Shogun", "Xingqiu", "Zhongli"), "Hu Tao");
    expect(steps.filter((s) => s.character === "Raiden Shogun").map((s) => s.action)).toEqual(["E", "Q"]);
    expect(steps.slice(-3).map((s) => s.character)).toEqual(["Hu Tao", "Hu Tao", "Hu Tao"]);
  });

  test("no carry: everyone's own actions, carries last", () => {
    const steps = generateRotation(team("Xingqiu", "Bennett", "Zhongli", "Sucrose"), null);
    expect(new Set(steps.map((s) => s.character))).toEqual(new Set(["Xingqiu", "Bennett", "Zhongli", "Sucrose"]));
  });
});

test("scored teams carry their rotation, ending with the chosen carry", () => {
  const scored = scoreTeam(team("Hu Tao", "Xingqiu", "Yelan", "Zhongli"));
  expect(scored.rotation.at(-1)).toEqual({ character: "Hu Tao", action: "Q" });
});
