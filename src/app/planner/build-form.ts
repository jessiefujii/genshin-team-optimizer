import type { CharacterBuild, CharacterStats } from "@/types/build";

// The build editor's form state: every field as typed, so half-entered numbers survive re-renders.
export interface BuildForm {
  level: string;
  normal: string;
  skill: string;
  burst: string;
  weapon: string;
  weaponLevel: string;
  refinement: string;
  set1: string;
  set1Pieces: "2" | "4";
  set2: string; // second 2pc set; ignored when set1 is 4pc
  stats: Record<keyof CharacterStats, string>;
}

// `min` is the stat's base value in game, so typing 0.489 for 48.9% is caught. `optional` stats can be left blank.
export const STAT_FIELDS: { key: keyof CharacterStats; label: string; percent: boolean; min: number; optional?: boolean }[] = [
  { key: "hp", label: "Max HP", percent: false, min: 1 },
  { key: "atk", label: "ATK", percent: false, min: 1 },
  { key: "baseAtk", label: "Base ATK", percent: false, min: 1, optional: true },
  { key: "def", label: "DEF", percent: false, min: 1 },
  { key: "elementalMastery", label: "Elemental Mastery", percent: false, min: 0 },
  { key: "critRate", label: "CRIT Rate", percent: true, min: 5 },
  { key: "critDmg", label: "CRIT DMG", percent: true, min: 50 },
  { key: "energyRecharge", label: "Energy Recharge", percent: true, min: 100 },
  { key: "elementalDmgBonus", label: "Elemental DMG Bonus", percent: true, min: 0 },
];

export function toForm(build: CharacterBuild | undefined): BuildForm {
  const [first, second] = build?.artifactSets ?? [];
  const stats = Object.fromEntries(
    STAT_FIELDS.map(({ key }) => [key, String(build?.stats[key] ?? "")]),
  ) as BuildForm["stats"];
  return {
    level: String(build?.level ?? 90),
    normal: String(build?.talents.normal ?? 1),
    skill: String(build?.talents.skill ?? 1),
    burst: String(build?.talents.burst ?? 1),
    weapon: build?.weapon.id ?? "",
    weaponLevel: String(build?.weapon.level ?? 90),
    refinement: String(build?.weapon.refinement ?? 1),
    set1: first?.set ?? "",
    set1Pieces: first?.pieces === 2 ? "2" : "4",
    set2: second?.set ?? "",
    stats,
  };
}

const RANGES = {
  level: [1, 100],
  talent: [1, 15], // up to 10 base + 3 from C3/C5 + 2 from some passives
  weaponLevel: [1, 100],
  refinement: [1, 5],
} as const;

// A whole number in [min, max], or an error message.
function int(value: string, label: string, [min, max]: readonly [number, number]): number | string {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : `${label} must be a whole number from ${min} to ${max}.`;
}

// Turns the form into a build, or lists what is wrong with it. Percent stats are typed as shown in
// game (48.9 for 48.9%), which is also how they are stored.
export function parseForm(form: BuildForm): { build: CharacterBuild } | { errors: string[] } {
  const errors: string[] = [];
  const check = (v: number | string) => (typeof v === "string" ? (errors.push(v), 0) : v);

  const level = check(int(form.level, "Level", RANGES.level));
  const talents = {
    normal: check(int(form.normal, "Normal Attack level", RANGES.talent)),
    skill: check(int(form.skill, "Elemental Skill level", RANGES.talent)),
    burst: check(int(form.burst, "Elemental Burst level", RANGES.talent)),
  };
  if (!form.weapon) errors.push("Pick a weapon.");
  const weapon = {
    id: form.weapon,
    level: check(int(form.weaponLevel, "Weapon level", RANGES.weaponLevel)),
    refinement: check(int(form.refinement, "Refinement", RANGES.refinement)),
  };

  const artifactSets: CharacterBuild["artifactSets"] = [];
  if (form.set1) artifactSets.push({ set: form.set1, pieces: form.set1Pieces === "4" ? 4 : 2 });
  if (form.set1 && form.set1Pieces === "2" && form.set2) {
    if (form.set2 === form.set1) errors.push("Two 2-piece sets must be different; pick 4-piece instead.");
    else artifactSets.push({ set: form.set2, pieces: 2 });
  }

  const stats = {} as CharacterStats;
  for (const { key, label, percent, min, optional } of STAT_FIELDS) {
    const raw = form.stats[key].trim().replace(/%$/, "");
    const n = Number(raw);
    if (raw === "" && optional) continue;
    if (raw === "" || !Number.isFinite(n)) {
      errors.push(`${label} is required.`);
    } else if (n < min) {
      errors.push(`${label} can't be below ${min}${percent ? "%; type it as shown in game, e.g. 48.9" : ""}.`);
    } else {
      stats[key] = percent ? Math.round(n * 10) / 10 : Math.round(n);
    }
  }

  return errors.length > 0 ? { errors } : { build: { level, talents, weapon, artifactSets, stats } };
}
