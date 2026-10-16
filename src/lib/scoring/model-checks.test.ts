// Model checks (#201): rules every team must obey, tested on hundreds of teams before any guide team is compared
// (design doc, "Model checks before any compare"). A failure names the team, the member and the rule.
// A check the scorer can't pass yet is a `test.fails` naming the issue that fixes it: when the fix lands, the test
// starts passing, vitest reports that as a failure, and it becomes a plain `test`.
import { describe, expect, test } from "vitest";
import kitJson from "../../../data/kit.json";
import particlesJson from "../../../data/particles.json";
import referenceJson from "../../../data/team-reference.json";
import jessieRoster from "../../../data/test-rosters/jessie.json";
import type { CharacterBuild } from "../../types/build";
import { carryDamage, hasCarryKit } from "./damage";
import { erTargetOf } from "./energy";
import { kitBuffValue, teamBuffStats } from "./kit";
import { characterEffects } from "./effects";
import { KNOWN_TEAMS } from "./known-teams";
import { loadScoringCharacters } from "./load";
import { META_TEAMS } from "./meta-teams";
import { scoreTeam, teamScore } from "./score";
import type { ScoredTeam, ScoringCharacter } from "./types";

const all = loadScoringCharacters();
const byId = new Map(all.map((c) => [c.id, c]));
const SUB_DPS = kitJson.subDps as Record<string, { sources: Record<string, unknown>[] }>;
const key = (ids: readonly string[]) => [...ids].sort().join("|");

// A fixed pseudo-random sequence (mulberry32), so the sampled teams are the same on every run.
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleTeams(pool: readonly ScoringCharacter[], count: number, seed: number): ScoringCharacter[][] {
  const next = random(seed);
  const out = new Map<string, ScoringCharacter[]>();
  while (out.size < count) {
    const picked = new Set<ScoringCharacter>();
    while (picked.size < 4) picked.add(pool[Math.floor(next() * pool.length)]);
    out.set(key([...picked].map((c) => c.id)), [...picked]);
  }
  return [...out.values()];
}

// The guide and meta teams, plus 600 sampled from every character at benchmark builds.
const guideTeams = new Map<string, ScoringCharacter[]>();
for (const ids of [...KNOWN_TEAMS.flatMap((k) => k.teams), ...META_TEAMS.flatMap((m) => [m.topPick, ...m.teams])]) {
  guideTeams.set(key(ids), ids.map((id) => byId.get(id)!));
}
const teams = [...guideTeams.values(), ...sampleTeams(all, 600, 201)];
const scored = teams.map((t) => ({ team: t, s: scoreTeam(t) }));
const names = (t: readonly ScoringCharacter[]) => t.map((m) => m.id).join(", ");

// Jessie's roster with her imported builds (as meta-teams.compare.test.ts reads it), for checks that change stats.
const roster = jessieRoster as Record<string, { constellation: number; built: boolean; build?: CharacterBuild }>;
const built = all
  .filter((c) => roster[c.id]?.build?.stats)
  .map((c) => {
    const { build, constellation } = roster[c.id];
    return { ...c, stats: build!.stats, talents: build!.talents, effects: characterEffects(c.id, constellation, build) };
  });

describe("coverage gate", () => {
  // #203 brings both to 0. Until then they may only shrink: a new character without a damage profile fails here.
  const NO_DAMAGE_PROFILE = 27;
  const MAIN_DPS_WITHOUT_CARRY_KIT = 28;
  const NO_PARTICLE_COUNT = 5;
  const NO_SUSTAIN_COVERAGE = 5;

  test("every character has a damage profile (#203)", () => {
    const missing = all.filter((c) => !hasCarryKit(c.id) && !(c.id in SUB_DPS)).map((c) => c.id);
    expect(missing.length, `no carry kit or sub-DPS entry: ${missing.join(", ")}`).toBeLessThanOrEqual(NO_DAMAGE_PROFILE);
  });

  test("every main DPS has a carry kit (#137, #203)", () => {
    const missing = all.filter((c) => c.roles.includes("main-dps") && !hasCarryKit(c.id)).map((c) => c.id);
    expect(missing.length, `main DPS with no carry kit: ${missing.join(", ")}`).toBeLessThanOrEqual(MAIN_DPS_WITHOUT_CARRY_KIT);
  });

  // Members with an Energy Burst and a guide ER target need a particle count (#198); without one they count as a
  // standard teammate. Today: Ineffa, Varesa, Vesna, Vodyanitsa, Traveler (Cryo) (no wiki count).
  test("every Energy-Burst character has a particle count (#198)", () => {
    const PARTICLES = (particlesJson as { characters: Record<string, unknown> }).characters;
    const missing = all.filter((c) => c.burstCost && erTargetOf(c) !== undefined && !(c.id in PARTICLES)).map((c) => c.id);
    expect(missing.length, `no particle count: ${missing.join(", ")}`).toBeLessThanOrEqual(NO_PARTICLE_COUNT);
  });

  // Healers and shielders need a sustain entry with a coverage (#192); without a duration they count as full.
  // Today: Alyosha, Beidou, Ifa, Jean, Sigewinne.
  test("every healer and shielder has a sustain coverage (#192, #208)", () => {
    const SUSTAIN = kitJson.sustain as Record<string, { coverage: number | null }>;
    const sustainers = all.filter((c) => c.roles.includes("healer") || c.roles.includes("shielder"));
    const missing = sustainers.filter((c) => SUSTAIN[c.id]?.coverage == null).map((c) => c.id);
    expect(missing.length, `no sustain coverage: ${missing.join(", ")}`).toBeLessThanOrEqual(NO_SUSTAIN_COVERAGE);
  });
});

describe("physical bounds", () => {
  type KitBuff = { uptime: number | null; duration: number | null; cd: number | null; value: number };
  const characters = kitJson.characters as unknown as Record<string, { buffs: KitBuff[] }>;

  // A passive whose uptime the code reads from its trigger has uptime and cd null (Baizhu, Nahida, Xianyun...).
  test("kit buffs: uptime in [0, 1], duration and value not negative, cooldown above 0", () => {
    const bad: string[] = [];
    for (const [id, c] of Object.entries(characters)) {
      for (const b of c.buffs) {
        if (b.uptime !== null && !(b.uptime >= 0 && b.uptime <= 1)) bad.push(`${id}: uptime ${b.uptime}`);
        if (b.duration !== null && b.duration < 0) bad.push(`${id}: duration ${b.duration}`);
        if (b.value < 0) bad.push(`${id}: value ${b.value}`);
        if (b.cd !== null && !(b.cd > 0)) bad.push(`${id}: cd ${b.cd}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("sub-DPS sources: cooldown above 0, hits and rates positive, a field no longer than its cooldown allows", () => {
    const bad: string[] = [];
    for (const [id, e] of Object.entries(SUB_DPS)) {
      for (const s of e.sources as { label: string; cd: number; hits?: number; every?: number; duration?: number }[]) {
        if (!(s.cd > 0)) bad.push(`${id} ${s.label}: cd ${s.cd}`);
        if (s.hits !== undefined && !(s.hits > 0)) bad.push(`${id} ${s.label}: hits ${s.hits}`);
        if (s.every !== undefined && !(s.every > 0)) bad.push(`${id} ${s.label}: every ${s.every}`);
        if (s.every !== undefined && !(s.duration! > 0)) bad.push(`${id} ${s.label}: a rate with no duration`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("carry rotations: positive length, hit counts not negative", () => {
    const carries = kitJson.carries as Record<string, { rotationSeconds: number; hits: { label: string; count: number }[] }>;
    const bad: string[] = [];
    for (const [id, c] of Object.entries(carries)) {
      if (!(c.rotationSeconds > 0)) bad.push(`${id}: rotation ${c.rotationSeconds}s`);
      for (const h of c.hits) if (!(h.count >= 0)) bad.push(`${id} ${h.label}: count ${h.count}`);
    }
    expect(bad).toEqual([]);
  });

  test("scores and lines are finite numbers", () => {
    const bad = scored.filter(({ s }) => !Number.isFinite(s.score) || s.breakdown.some((l) => !Number.isFinite(l.points)));
    expect(bad.map(({ team }) => names(team))).toEqual([]);
  });
});

describe("order-independent", () => {
  test("a team scores the same in any member order", () => {
    const bad: string[] = [];
    for (const { team, s } of scored) {
      const [a, b, c, d] = team;
      for (const order of [[d, c, b, a], [b, d, a, c], [c, a, d, b]]) {
        if (teamScore(order) !== s.score) bad.push(`${names(team)}: ${s.score} vs ${teamScore(order)} as ${names(order)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// Better stats never lower a team's score. Each built member of a sampled team gets +10% ATK, +10% HP, +50 EM and
// +5% crit rate in turn.
function stronger(m: ScoringCharacter): ScoringCharacter {
  const s = m.stats!;
  return { ...m, stats: { ...s, atk: s.atk * 1.1, hp: s.hp * 1.1, elementalMastery: s.elementalMastery + 50, critRate: s.critRate + 5 } };
}

// Score drops when one member gets stronger.
const drops = (() => {
  const out: string[] = [];
  for (const team of sampleTeams(built, 150, 202)) {
    const before = scoreTeam(team);
    for (let i = 0; i < 4; i++) {
      const after = scoreTeam(team.map((m, j) => (j === i ? stronger(m) : m)));
      if (after.score < before.score) out.push(`${names(team)}: stronger ${team[i].id}, ${before.score} -> ${after.score}`);
    }
  }
  return out;
})();

describe("monotonic", () => {
  // Before #202, lines measured against the carry's own damage shrank when the carry got stronger (sub-DPS and buffer
  // shares), and the carry's build and talent lines scaled with teammates' buffs.
  test("a stronger member never lowers the score (#202)", () => {
    expect(drops).toEqual([]);
  });
});

// A member's own damage per second, from their Sub-DPS line.
const ownDps = (s: ScoredTeam, id: string) => {
  const line = s.breakdown.find((l) => l.rule === "Sub-DPS" && l.reason.startsWith(`${id}'s own hits`));
  return Number(line?.reason.match(/~(\d+) damage per second/)?.[1] ?? 0);
};

describe("same hits, same damage", () => {
  // Yae Miko's turrets don't depend on the carry: next to two Dendro carries they Aggravate alike and her Burst is
  // funded alike (another element's carry changes her particles, so her Burst share). Before #202 they were a share of
  // the carry's damage without reactions (#199): +309% next to Nefer, +63% next to Alhaitham.
  test("a sub-DPS whose hits get the same reactions and Energy deals the same damage with any carry (#199)", () => {
    const yae = (carry: string) => ownDps(scoreTeam(["Yae Miko", carry, "Zhongli", "Kaedehara Kazuha"].map((id) => byId.get(id)!)), "Yae Miko");
    expect(yae("Nefer")).toBeGreaterThan(0);
    expect(yae("Nefer")).toBe(yae("Alhaitham"));
  });
});

describe("flat points", () => {
  // Lines that score a fixed number of points rather than the damage something adds (no "~+N%" in the reason).
  // The team model (#202) retires them; until then this list may only shrink, so no new flat rule slips in.
  const FLAT_RULES_TODAY = ["Buffs", "Carry", "Conflicts", "Energy", "Hexerei", "Reactions", "Resonance", "Stellar", "Survivability"];

  test("no new rule scores flat points (#202, #200)", () => {
    const flat = new Set<string>();
    for (const { s } of scored) for (const l of s.breakdown) if (l.points !== 0 && !l.reason.includes("%")) flat.add(l.rule);
    const added = [...flat].filter((r) => !FLAT_RULES_TODAY.includes(r));
    expect(added, "a new flat-point rule: score it by damage instead").toEqual([]);
  });
});

describe("outlier sweep", () => {
  // No team should score far above the best guide team of any carry: a team above 1.5x the highest guide-team score
  // is listed for review (Nefer at 485 and Clorinde at 327 were #199). A known one gets a line here with its issue.
  const KNOWN_OUTLIERS: Record<string, string> = {};

  test("no unreviewed team above 1.5x the best guide team", () => {
    const best = Math.max(...Object.values(referenceJson.carries).map((c) => c.value));
    const ceiling = (1.5 * 100 * best) / referenceJson.median;
    const bad = scored
      .filter(({ team, s }) => s.score > ceiling && !KNOWN_OUTLIERS[key(team.map((m) => m.id))])
      .map(({ team, s }) => `${Math.round(s.score)} [${names(team)}]: ${s.breakdown[0].reason}`);
    expect(bad).toEqual([]);
  });
});

describe("counted once (#204)", () => {
  // With a modeled carry, the buffs teamBuffStats reads are inside team damage (carry stats, and party-wide ones on
  // sub-DPS hits): a buffer's line may score only the rest of their kit (EM, Reaction Bonus, shred...). A line whose
  // buffer has nothing outside the damage scores 0, and one with something outside scores at most that part.
  test("a buff inside team damage scores no points", () => {
    const bad: string[] = [];
    for (const { team, s } of scored) {
      const carry = team.find((m) => m.id === s.onField);
      if (!carry || !hasCarryKit(carry.id)) continue;
      const carryActive = carry.reactions.filter((r) => s.activeReactions.includes(r));
      for (const l of s.breakdown) {
        if (l.rule !== "Buffs" || l.points === 0) continue;
        const buffer = team.find((m) => l.reason.startsWith(`${m.id} buffs`));
        const outside = buffer && kitBuffValue(buffer, carry, carryActive, team, true);
        if (outside && outside.gain < 0.005) bad.push(`${l.points} ${l.rule}: ${l.reason} [${names(team)}]`);
      }
    }
    expect(bad).toEqual([]);
  });

  // And the buffs teamBuffStats reads do raise the modeled carry's damage, so they are counted somewhere. DMG Bonus,
  // CRIT Rate and flat DMG always do; ATK only for a carry whose hits scale on it (Lynette's ATK% does nothing for
  // Neuvillette), so ATK alone only has to not lower it.
  test("the carry's team buffs are in their damage", () => {
    let checked = 0;
    for (const { team, s } of scored) {
      const carry = team.find((m) => m.id === s.onField);
      if (!carry || !hasCarryKit(carry.id)) continue;
      const buffs = teamBuffStats(carry, carry.reactions.filter((r) => s.activeReactions.includes(r)), team);
      if (buffs.atk + buffs.atkPct + buffs.dmgBonus + buffs.critRate + buffs.flat === 0) continue;
      const without = carryDamage(carry, s.activeReactions, team)?.perSecond ?? 0;
      const withBuffs = carryDamage(carry, s.activeReactions, team, buffs)?.perSecond ?? 0;
      if (buffs.dmgBonus + buffs.critRate + buffs.flat > 0) {
        expect(withBuffs, `${carry.id} in ${names(team)}`).toBeGreaterThan(without);
        checked++;
      } else expect(withBuffs, `${carry.id} in ${names(team)}`).toBeGreaterThanOrEqual(without);
    }
    expect(checked).toBeGreaterThan(50);
  });
});
