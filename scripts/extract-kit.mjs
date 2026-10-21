// Writes data/kit.json: each buffer's buff values read from genshin-db's talent data (#68).
// Run with `npm run kit` after a genshin-db update. src/lib/scoring/kit.ts turns the values into buffer points.
//
// The spec below is hand-written and reviewed: it says where each tags.json buff lives in the kit,
// either a talent table label (values per talent level) or a sentence in the talent text (fixed values).
// The script reads the numbers; it fails if a label or sentence is missing, so a data change can't
// silently drop a buff.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const genshindb = require("genshin-db");
const { version } = require("genshin-db/package.json");

// Hand-filled text for what genshin-db is missing (data/kit-overrides.json, #73). A filled slot replaces the
// description of that talent; empty slots are listed at the end of the run.
const OVERRIDES = require("../data/kit-overrides.json");

function talentsOf(id) {
  const base = genshindb.talents(id);
  const filled = (OVERRIDES.characters[id]?.slots ?? []).filter((s) => s.text.trim() && s.talent);
  if (!base && filled.length === 0) return undefined;
  const merged = { ...(base ?? {}) };
  for (const s of filled) merged[s.talent] = { ...(merged[s.talent] ?? {}), name: s.name || merged[s.talent]?.name, description: s.text, override: s.source };
  return merged;
}

const TALENT_LEVEL = 9; // the scorer's talent benchmark (POINTS.talentBenchmark)
const COMBAT = { normal: "combat1", skill: "combat2", burst: "combat3" };

// kind says what the value means; the unit text spells it out for review.
// table: { talent, values: [{ kind, label, times?, cap?, unit, ...limits }], duration?, cd? } (labels matched before "|")
// text:  { from, values: [{ kind, re, unit, percent?, max?, perHp?, ...limits }], duration?: re | label, cd?: { talent, label } }
// scale: a factor on the read value (Yelan's ramping bonus averages about half its max)
// condition: the value depends on the team (fightingSpirit: Mavuika, fanfare: Furina; scaled in src/lib/scoring/kit.ts)
// steps: the value steps with the team (members of some elements, or element types); teamOnly: every member's
//        element must be one of these (Chevreuse)
// limits: elements (carry's element), appliesTo (carry's keyTalent, or 'plunge' for carries whose rotation plunges),
//         reactions (one the carry deals), physical
const SPEC = {
  Alyosha: { talent: "skill", values: [{ kind: "atkPct", label: "Hunter's Precision ATK Bonus", unit: "ATK %" }], duration: "Hunter's Precision Duration", cd: "CD" },
  Bennett: { talent: "burst", values: [{ kind: "atkFromBase", label: "ATK Bonus Ratio", unit: "of Bennett's base ATK" }], duration: "Duration", cd: "CD" },
  Candace: { talent: "burst", values: [{ kind: "dmgBonus", label: "DMG Bonus", unit: "Normal Attack DMG %", appliesTo: ["normal"] }], duration: "Duration", cd: "CD" },
  Columbina: { talent: "burst", values: [{ kind: "reactionBonus", label: "Lunar Reaction DMG Bonus", unit: "Lunar reaction DMG %", reactions: ["lunar-charged", "lunar-bloom", "lunar-crystallize"] }], duration: "Lunar Domain Duration", cd: "CD" },
  Faruzan: {
    talent: "burst",
    values: [
      { kind: "dmgBonus", label: "Anemo DMG Bonus", unit: "Anemo DMG %", elements: ["Anemo"] },
      { kind: "resShred", label: "Anemo RES Decrease", unit: "Anemo RES", elements: ["Anemo"] },
    ],
    duration: "Duration",
    cd: "CD",
  },
  Furina: {
    talent: "burst",
    values: [{ kind: "dmgBonus", label: "Fanfare to DMG Increase Conversion Ratio", times: "Maximum Fanfare", unit: "DMG % at max Fanfare", condition: "fanfare" }],
    // Fanfare comes from party HP changes; her Salon Members only drain characters above this HP (#90).
    fanfare: { max: "Maximum Fanfare", drainFloor: { from: "combat2", re: /character\(s\) with more than (\d+)% HP/ } },
    duration: "Duration",
    cd: "CD",
  },
  Gorou: {
    talent: "skill",
    values: [
      { kind: "dmgBonus", label: "Geo DMG Bonus", unit: "Geo DMG % (3 Geo members)", elements: ["Geo"] },
      { kind: "defFlat", label: "DEF Increase", unit: "flat DEF", elements: ["Geo"] },
    ],
    duration: "Duration",
    cd: "CD",
  },
  Iansan: { talent: "burst", values: [{ kind: "atkFlat", label: "Max ATK Bonus", unit: "flat ATK (max)" }], duration: "Duration", cd: "CD" },
  Illuga: { talent: "burst", values: [{ kind: "flatDmgFromEm", label: "Geo DMG Bonus", unit: "of Illuga's EM as flat Geo DMG", elements: ["Geo"] }], duration: "Duration", cd: "CD" },
  "Kujou Sara": { talent: "skill", values: [{ kind: "atkFromBase", label: "ATK Bonus Ratio", unit: "of Sara's base ATK" }], duration: "ATK Bonus Duration", cd: "CD" },
  Lauma: {
    talent: "burst",
    values: [
      { kind: "flatDmgFromEm", label: "Bloom, Hyperbloom, and Burgeon DMG Increase", unit: "of Lauma's EM as flat Bloom-type DMG", reactions: ["bloom", "hyperbloom", "burgeon"] },
      { kind: "flatDmgFromEm", label: "Lunar-Bloom DMG Increase", unit: "of Lauma's EM as flat Lunar-Bloom DMG", reactions: ["lunar-bloom"] },
    ],
    duration: "Pale Hymn Duration",
    cd: "CD",
  },
  Mika: { talent: "skill", values: [{ kind: "atkSpd", label: "ATK SPD Bonus", unit: "ATK SPD %", appliesTo: ["normal"] }], duration: "Soulwind Duration", cd: "CD" },
  Mona: { talent: "burst", values: [{ kind: "dmgBonus", label: "DMG Bonus", unit: "DMG % while Omen lasts" }], duration: "Omen Duration", cd: "CD" },
  Nicole: {
    talent: "skill",
    values: [
      { kind: "atkFromAtk", label: "Grace of Kenosis ATK Bonus Ratio", cap: "Grace of Kenosis Max ATK Bonus", unit: "of Nicole's ATK as flat ATK (capped)" },
    ],
    duration: "Grace of Kenosis Duration",
    cd: "CD",
  },
  Shenhe: {
    talent: "skill",
    values: [{ kind: "flatDmgFromAtk", label: "DMG Bonus", unit: "of Shenhe's ATK as flat Cryo DMG", elements: ["Cryo"] }],
    duration: "Press/Hold Duration",
    cd: "Press CD",
    // Her Burst field "decreases the Cryo RES and Physical RES of opponents within it" (#177); Physical isn't scored.
    also: [{ talent: "burst", values: [{ kind: "resShred", label: "RES Decrease", unit: "Cryo RES", elements: ["Cryo"] }], duration: "Duration", cd: "CD" }],
  },
  Vodyanitsa: { talent: "skill", values: [{ kind: "resShred", label: "Hydro/Cryo RES Reduction", unit: "Hydro/Cryo RES", elements: ["Hydro", "Cryo"] }], duration: "RES Reduction Duration", cd: "Skill CD" },
  Xilonen: { talent: "skill", values: [{ kind: "resShred", label: "Elemental RES Decrease", unit: "RES of the party's elements" }], duration: "Source Sample Activation Duration", cd: "CD" },
  "Yun Jin": { talent: "burst", values: [{ kind: "flatDmgFromDef", label: "DMG Increase", unit: "of Yun Jin's DEF as flat Normal Attack DMG", appliesTo: ["normal"] }], duration: "Duration", cd: "CD" },

  Albedo: { from: "passive2", values: [{ kind: "em", re: /Elemental Mastery of nearby party members by (\d+)/, unit: "EM" }], duration: /for (\d+)s/, cd: { talent: "burst", label: "CD" } },
  Baizhu: {
    from: "passive2",
    values: [
      { kind: "reactionBonus", re: /Burning, Bloom, Hyperbloom, and Burgeon reaction DMG dealt by these characters by (\d+)%/, unit: "Burning/Bloom-type DMG % per 1,000 of Baizhu's Max HP (up to 50,000)", percent: true, perHp: 1000, max: 1, reactions: ["burning", "bloom", "hyperbloom", "burgeon"] },
      { kind: "reactionBonus", re: /their Lunar-Bloom DMG by ([\d.]+)%/, unit: "Lunar-Bloom DMG % per 1,000 of Baizhu's Max HP (up to 50,000)", percent: true, perHp: 1000, max: 0.35, reactions: ["lunar-bloom"] },
      { kind: "reactionBonus", re: /provided by Aggravate and Spread by ([\d.]+)%/, unit: "Aggravate/Spread bonus % per 1,000 of Baizhu's Max HP (up to 50,000)", percent: true, perHp: 1000, max: 0.4, reactions: ["aggravate", "spread"] },
    ],
    duration: /lasts (\d+)s/,
  },
  Chevreuse: {
    from: "passive1",
    values: [{ kind: "resShred", re: /Pyro and Electro RES of the opponent\(s\) affected by this Overloaded reaction will be decreased by (\d+)%/, unit: "Pyro/Electro RES after Overloaded, only when every member is Pyro or Electro", percent: true, elements: ["Pyro", "Electro"], teamOnly: ["Pyro", "Electro"] }],
    duration: /decreased by \d+% for (\d+)s/,
  },
  Citlali: { from: "passive1", values: [{ kind: "resShred", re: /Pyro and Hydro RES of opponents affected by that reaction decreases by (\d+)%/, unit: "Pyro/Hydro RES after Frozen or Melt", percent: true, elements: ["Pyro", "Hydro"] }], duration: /decreases by \d+% for (\d+)s/ },
  Dahlia: { from: "passive2", values: [{ kind: "atkSpd", re: /up to a maximum of (\d+)%/, unit: "ATK SPD % (max, HP-based)", percent: true, appliesTo: ["normal"] }] },
  Escoffier: { from: "passive2", values: [{ kind: "resShred", re: /by (\d+)%\/(\d+)%\/(\d+)%\/(\d+)% for/, unit: "Hydro/Cryo RES by the number of Hydro or Cryo members (1-4)", percent: true, elements: ["Hydro", "Cryo"], steps: { count: "members", of: ["Hydro", "Cryo"] } }], duration: /% for (\d+)s/ },
  Ineffa: { from: "passive2", values: [{ kind: "emFromAtk", re: /Elemental Mastery by (\d+)% of Ineffa's ATK/, unit: "of Ineffa's ATK as EM", percent: true }], duration: /for (\d+)s/, cd: { talent: "burst", label: "CD" } },
  "Kaedehara Kazuha": { from: "passive2", values: [{ kind: "dmgBonusPerEm", re: /a ([\d.]+)% Elemental DMG Bonus/, unit: "swirled-element DMG % per point of Kazuha's EM", percent: true }], duration: /for (\d+)s/ },
  // Painted Dome: "All Dendro Cores created by all your own party members through Bloom and Lunar-Bloom reactions will deal
  // additional DMG when they burst", while Kaveh stays on field (#256).
  Kaveh: {
    talent: "burst",
    values: [
      {
        kind: "reactionBonus",
        label: "Dendro Core Burst DMG Bonus",
        unit: "Dendro Core (Bloom) DMG % during Painted Dome",
        reactions: ["bloom"],
        whileOnField: true,
      },
    ],
    duration: "Duration",
    cd: "CD",
  },
  Linnea: {
    from: ["passive1", "passive2"],
    values: [
      { kind: "resShred", re: /Geo RES of opponents near Lumi will decrease by (\d+)%/, unit: "Geo RES", percent: true, elements: ["Geo"] },
      { kind: "emFromDef", re: /based on (\d+)% of Linnea's DEF/, unit: "of Linnea's DEF as EM", percent: true },
    ],
  },
  Lisa: { from: "passive2", values: [{ kind: "defShred", re: /DEF decreased by (\d+)%/, unit: "DEF", percent: true }], duration: /for (\d+)s/ },
  Lynette: { from: "passive1", values: [{ kind: "atkPct", re: /(\d+)%\/(\d+)%\/(\d+)%\/(\d+)% respectively/, unit: "ATK % by the number of element types (1-4)", percent: true, steps: { count: "elementTypes" } }], duration: /Within (\d+)s/, cd: { talent: "skill", label: "CD" } },
  Mavuika: { from: "passive2", values: [{ kind: "dmgBonus", re: /maximum increase obtainable this way is (\d+)%/, unit: "active character DMG % at 200 Fighting Spirit (0.2% per point)", percent: true, condition: "fightingSpirit" }], duration: /lasts (\d+)s/, cd: { talent: "burst", label: "CD" } },
  Nahida: { from: "passive1", values: [{ kind: "emFromTopEm", re: /increased by (\d+)% of the Elemental Mastery of the party member with the highest/, unit: "of the party's highest EM", percent: true }] },
  // Bountiful Cores (passive 1: an all-Dendro/Hydro team, Golden Chalice's Bounty for 30s per Skill) deal more with her
  // Max HP above 30,000 (passive 2); "Bountiful Core DMG is considered DMG dealt by Dendro Cores produced by Bloom" (#256).
  // Dreamdrifter raises the Swirl and Stellar Swirl DMG party members deal by Mizuki's EM (#235), while she is on field
  // (it ends when she leaves): 10s with passive 1's two 2.5s extensions (wiki Aisa Utamakura Pilgrimage notes: "up to 13
  // instances over 10 seconds with her Passive Talent 1 unlocked"), on her 15s Skill. Built for EM (the carry benchmark's).
  "Yumemizuki Mizuki": {
    talent: "skill",
    buildFor: { em: "built" },
    values: [
      { kind: "reactionBonus", label: "Elemental Mastery-Based Swirl DMG Increase", perEm: 100, reactions: ["swirl"], whileOnField: true, unit: "Swirl DMG % per 100 of Mizuki's EM" },
      { kind: "reactionBonus", label: "Elemental Mastery-Based Stellar Swirl DMG Increase", perEm: 100, reactions: ["stellar-swirl"], whileOnField: true, unit: "Stellar Swirl DMG % per 100 of Mizuki's EM" },
    ],
    duration: 10,
    cd: "CD",
  },
  Nilou: {
    from: ["passive2", "passive1"],
    values: [
      {
        kind: "reactionBonus",
        re: /Bountiful Cores created by characters affected by Golden Chalice's Bounty to increase by (\d+)%/,
        unit: "Bountiful Core (Bloom) DMG % per 1,000 of Nilou's Max HP above 30,000, in an all-Dendro/Hydro team",
        percent: true,
        perHp: 1000,
        hpAbove: /Every 1,000 points of Nilou's Max HP above ([\d,]+)/,
        maxText: /achieved this way is (\d+)%/,
        reactions: ["bloom"],
        teamOnly: ["Dendro", "Hydro"],
      },
      // Golden Chalice's Bounty: the party is hit by Dendro attacks (its own Bountiful Cores) all through it.
      {
        kind: "em",
        re: /increase the Elemental Mastery of all nearby characters by (\d+)/,
        unit: "EM while hit by Dendro attacks, in an all-Dendro/Hydro team",
        teamOnly: ["Dendro", "Hydro"],
      },
    ],
  },
  // Rescue Essentials points = Nightsoul points the party holds, up to the max in the text (#76).
  Ifa: {
    from: "passive1",
    values: [
      { kind: "reactionBonus", re: /Swirl and Electro-Charged DMG dealt by nearby party members by ([\d.]+)%/, unit: "Swirl/Electro-Charged DMG % per Rescue Essentials point", percent: true, reactions: ["swirl", "electrocharged"], condition: "rescueEssentials" },
      { kind: "reactionBonus", re: /Lunar-Charged DMG dealt by ([\d.]+)%/, unit: "Lunar-Charged DMG % per Rescue Essentials point", percent: true, reactions: ["lunar-charged"], condition: "rescueEssentials" },
      { kind: "reactionBonus", re: /Stellar Swirl reaction DMG dealt by ([\d.]+)%/, unit: "Stellar Swirl DMG % per Rescue Essentials point", percent: true, reactions: ["stellar-swirl"], condition: "rescueEssentials" },
    ],
    points: { max: /Max (\d+) points/, own: { talent: "skill", label: "Nightsoul Point Limit" } },
  },
  // Tolling Rally: DMG per point of Prune's ATK above a threshold, up to a max (#76).
  Prune: {
    from: "passive2",
    values: [{ kind: "dmgBonusFromExcessAtk", re: /Every excess ATK point increases that instance of DMG by ([\d.]+)%/, unit: "DMG % per point of Prune's ATK above the threshold", percent: true }],
    excessAtk: { threshold: /ATK in excess of ([\d,]+)/, max: /up to a total of (\d+)% max/ },
    // Without a build: she is built for this buff (ATK above 2,000 is the whole point), not the generic benchmark.
    buildFor: { atk: 3000 },
    duration: /Tolling Rally effect for (\d+)s/,
  },
  Rosaria: { from: "passive2", values: [{ kind: "critRate", re: /cannot exceed (\d+)%/, unit: "CRIT Rate % (max)", percent: true }], duration: /for (\d+)s/, cd: { talent: "burst", label: "CD" } },
  Sigewinne: { from: "passive1", values: [{ kind: "flatDmg", re: /increases the DMG by (\d+)/, unit: "flat Skill DMG per 1,000 Max HP above 30,000", appliesTo: ["skill"] }] },
  Sucrose: { from: "passive2", values: [{ kind: "emFromEm", re: /equal to (\d+)% of Sucrose's Elemental Mastery/, unit: "of Sucrose's EM as EM", percent: true }], duration: /for (\d+)s/ },
  Xianyun: { from: "passive2", values: [{ kind: "flatDmgFromAtk", re: /increased by (\d+)% of Xianyun's ATK/, unit: "of Xianyun's ATK as flat Plunge DMG (max 9,000)", percent: true, appliesTo: ["plunge"], max: 9000 }] },
  Xinyan: { from: "passive2", values: [{ kind: "dmgBonus", re: /deal (\d+)% increased Physical DMG/, unit: "Physical DMG %", percent: true, physical: true }] },
  Yelan: { from: "passive2", values: [{ kind: "dmgBonus", re: /maximum increase to DMG dealt is (\d+)%/, unit: "active character DMG %, averaged over the ramp from 1% to the max", percent: true, scale: 0.5 }] },
  Zhongli: { from: "combat2", values: [{ kind: "resShred", re: /Elemental RES and Physical RES of opponents in a small AoE by (\d+)%/, unit: "all RES", percent: true }], duration: "Shield Duration", cd: "Hold CD", table: "skill" },
};

// Buffs we know about but can't read a number for: the value isn't in the text genshin-db gives.
// (Ifa and Prune used to be here; their numbers come from data/kit-overrides.json since #75.)
const NO_VALUE = {};

const level = (params, key) => params[key]?.[TALENT_LEVEL - 1];

// Who a buff value can help: the carry's element, the talent its damage comes from (keyTalent), or a
// reaction it deals. Physical buffs never help an elemental carry.
const limits = (v) => ({
  ...(v.elements ? { elements: v.elements } : {}),
  ...(v.appliesTo ? { appliesTo: v.appliesTo } : {}),
  ...(v.reactions ? { reactions: v.reactions } : {}),
  ...(v.physical ? { physical: true } : {}),
  ...(v.condition ? { condition: v.condition } : {}),
  ...(v.teamOnly ? { teamOnly: v.teamOnly } : {}),
  ...(v.whileOnField ? { whileOnField: true } : {}),
  ...(v.perEm ? { perEm: v.perEm } : {}),
});

// Reads a table label's first parameter at TALENT_LEVEL.
function tableValue(attrs, label, id) {
  const entry = attrs.labels.find((l) => l.split("|")[0].trim() === label);
  if (!entry) throw new Error(`${id}: no talent label "${label}" (labels: ${attrs.labels.join("; ")})`);
  const key = entry.match(/\{(param\d+)/)?.[1];
  const value = key ? level(attrs.parameters, key) : undefined;
  if (value === undefined) throw new Error(`${id}: label "${label}" has no level ${TALENT_LEVEL} value`);
  return value;
}

const round = (n) => (n === null || n === undefined ? n : Math.round(n * 1e6) / 1e6); // 6 places: Prune is 0.025% per ATK point
const uptime = (duration, cd) => (duration && cd ? round(Math.min(1, duration / cd)) : null);

// Passive buffs that only come from the Burst (#207): their text names it (checked below), so a starved Burst funds
// them for the same share of rotations as its damage (energy.ts). Not here: buffs from the Skill too (Sucrose,
// Escoffier), from the Skill alone (Nilou, Sigewinne, Xinyan, Citlali) or from reactions (Kazuha).
const BURST_PASSIVES = {
  Albedo: "passive2", // "Using Rite of Progeniture: Tectonic Tide increases the Elemental Mastery"
  Dahlia: "passive2", // "the Favonian Favor effect of the Elemental Burst"
  Ineffa: "passive2", // "When using the Elemental Burst"
  Lisa: "passive2", // "Opponents hit by Lightning Rose"
  Lynette: "passive1", // "Within 10s after using Magic Trick: Astonishing Shift"
  Mavuika: "passive2", // "After using her Elemental Burst"
  Nahida: "passive1", // "When unleashing Illusory Heart"
  Rosaria: "passive2", // "Casting Rites of Termination"
  Xianyun: "passive2", // "the Starwicker created by Stars Gather at Dusk"
  Yelan: "passive2", // "So long as an Exquisite Throw is in play" (Depth-Clarion Dice)
};
// Whether a buff from this talent needs the Burst: the Burst itself, or a passive above whose text names it.
function fromBurst(id, from, talents) {
  if (from === "burst") return true;
  if (BURST_PASSIVES[id] !== from) return false;
  const text = talents[from].description.replace(/\s+/g, " ");
  const burst = talents.combat3.name;
  if (!text.includes("Elemental Burst") && !text.includes(burst) && !(id === "Yelan" && text.includes("Exquisite Throw"))) {
    throw new Error(`${id}: ${from} doesn't name the Burst (${burst}): ${text}`);
  }
  return true;
}

// spec.also: more specs for the same buffer, from other talents (Shenhe's Burst RES shred, #177).
function readBuffs(id, spec) {
  if (spec.also) return [...readBuffs(id, { ...spec, also: undefined }), ...spec.also.flatMap((s) => readBuffs(id, s))];
  const talents = talentsOf(id);
  if (!talents) throw new Error(`${id}: no talent data in genshin-db`);
  if (spec.talent) {
    const attrs = talents[COMBAT[spec.talent]].attributes;
    const duration = typeof spec.duration === "number" ? spec.duration : spec.duration ? tableValue(attrs, spec.duration, id) : null;
    const cd = spec.cd ? tableValue(attrs, spec.cd, id) : null;
    const fanfare = spec.fanfare && {
      maxFanfare: tableValue(attrs, spec.fanfare.max, id),
      drainFloor: (() => {
        const m = talents[spec.fanfare.drainFloor.from].description.replace(/\s+/g, " ").match(spec.fanfare.drainFloor.re);
        if (!m) throw new Error(`${id}: pattern ${spec.fanfare.drainFloor.re} not found in ${spec.fanfare.drainFloor.from}`);
        return Number(m[1]) / 100;
      })(),
    };
    return spec.values.map((v) => ({
      kind: v.kind,
      value: round(tableValue(attrs, v.label, id) * (v.times ? tableValue(attrs, v.times, id) : 1)),
      ...(fanfare ?? {}),
      ...(v.cap ? { max: tableValue(attrs, v.cap, id) } : {}),
      ...limits(v),
      unit: v.unit,
      source: `${spec.talent} talent "${v.label}"${v.times ? ` x "${v.times}"` : ""}, level ${TALENT_LEVEL}`,
      duration,
      cd,
      uptime: uptime(duration, cd),
      ...(fromBurst(id, spec.talent, talents) ? { burst: true } : {}),
    }));
  }
  const froms = [spec.from].flat();
  const texts = froms.map((f) => talents[f].description.replace(/\s+/g, " "));
  const tableAttrs = spec.table ? talents[COMBAT[spec.table]].attributes : null;
  const seconds = (d, text) => {
    if (d === undefined) return null;
    if (typeof d === "number") return d;
    if (typeof d === "string") return tableValue(tableAttrs, d, id);
    const m = text.match(d);
    if (!m) throw new Error(`${id}: duration pattern ${d} not found`);
    return Number(m[1]);
  };
  return spec.values.map((v, i) => {
    const text = texts[Math.min(i, texts.length - 1)];
    const from = froms[Math.min(i, froms.length - 1)];
    const m = text.match(v.re);
    if (!m) throw new Error(`${id}: pattern ${v.re} not found in ${from}: ${text}`);
    // A value that steps with the team (Escoffier 5/10/15/55%): every step is kept, and `value` is the top one.
    const steps = v.steps ? { ...v.steps, values: m.slice(1, 5).map((n) => round((Number(n) / (v.percent ? 100 : 1)) * (v.scale ?? 1))) } : null;
    const duration = seconds(spec.duration, text);
    const cd = spec.cd === undefined ? null : typeof spec.cd === "string" ? tableValue(tableAttrs, spec.cd, id) : tableValue(talents[COMBAT[spec.cd.talent]].attributes, spec.cd.label, id);
    const num = (re) => {
      const x = text.match(re);
      if (!x) throw new Error(`${id}: pattern ${re} not found in ${from}`);
      return Number(x[1].replace(/,/g, ""));
    };
    const points = spec.points
      ? { max: num(spec.points.max), own: tableValue(talents[COMBAT[spec.points.own.talent]].attributes, spec.points.own.label, id) }
      : null;
    const excess = spec.excessAtk ? { threshold: num(spec.excessAtk.threshold), max: num(spec.excessAtk.max) / 100 } : null;
    // A perHp value that starts above some HP, with its cap in the text (Nilou's "above 30,000" ... "400%", #256).
    const above = v.hpAbove ? { threshold: num(v.hpAbove), ...(v.maxText ? { max: num(v.maxText) / 100 } : {}) } : null;
    return {
      kind: v.kind,
      value: steps ? steps.values[steps.values.length - 1] : round((Number(m[1]) / (v.percent ? 100 : 1)) * (v.scale ?? 1)),
      ...(points ? { points } : {}),
      ...(excess ? { threshold: excess.threshold, max: excess.max } : {}),
      ...(above ?? {}),
      ...(steps ? { steps } : {}),
      ...(v.max ? { max: v.max } : {}),
      ...(v.perHp ? { perHp: v.perHp } : {}),
      ...limits(v),
      unit: v.unit,
      source: `${from}: "${m[0]}"`,
      duration,
      cd,
      uptime: uptime(duration, cd),
      ...(fromBurst(id, from, talents) ? { burst: true } : {}),
    };
  });
}

// Moonsign: Ascendant Gleam (#63). Every "Moonsign Benediction" passive raises the party's Moonsign by 1 level,
// and Ascendant Gleam is level 2. target "party": a numeric buff for party members (read like the buffs above);
// target "self": an upgrade to that character's own kit, kept as the quoted sentence.
const GLEAM = {
  Aino: { from: "passive1", target: "self" },
  Columbina: { from: "combat2", target: "self" },
  Flins: { from: "passive1", target: "self" },
  Illuga: { from: "passive1", target: "party", values: [{ kind: "em", re: /have their Elemental Mastery increased by (\d+)/, unit: "EM" }] },
  Jahoda: { from: "combat2", target: "self" },
  Lauma: {
    from: "passive1",
    target: "party",
    values: [
      { kind: "critRate", re: /Lunar-Bloom DMG CRIT Rate \+(\d+)%/, unit: "Lunar-Bloom CRIT Rate", percent: true, reactions: ["lunar-bloom"] },
      { kind: "critDmg", re: /Lunar-Bloom DMG CRIT Rate \+\d+%, CRIT DMG \+(\d+)%/, unit: "Lunar-Bloom CRIT DMG", percent: true, reactions: ["lunar-bloom"] },
    ],
  },
  Linnea: { from: "passive1", target: "party", values: [{ kind: "resShred", re: /further decreased by (\d+)%/, unit: "more Geo RES", percent: true, elements: ["Geo"] }] },
  Nefer: { from: "passive1", target: "self" },
  Zibai: { from: "combat2", target: "self" },
};

function readGleam(id, spec) {
  const text = talentsOf(id)[spec.from].description.replace(/\s+/g, " ");
  const at = text.indexOf("Ascendant Gleam");
  if (at < 0) throw new Error(`${id}: no "Ascendant Gleam" in ${spec.from}`);
  const after = text.slice(at);
  const quote = after.split(/(?<=\.) /).slice(0, 2).join(" ");
  if (spec.target === "self") return { target: "self", source: `${spec.from}: "${quote}"` };
  return {
    target: "party",
    source: `${spec.from}: "${quote}"`,
    values: spec.values.map((v) => {
      const m = after.match(v.re);
      if (!m) throw new Error(`${id}: pattern ${v.re} not found after Ascendant Gleam in ${spec.from}`);
      return { kind: v.kind, value: Number(m[1]) / (v.percent ? 100 : 1), unit: v.unit, ...limits(v) };
    }),
  };
}

// Hexerei: Secret Rite (#63). With 2+ Hexerei members the party gains Secret Rite, which turns on each Hexerei
// member's "Hexerei: Secret Rite" text (data/kit-overrides.json: Witch's Eve Rite passives and Hexerei Buff tabs).
// target "self": an upgrade to that character's own kit, kept as the quoted text. target "party": numeric buffs
// read like the buffs above, with these extra limits:
//   hexereiOnly: only Hexerei members get it ("nearby Hexerei party members")
//   teamReactions: any member triggering one of these turns it on (Fischl's Oz), not only the carry
//   perDef: the value is per this much of the member's DEF, up to max (Albedo)
//   anyReaction: the carry has to trigger some reaction (Prune)
//   ownAttacks: it builds from the member's own Normal/Charged Attacks, so it does nothing while they're off-field (Mona)
//   uptime: { talent, duration, cd } table labels
//   perBurst: { talent, hits, cd } table labels: flat damage on that many hits each Burst cooldown (Nicole)
//   ofBase: the value raises a base effect by this ratio; base is read from another talent (Durin: 20% shred +75%)
const SECRET_RITE = {
  Albedo: {
    from: "passive4",
    target: "party",
    values: [
      { kind: "dmgBonus", re: /increased by (\d+)% for every 1,000 DEF Albedo has for \d+s\. The maximum increase that can be achieved this way is \d+%\. After generating a Silver/, max: /The maximum increase that can be achieved this way is (\d+)%\. After generating a Silver/, perDef: 1000, unit: "Attack DMG % per 1,000 of Albedo's DEF (Solar Isotoma, everyone)", percent: true },
      { kind: "dmgBonus", re: /Hexerei party members' .*? increased by (\d+)% for every 1,000 DEF/, max: /Hexerei party members' .*? The maximum increase that can be achieved this way is (\d+)%/, perDef: 1000, unit: "Attack DMG % per 1,000 of Albedo's DEF (Silver Isotoma, Hexerei members)", percent: true, hexereiOnly: true },
    ],
  },
  Durin: {
    from: "passive4",
    target: "party",
    // White Flame's RES shred (passive1) raised by Secret Rite. Only after Burning, Overloaded, Pyro Swirl or Pyro Crystallize.
    values: [{ kind: "resShred", re: /\(except for Duration\) by (\d+)%/, ofBase: { from: "passive1", re: /are decreased by (\d+)% for/ }, unit: "more Pyro RES shred (White Flame)", percent: true, elements: ["Pyro"], teamReactions: ["burning", "overloaded", "swirl", "crystallize"] }],
  },
  Fischl: {
    from: "passive4",
    target: "party",
    // Oz is out almost the whole rotation: her Skill and Burst both summon him, and they alternate.
    values: [
      { kind: "atkPct", re: /Overloaded reaction, Fischl and other nearby active party members have their ATK increased by ([\d.]+)%/, unit: "ATK % after Overloaded, while Oz is out", percent: true, teamReactions: ["overloaded"] },
      { kind: "em", re: /Lunar-Charged reaction, Fischl and other nearby active party members have their Elemental Mastery increased by (\d+)/, unit: "EM after Electro-Charged or Lunar-Charged, while Oz is out", teamReactions: ["electrocharged", "lunar-charged"] },
    ],
  },
  Klee: { from: ["passive1", "passive4"], target: "self" },
  Lohen: { from: "passive4", target: "self" },
  // Each Arcane Projection a Hexerei character triggers deals 300% of Nicole's ATK more; her Burst summons
  // up to "Arcane Projection Attack Count" of them per Burst.
  Nicole: {
    from: "passive4",
    target: "party",
    values: [{ kind: "flatDmgFromAtk", re: /Arcane Projections by (\d+)% of Nicole's ATK/, unit: "of Nicole's ATK as flat DMG on each Arcane Projection (Hexerei members)", percent: true, hexereiOnly: true, perBurst: { talent: "burst", hits: "Arcane Projection Attack Count", cd: "CD" } }],
  },
  Mona: {
    from: "passive4",
    target: "party",
    values: [{ kind: "reactionBonus", re: /increases the damage of that Vaporize reaction by (\d+)%/, times: /Max (\d+) stacks/, unit: "Vaporize DMG % (one Vaporize, with stacks from Mona's own attacks)", percent: true, reactions: ["vaporize"], ownAttacks: true }],
  },
  // A Hexerei carry inside Tolling Rally who triggers a reaction raises Prune's own ATK, so her Tolling Rally
  // bonus (0.025% DMG per ATK above 2,000, data above) grows; a Swirl or Stellar Swirl also raises theirs.
  Prune: {
    from: "passive4",
    target: "party",
    values: [
      { kind: "ownAtkPct", re: /Prune's ATK is increased by (\d+)%/, unit: "Prune's ATK %, raising her Tolling Rally bonus", percent: true, hexereiOnly: true, anyReaction: true },
      { kind: "atkPct", re: /triggering character's ATK will additionally be increased by (\d+)%/, unit: "ATK % after the carry's own Swirl or Stellar Swirl", percent: true, hexereiOnly: true, reactions: ["swirl", "stellar-swirl"] },
    ],
  },
  Razor: { from: "passive4", target: "self" },
  Sucrose: {
    from: "passive4",
    target: "party",
    values: [
      { kind: "dmgBonus", re: /Small Wind Spirit, nearby party members' .*? increased by ([\d.]+)%/, unit: "Attack DMG % (Small Wind Spirit, everyone)", percent: true },
      { kind: "dmgBonus", re: /Large Wind Spirit, nearby Hexerei party members' .*? increased by ([\d.]+)%/, unit: "Attack DMG % (Large Wind Spirit, Hexerei members)", percent: true, hexereiOnly: true },
    ],
  },
  Varka: { from: "passive4", target: "self" },
  Venti: {
    from: ["combat1", "passive4"],
    target: "party",
    // The active character's own Swirl turns it on, and only while the Stormeye (Burst) is out.
    values: [{ kind: "dmgBonus", re: /that character's DMG is increased by (\d+)%/, unit: "DMG % for 4s after the carry's own Swirl, while the Stormeye is out", percent: true, reactions: ["swirl"], uptime: { talent: "burst", duration: "Duration", cd: "CD" } }],
  },
};

// The heading on a line of its own; the Witch's Eve Rite intro also names "the Hexerei: Secret Rite effect".
const SECRET_RITE_HEADING = /(?:^|\n)Hexerei: Secret Rite[ \t]*\r?\n/;

// The Secret Rite part of a talent's text: everything after its heading.
function secretRiteText(id, from) {
  const text = talentsOf(id)?.[from]?.description ?? "";
  const m = text.match(SECRET_RITE_HEADING);
  if (!m) throw new Error(`${id}: no "Hexerei: Secret Rite" heading in ${from}`);
  return text.slice(m.index + m[0].length).replace(/\s+/g, " ").trim();
}

function readSecretRite(id, spec) {
  const froms = [spec.from].flat();
  const texts = froms.map((f) => secretRiteText(id, f));
  const source = froms.map((f, i) => `${f}: "${texts[i].split(/(?<=\.) /)[0]}"`).join(" + ");
  if (spec.target === "self") return { target: "self", source };
  const text = texts.join(" ");
  const num = (re, where = text) => {
    const m = where.match(re);
    if (!m) throw new Error(`${id}: pattern ${re} not found in Secret Rite text`);
    return Number(m[1].replace(/,/g, ""));
  };
  return {
    target: "party",
    source,
    values: spec.values.map((v) => {
      const pct = (n) => n / (v.percent ? 100 : 1);
      let value = pct(num(v.re)) * (v.times ? num(v.times) : 1);
      let base;
      if (v.ofBase) {
        base = pct(num(v.ofBase.re, talentsOf(id)[v.ofBase.from].description.replace(/\s+/g, " ")));
        value = base * value; // +75% of a 20% shred = 15% more
      }
      const u = v.uptime && talentsOf(id)[COMBAT[v.uptime.talent]].attributes;
      const pb = v.perBurst && talentsOf(id)[COMBAT[v.perBurst.talent]].attributes;
      return {
        kind: v.kind,
        value: round(value),
        ...(v.max ? { max: pct(num(v.max)) } : {}),
        ...(v.perDef ? { perDef: v.perDef } : {}),
        ...(base !== undefined ? { base } : {}),
        ...limits(v),
        ...(v.hexereiOnly ? { hexereiOnly: true } : {}),
        ...(v.teamReactions ? { teamReactions: v.teamReactions } : {}),
        ...(v.ownAttacks ? { ownAttacks: true } : {}),
        ...(v.anyReaction ? { anyReaction: true } : {}),
        ...(pb ? { perBurst: { hits: tableValue(pb, v.perBurst.hits, id), cd: tableValue(pb, v.perBurst.cd, id) } } : {}),
        unit: v.unit,
        uptime: u ? uptime(tableValue(u, v.uptime.duration, id), tableValue(u, v.uptime.cd, id)) : null,
      };
    }),
  };
}

// Nightsoul Burst (#63). A party with a Natlanese member triggers a Nightsoul Burst when anyone deals Elemental
// DMG, at most once per cooldown that shortens with more Natlanese members (data/kit-overrides.json
// rules.nightsoulBurst). Every effect it triggers is the character's own, so only the carry's counts:
//   target "self", kind atkPct: the carry's ATK % (Mavuika, Varesa), value x stacks up
//   target "self", no kind: an upgrade to the carry's own kit (Mualani, Chasca), scored like Secret Rite
//   inDamage: the upgrade is in the carry's damage model instead (Kinich's Hunter's Experience, #288: CARRIES), so the
//   scorer adds no flat points for it
//   duration / max stacks: how long each stack lasts and how many can be up; no duration = one-off (Chasca's shot)
//   target "own": a support's effect on their own stats or resources; recorded, not scored (sub-DPS damage is
//   Phase 3, resources are the energy check's job)
const NIGHTSOUL_BURST = {
  Chasca: { from: "passive2", target: "self" },
  Citlali: { from: "passive2", target: "own", note: "regains Nightsoul points" },
  Iansan: { from: "passive2", target: "own", note: "Warming Up (her own resource)" },
  Ifa: { from: "passive2", target: "own", note: "his own EM" },
  Kachina: { from: "passive1", target: "own", note: "her own Geo DMG" },
  Kinich: { from: "passive2", target: "self", duration: /lasts (\d+)s/, max: /Max (\d+) stacks/, inDamage: true },
  Mavuika: { from: "passive1", target: "self", kind: "atkPct", re: /ATK increases by (\d+)% for/, duration: /for (\d+)s/ },
  Mualani: { from: "passive2", target: "self", duration: /lasts for (\d+)s/, max: /Max (\d+) stacks/ },
  Ororon: { from: "passive1", target: "own", note: "gains Nightsoul points" },
  "Traveler (Pyro)": { from: "passive2", target: "own", note: "regains Energy" },
  Varesa: { from: "passive2", target: "self", kind: "atkPct", re: /ATK increases by (\d+)% for/, duration: /for (\d+)s/, max: /Max (\d+) stacks/ },
  Xilonen: { from: "passive2", target: "own", note: "her own DEF" },
};

// The sentence that says what a Nightsoul Burst does for this character.
function nightsoulBurstSentence(id, from) {
  const text = talentsOf(id)?.[from]?.description?.replace(/\s+/g, " ") ?? "";
  const sentences = text.split(/(?<=\.) /);
  const at = sentences.findIndex((s) => /triggers? (a )?Nightsoul Bursts?/.test(s));
  if (at < 0) throw new Error(`${id}: no Nightsoul Burst trigger in ${from}`);
  return sentences.slice(at).join(" ");
}

function readNightsoulBurst(id, spec) {
  const text = nightsoulBurstSentence(id, spec.from);
  const source = `${spec.from}: "${text.split(/(?<=\.) /)[0]}"`;
  if (spec.target === "own") return { target: "own", note: spec.note, source };
  const num = (re) => {
    const m = text.match(re);
    if (!m) throw new Error(`${id}: pattern ${re} not found in ${spec.from}: ${text}`);
    return Number(m[1]);
  };
  return {
    target: "self",
    ...(spec.kind ? { kind: spec.kind, value: num(spec.re) / 100 } : {}),
    duration: spec.duration ? num(spec.duration) : null,
    maxStacks: spec.max ? num(spec.max) : 1,
    ...(spec.inDamage ? { inDamage: true } : {}),
    source,
  };
}

// Mavuika's Fighting Spirit (#116). Her Burst text: "Nightsoul points consumed by nearby party members are converted
// to Fighting Spirit", and "When nearby party members' Normal Attacks hit opponents, Mavuika gains 1.5 Fighting Spirit.
// This can trigger once every 0.1s"; she can only Burst with "at least 50%" of the limit. So one rotation gives her own
// Skill's points, plus each Nightsoul teammate's points, plus 1.5 per Normal Attack hit of the carry (src/lib/scoring/
// kit.ts adds them up). Points gained per rotation stand in for points spent: each pool below drains in its Blessing.
// A part reads one number from the kit: a table label (talent, label) or a sentence (from, re: the product of its
// numbers). times: how often per rotation, a number (a judgment, explained per entry) or a sentence in the same text.
// cap: a table label the total can't pass. whole: the points are only spent a full pool at a time (Kinich's Cannon).
const FIGHTING_SPIRIT = {
  limit: { talent: "burst", label: "Fighting Spirit Limit" },
  burstMin: /When Mavuika has at least (\d+)% Fighting Spirit/,
  perNormalHit: /Normal Attacks hit opponents, Mavuika gains ([\d.]+) Fighting Spirit/,
  normalHitEvery: /This can trigger once every ([\d.]+)s/,
  // Her Skill: "Mavuika's Nightsoul points are restored to max value", the "Nightsoul Point Limit". KQM Mavuika quick
  // guide (https://keqingmains.com/q/mavuika-quickguide/, fetched 2026-10-12): "At C1, Mavuika can use her Burst every
  // rotation with just the Nightsoul point consumption from her Skill alone" (C1: +25% Fighting Spirit, so ~80 at C0).
  // The 10 points her Burst gives aren't counted: in Crucible of Death and Life her actions don't consume them.
  own: { parts: [{ talent: "skill", label: "Nightsoul Point Limit" }], note: "her Skill fills her Nightsoul points" },
  teammates: {
    // Her Skill, then 35 per Normal/Plunging hit once 2 Source Samples are converted (Mavuika is Pyro, so it takes one
    // more Pyro/Hydro/Cryo/Electro member; assumed). Her rotation's "N x2" passes the 90 max, where she consumes all.
    Xilonen: {
      parts: [{ from: "combat2", re: /Xilonen will gain (\d+) Nightsoul points/ }, { from: "passive1", re: /she gains (\d+) Nightsoul points when her Normal or Plunging Attacks hit/, times: 2 }],
      cap: { talent: "skill", label: "Nightsoul Point Limit" },
      note: "Skill + 2 Normal Attack hits (her N x2), capped at her max; assumes 2 converted Source Samples",
    },
    // Skill + Burst + 1 Spiritvessel Skull (one opponent) = 51, enough for Opal Fire (50+), which burns them all.
    // Passive 2: 4 per party Nightsoul Burst, once per rotation (one Nightsoul Burst, as for Ororon). Her passive 1 adds
    // 16 after a Melt or Frozen while Itzpapa is out, at most once every 8s: once, and only when the team can Melt or
    // Freeze (Jessie, #126, 2026-10-14). C4's separate 16 (Spiritvessel Skull explosions) is left out: kits are C0.
    Citlali: {
      parts: [
        { from: "combat2", re: /Citlali gains (\d+) Nightsoul points/ },
        { talent: "burst", label: "Ice Storm Nightsoul Point Gain" },
        { talent: "burst", label: "Spiritvessel Skull Nightsoul Point Gain" },
        { from: "passive2", re: /when nearby party members trigger Nightsoul Bursts, Citlali regains (\d+) Nightsoul points/ },
      ],
      withReactions: {
        reactions: ["melt", "freeze"],
        parts: [{ from: "passive1", re: /Citlali will regain (\d+) Nightsoul points/ }],
      },
      note: "Skill + Burst + 1 Skull + passive 2 once (one Nightsoul Burst), + passive 1 once when the team can Melt or Freeze",
    },
    // Skill + Burst. What the Kinetic Energy Scale restores for the active character's movement is left out (no number).
    Iansan: {
      parts: [{ from: "combat2", re: /Iansan will regain (\d+) Nightsoul points/ }, { from: "combat3", re: /Iansan will gain (\d+) Nightsoul points/ }],
      note: "Skill + Burst; the Scale's movement points left out (estimate, #126: no source for the Scale's amount)",
    },
    Kachina: { parts: [{ from: "combat2", re: /Kachina will gain (\d+) Nightsoul points/ }], note: "Skill" },
    Chasca: { parts: [{ from: "combat2", re: /Chasca gains (\d+) Nightsoul points/ }], note: "Skill" },
    // Each Sharky's Surging Bite makes a Puffer, at most 2 per Blessing; her "shark bites x3" are assumed to pick up both.
    Mualani: {
      parts: [{ from: "combat2", re: /Mualani will gain (\d+) Nightsoul points/ }, { from: "passive1", re: /restore (\d+) Nightsoul points when she picks up a Puffer/, times: /Only (\d+) such Puffers/ }],
      note: "Skill + both Puffers",
    },
    Ifa: { parts: [{ from: "combat2", re: /Ifa gains (\d+) Nightsoul points/ }], note: "Skill" },
    // 2 per second for the 10s Blessing, 3 per Loop Shot (his "hold E swings x6"), 4 from one Blind Spot = 42; the
    // Scalespiker Cannon spends them 20 (the max) at a time, so 2 Cannons spend 40. Same count as his CARRIES entry.
    Kinich: {
      parts: [
        { from: "combat2", re: /Blessing lasts (\d+)s and generates (\d+) Nightsoul points every second/ },
        { from: "combat2", re: /generating (\d+) Nightsoul points\. Loop Shot/, times: 6 },
        { from: "combat2", re: /he will generate (\d+) Nightsoul points/ },
      ],
      whole: { talent: "skill", label: "Nightsoul Point Limit" },
      note: "Blessing ticks + 6 Loop Shots + 1 Blind Spot, spent in full Cannons (estimate, #126: per-rotation count unsourced)",
    },
    // One Nightsoul Burst per rotation (every 12-18s with 1-2 other Natlanese members). With another Hydro or Electro
    // member, their hits give 5 more each, every 0.3s, up to 10 times per Skill (#126: Jessie, sourced formula), so
    // the full 50 is taken; his total is capped at his 80 max. Each Hypersense uses 10 of them.
    Ororon: {
      parts: [{ from: "passive1", re: /After a nearby party member triggers Nightsoul Burst, Ororon will gain (\d+) Nightsoul points/ }],
      withTeammateElements: {
        elements: ["Hydro", "Electro"],
        parts: [{ from: "passive1", re: /Ororon will gain (\d+) Nightsoul points, an effect that can occur every [\d.]+s/, times: /for a maximum of (\d+) times/ }],
      },
      capText: { from: "passive1", re: /Ororon can have a maximum of (\d+) Nightsoul points/ },
      note: "one Nightsoul Burst + 10 Hydro/Electro hits from another member (when there is one), capped at his max",
    },
    // Her plunges consume all her points, and filling them to the max (40) enters Fiery Passion. KQM's C0 combo (her
    // CARRIES entry) enters it 3 times per rotation: the 2 ECPs outside it and the closing CP CP.
    Varesa: { parts: [{ talent: "skill", label: "Nightsoul Point Limit", times: 3 }], note: "her max, 3 Fiery Passion entries per rotation (estimate, #126: entries per rotation unsourced)" },
    // Skill (42) + Burst (7 per second for 4s); the Blessing lasts at most 12s and drains.
    "Traveler (Pyro)": {
      parts: [{ from: "combat2", re: /the Traveler gains (\d+) Nightsoul points/ }, { from: "combat3", re: /restores (\d+) Nightsoul points per second for the next (\d+)s/ }],
      note: "Skill + Burst",
    },
  },
};

// Reads a FIGHTING_SPIRIT entry: its Nightsoul points per rotation, with the sentence or label behind each part.
function readNightsoulPoints(id, spec) {
  const talents = talentsOf(id);
  if (!talents) throw new Error(`${id}: no talent data in genshin-db`);
  const label = (p) => tableValue(talents[COMBAT[p.talent]].attributes, p.label, id);
  const textNumber = (p) => {
    const m = talents[p.from].description.replace(/\s+/g, " ").match(p.re);
    if (!m) throw new Error(`${id}: pattern ${p.re} not found in ${p.from}`);
    return { value: Number(m[1]), source: `${p.from}: "${m[0]}"` };
  };
  const { points: base, sources } = readParts(talents, id, spec.parts, label);
  let points = base;
  let fromTeammates;
  if (spec.withTeammateElements) {
    const extra = readParts(talents, id, spec.withTeammateElements.parts, label);
    fromTeammates = { elements: spec.withTeammateElements.elements, points: round(extra.points) };
    sources.push(`with another ${fromTeammates.elements.join("/")} member: ${extra.sources.join("; ")}`);
  }
  let fromReactions;
  if (spec.withReactions) {
    const extra = readParts(talents, id, spec.withReactions.parts, label);
    fromReactions = { reactions: spec.withReactions.reactions, points: round(extra.points) };
    sources.push(`when the team can ${fromReactions.reactions.join(" or ")}: ${extra.sources.join("; ")}`);
  }
  let cap;
  if (spec.capText) {
    const c = textNumber(spec.capText);
    cap = c.value;
    sources.push(`max: ${c.source}`);
  }
  if (spec.cap) {
    points = Math.min(points, label(spec.cap));
    sources.push(`max: ${spec.cap.talent} "${spec.cap.label}"`);
  }
  if (spec.whole) {
    const pool = label(spec.whole);
    points = Math.floor(points / pool) * pool;
    sources.push(`spent ${pool} at a time: ${spec.whole.talent} "${spec.whole.label}"`);
  }
  return { points: round(points), ...(fromTeammates ? { fromTeammates } : {}), ...(fromReactions ? { fromReactions } : {}), ...(cap ? { cap } : {}), note: spec.note, source: sources.join("; ") };
}

// The Nightsoul points a list of parts adds up to, with the sentence or label behind each.
function readParts(talents, id, parts, label) {
  let points = 0;
  const sources = [];
  for (const p of parts) {
    let value, source;
    if (p.label) {
      value = label(p);
      source = `${p.talent} "${p.label}"`;
    } else {
      const text = talents[p.from].description.replace(/\s+/g, " ");
      const m = text.match(p.re);
      if (!m) throw new Error(`${id}: pattern ${p.re} not found in ${p.from}: ${text}`);
      value = m.slice(1).reduce((a, n) => a * Number(n), 1);
      source = `${p.from}: "${m[0]}"`;
    }
    let times = p.times ?? 1;
    if (times instanceof RegExp) {
      const t = talents[p.from].description.replace(/\s+/g, " ").match(times);
      if (!t) throw new Error(`${id}: pattern ${times} not found in ${p.from}`);
      source += ` x "${t[0]}"`;
      times = Number(t[1]);
    } else if (times !== 1) source += ` x${times}`;
    points += value * times;
    sources.push(source);
  }
  return { points, sources };
}

function readFightingSpirit(nightsoulMembers) {
  const talents = talentsOf("Mavuika");
  const burst = talents.combat3.description.replace(/\s+/g, " ");
  const num = (re) => {
    const m = burst.match(re);
    if (!m) throw new Error(`Mavuika: pattern ${re} not found in combat3`);
    return { value: Number(m[1]), text: m[0] };
  };
  const limit = tableValue(talents.combat3.attributes, FIGHTING_SPIRIT.limit.label, "Mavuika");
  const min = num(FIGHTING_SPIRIT.burstMin);
  const perHit = num(FIGHTING_SPIRIT.perNormalHit);
  const every = num(FIGHTING_SPIRIT.normalHitEvery);
  // Every Nightsoul member needs an entry, so a new one can't silently give her none.
  for (const id of nightsoulMembers) {
    if (id !== "Mavuika" && !FIGHTING_SPIRIT.teammates[id]) throw new Error(`${id} is Nightsoul in tags.json but has no FIGHTING_SPIRIT entry`);
  }
  const teammates = {};
  for (const [id, spec] of Object.entries(FIGHTING_SPIRIT.teammates)) teammates[id] = readNightsoulPoints(id, spec);
  return {
    limit,
    burstMin: round((limit * min.value) / 100),
    perNormalHit: perHit.value,
    normalHitEvery: every.value,
    source: `combat3: "${min.text}", "${perHit.text}", "${every.text}"; burst "${FIGHTING_SPIRIT.limit.label}"`,
    own: readNightsoulPoints("Mavuika", FIGHTING_SPIRIT.own),
    teammates,
  };
}

// Stellar Glimmer: Radiance (#63). A Stellar member enters Radiance: Stellar-Conduct inside a Polestar Field
// (made when Stellar-Conduct is triggered) and Radiance: Stellar Swirl for 8s after a Stellar Swirl, so a
// Radiance is on when the team has that reaction. What it does is in each kit:
//   target "self": an upgrade to that character's own kit (Sandrone, Vesna, Wriothesley, Cyno, Mizuki), scored when they carry
//   target "party": buffs that reach the carry (Alyosha, Qiqi, Vodyanitsa), read like SECRET_RITE values; each
//     value's `radiance` is the Radiance it needs, and uptime comes from table labels or a cd sentence
//   target "own": Radiance only changes that support's own damage (sub-DPS damage is Phase 3); recorded, not scored
// `radiance` lists the Radiance states the character can enter.
const SC = "stellar-conduct";
const SS = "stellar-swirl";
const STELLAR = {
  Alyosha: {
    from: "passive3",
    target: "party",
    radiance: [SC],
    values: [{ kind: "reactionBonus", re: /increase Stellar-Conduct reaction DMG dealt by the character when on the field by (\d+)%/, unit: "Stellar-Conduct DMG % for the on-field character (Hunter's Precision)", percent: true, reactions: [SC], radiance: SC, uptime: { talent: "skill", duration: "Hunter's Precision Duration", cd: "CD" } }],
  },
  Beidou: { from: "passive4", target: "own", radiance: [SC], note: "enters Radiance; no effect on others" },
  Cyno: { from: "passive1", target: "self", radiance: [SC] },
  Diona: { from: "passive4", target: "own", radiance: [SC, SS], note: "enters Radiance; no effect on others" },
  Odette: { from: "passive3", target: "own", radiance: [SC, SS], note: "enters Radiance; no effect on others" },
  // Herald of Frost buffs the party's Stellar reactions; passive4 cuts its CD to 15s, its duration is the skill table's.
  Qiqi: {
    from: "passive4",
    target: "party",
    radiance: [SC, SS],
    values: [
      { kind: "reactionBonus", re: /Superconduct and Stellar-Conduct reaction DMG is increased by (\d+)%/, unit: "Stellar-Conduct DMG % while Herald of Frost is out", percent: true, reactions: [SC], radiance: SC, uptime: { talent: "skill", duration: "Duration", cdText: /reduced to (\d+)s/ } },
      { kind: "reactionBonus", re: /Cryo Swirl and Stellar Swirl reaction DMG dealt is increased by (\d+)%/, unit: "Stellar Swirl DMG % while Herald of Frost is out", percent: true, reactions: [SS], radiance: SS, uptime: { talent: "skill", duration: "Duration", cdText: /reduced to (\d+)s/ } },
    ],
  },
  Sandrone: { from: "passive1", target: "self", radiance: [SC, SS] },
  // Passive 3 also converts the party's Superconduct and Cryo Swirl (tags.json `converts`) and raises their Base DMG
  // by up to 7% (converters' Base DMG bonus: #88).
  "Traveler (Cryo)": { from: "passive3", target: "own", radiance: [SC, SS], note: "enters Radiance; Base DMG bonus to the party's Stellar reactions is #88" },
  Vesna: { from: "combat2", target: "self", radiance: [SS] },
  // While Song of Ages Past (her Skill) lasts, Stellar Swirls make Wandering Vortexes, which shred Anemo RES.
  Vodyanitsa: {
    from: "passive1",
    target: "party",
    radiance: [],
    values: [{ kind: "resShred", re: /reduce nearby opponents' Anemo RES by (\d+)%/, unit: "Anemo RES from Wandering Vortex (Stellar Swirl during Song of Ages Past)", percent: true, elements: ["Anemo"], teamReactions: [SS], uptime: { talent: "skill", duration: "Duration", cd: "Skill CD" } }],
  },
  Wriothesley: { from: "passive4", target: "self", radiance: [SC] },
  "Yae Miko": { from: "passive4", target: "own", radiance: [SC], note: "her own Stellar-Conduct hits" },
  "Yumemizuki Mizuki": { from: "passive4", target: "self", radiance: [SS] },
};

function readStellar(id, spec) {
  const text = talentsOf(id)[spec.from].description.replace(/\s+/g, " ");
  const at = text.search(/Radiance|Wandering Vortex/);
  if (at < 0) throw new Error(`${id}: no Radiance text in ${spec.from}`);
  const start = text.lastIndexOf(". ", at) + 1; // the whole sentence it's in
  const source = `${spec.from}: "${text.slice(start).trim().split(/(?<=\.) /)[0]}"`;
  if (spec.target !== "party") return { target: spec.target, radiance: spec.radiance, ...(spec.note ? { note: spec.note } : {}), source };
  return {
    target: "party",
    radiance: spec.radiance,
    source,
    values: spec.values.map((v) => {
      const m = text.match(v.re);
      if (!m) throw new Error(`${id}: pattern ${v.re} not found in ${spec.from}: ${text}`);
      const attrs = talentsOf(id)[COMBAT[v.uptime.talent]].attributes;
      const cdMatch = v.uptime.cdText && text.match(v.uptime.cdText);
      if (v.uptime.cdText && !cdMatch) throw new Error(`${id}: pattern ${v.uptime.cdText} not found in ${spec.from}`);
      const cd = cdMatch ? Number(cdMatch[1]) : tableValue(attrs, v.uptime.cd, id);
      return {
        kind: v.kind,
        value: round(Number(m[1]) / (v.percent ? 100 : 1)),
        ...limits(v),
        ...(v.teamReactions ? { teamReactions: v.teamReactions } : {}),
        ...(v.radiance ? { radiance: v.radiance } : {}),
        unit: v.unit,
        uptime: uptime(tableValue(attrs, v.uptime.duration, id), cd),
      };
    }),
  };
}

// Sub-DPS hits (#95, part of #94). Each off-field sub-DPS's own damage: every hit source as its multiplier and
// scaling stat (talent level 9, from the talent tables), how often it hits and its cooldown. #96 turns this into
// damage over a rotation. How often a summon hits is mostly not in genshin-db's text ("at intervals"), so those
// rates come from data/kit-overrides.json `hitRates`, sourced from the Genshin Impact Wiki's Gameplay Notes.
//   talent, label: the table row with the multiplier; "A|{p} ATK+{q} DEF" and "×3" are read as such
//   cd: the table label for how often this source comes back (a summon recast, or the field duration when the
//       skill isn't recast before it ends)
//   hits: hits per use: a number, a pattern in the talent text, or "rate" (kit-overrides.json hitRates)
//   every: seconds between hits while it lasts: a pattern in the text, a table label, or "rate"; with duration
//   onCarryNormal: it hits when the active character's Normal Attacks hit (Xingqiu, Yelan, Beidou), at most once per
//       `every`; with `hits` too, that many hits each time (Xingqiu's swords per wave)
//   times: a multiplier from the text (Furina's Salon Members with 4 characters above 50% HP); timesNeedsHealer: only
//       when another healer keeps them there
//   needsReaction: it only fires after the party triggers a reaction (Nahida's Tri-Karma Purification)
//   lunar: the hit is direct Lunar reaction DMG of that reaction (#151; damage.ts's Lunar formula, no DMG Bonus)
//   whenReaction: it only fires while the team triggers that reaction (Ineffa's Overclocking Circuit: thunderclouds)
//   pickOne: only one source of this group fires per use; the scorer picks by the team's reactions (Columbina's
//       Gravity Interference: the Lunar reaction that built the most Gravity)
//   (per character, LUNAR_CONVERTERS below) lunarBaseBonus: { stat, perPoint, max, reactions }: their own Moonsign
//       Benediction's Base DMG bonus to their direct Lunar hits of those reactions
//   passive: { from, re, stat } the multiplier comes from a passive's text instead of the `label` row (`name` then
//       names the source; `label` still keys its hit rate and table values)
//   when: the source only hits under that condition ({ ascendantGleam: true }, like a carry hit's `when`)
//   icd: its elemental application ICD from kit-overrides.json `icd` (#190): "none" or { reset, every }; left out:
//     the standard 2.5s / every 3rd hit
//   A hitRates entry's `alternatives` ([{ when, hits?, every?, duration?, source }]) are passed through as the source's
//   `alternatives`: the first whose `when` matches the team replaces the default rate. when.topElement: that element
//   has the most party members among Pyro, Hydro, Electro and Cryo, ties going Pyro > Hydro > Electro > Cryo
//   (Jahoda's passive 1, #175).
//   addScaling: a passive that adds a share of a stat to this hit's damage, read from its text, e.g.
//       { from: "passive2", re: /increased by (\d+)% of Citlali's Elemental Mastery/, stat: "em" } (#172); `times`: it adds
//       to each of a "×N" row's instances (Lan Yan's Burst, #252)
//   dmgBonusPer: a passive that raises this hit's DMG per point of a stat, read from its text, e.g. Dendro
//       Traveler's 0.15% per EM: { from: "passive2", re: /Razorgrass Blade by ([\d.]+)%/, stat: "em" }; written as
//       `dmgBonusPerStat: { em: 0.0015 }` (DMG Bonus added per point) (#172)
//   boost: a passive that raises the DMG of a limited number of this source's hits per use by a share of a stat, capped
//       (Durin's Primordial Fusion, #195): { from, stacks, re, per, stat, max }, regexes into its text; written as
//       `boost: { stacks, perPoint, stat, max }`
const SUBDPS = {
  // Supports' own hits (#203): every character gets a damage profile, whatever their role. Their Skill and Burst hits,
  // from the talent tables; recurring hits at rates from the wiki's Gameplay Notes (kit-overrides.json hitRates).
  // Left out: conditional hits (Xilonen's Follow-Up Beat), and Xianyun's Starwicker (it raises teammates' plunges, a
  // buff her kit entry already has).
  Bennett: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  "Kaedehara Kazuha": [
    { talent: "skill", label: "Press Skill DMG", hits: 1, cd: "Press CD" },
    { talent: "burst", label: "Slashing DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "DoT", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Additional Elemental DMG", hits: "rate", cd: "CD" },
  ],
  // Passive 2: "Dominus Lapidis' Stone Stele, resonance, and hold DMG is increased by 1.9% of Max HP"; "Planet Befall's
  // DMG is increased by 33% of Max HP". The Hold makes the stele, which resonates on its own until the next Hold.
  Zhongli: [
    { talent: "skill", label: "Hold DMG", hits: 1, cd: "Hold CD", addScaling: [{ from: "passive2", re: /resonance, and hold DMG is increased by ([\d.]+)% of Max HP/, stat: "hp" }] },
    { talent: "skill", label: "Stone Stele/Resonance DMG", hits: "rate", cd: "Hold CD", addScaling: [{ from: "passive2", re: /resonance, and hold DMG is increased by ([\d.]+)% of Max HP/, stat: "hp" }] },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD", addScaling: [{ from: "passive2", re: /Planet Befall's DMG is increased by ([\d.]+)% of Max HP/, stat: "hp" }] },
  ],
  Xianyun: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Driftcloud Wave DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Xilonen: [
    { talent: "skill", label: "Rush DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Sucrose: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "DoT", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Additional Elemental DMG", hits: "rate", cd: "CD" },
  ],
  // Quickswap, as KQM's guide plays them (#236): "a quick 3-hit Skill for damage and Elemental Particles every 8
  // seconds" (the Hold's 2 Initial Cutting ticks, then the Storm on release; its CD is the 8s Max Charging CD), and
  // the Burst.
  "Traveler (Anemo)": [
    { talent: "skill", label: "Initial Cutting DMG", hits: "rate", cd: "Max Charging CD" },
    { talent: "skill", label: "Initial Storm DMG", hits: 1, cd: "Max Charging CD" },
    { talent: "burst", label: "Tornado DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Additional Elemental DMG", hits: "rate", cd: "CD" },
  ],
  "Sangonomiya Kokomi": [
    { talent: "skill", label: "Ripple DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  "Kuki Shinobu": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Grass Ring of Sanctification DMG", every: /every ([\d.]+)s/, duration: "Duration", cd: "CD" },
    { talent: "burst", label: "Single Instance DMG", hits: "rate", cd: "CD" },
  ],
  // Lan Yan off field (#252): her Skill's thrown Feathermoon Rings "deal three instances of Anemo DMG total, even if
  // there is only one opponent" (Genshin Impact Wiki, Lan Yan, fetched 2026-10-18), her Burst's row is "×3", and
  // passive 2 adds 309% / 774% of her EM to each. Left out: the 50% absorbed-element ring hits (passive 1).
  "Lan Yan": [
    { talent: "skill", label: "Feathermoon Ring DMG", hits: 3, cd: "CD", addScaling: [{ from: "passive2", re: /equal to (\d+)% and \d+% of Lan Yan's Elemental Mastery/, stat: "em" }] },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD", addScaling: [{ from: "passive2", re: /and (\d+)% of Lan Yan's Elemental Mastery respectively/, stat: "em", times: 3 }] },
  ],
  // Raiden off field (#252; Eula, national teams): her Skill's hit, then the Eye of Stormy Judgment's coordinated attack
  // "every 0.9s per party" while the on-field character attacks, for its Duration; recast before it ends. Her Burst is
  // her own field time, not counted here.
  "Raiden Shogun": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Coordinated ATK DMG", every: /one coordinated attack every ([\d.]+)s per party/, duration: "Duration", cd: "CD" },
  ],
  Shenhe: [
    { talent: "skill", label: "Press Skill DMG", hits: 1, cd: "Press CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "DoT", hits: "rate", cd: "CD" },
  ],
  Faruzan: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Pressurized Collapse Vortex DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  // Batch 3. Left out for want of a count: Chevreuse's Secondary Explosive Shells and Overcharged Ball (Overloaded
  // only), Yaoyao's Burst radishes (they depend on how many Yuegui are out), Layla's Shooting Stars.
  Baizhu: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Spiritvein DMG", hits: "rate", cd: "CD" },
  ],
  Chevreuse: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Explosive Grenade DMG", hits: 1, cd: "CD" },
  ],
  Diona: [
    { talent: "skill", label: "Icy Paw DMG", hits: /Rapidly fires off (\d+) Icy Paws/, cd: "Press CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Continuous Field DMG", hits: "rate", cd: "CD" },
  ],
  Gorou: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Crystal Collapse DMG", every: /Generates 1 Crystal Collapse every ([\d.]+)s/, duration: "Duration", cd: "CD" },
  ],
  Mona: [
    { talent: "skill", label: "DoT", hits: "rate", cd: "CD" },
    { talent: "skill", label: "Explosion DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Illusory Bubble Explosion DMG", hits: 1, cd: "CD" },
  ],
  Nicole: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Arcane Projection DMG", hits: "Arcane Projection Attack Count", cd: "CD" },
  ],
  "Yun Jin": [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Yaoyao: [
    { talent: "skill", label: "White Jade Radish DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Layla: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Starlight Slug DMG", hits: "rate", cd: "CD" },
  ],
  Iansan: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  // Batch 4. Left out: Ifa's Tonicshots (his Skill is an on-field mode) and Sedation Mark (no count found), Jean's
  // field entering/exiting hits, Mika's Rimestar Flare (it needs the Flowfrost Arrow to hit several opponents).
  Barbara: [{ talent: "skill", label: "Droplet DMG", hits: "rate", cd: "CD" }],
  Candace: [
    { talent: "skill", label: "Basic DMG", hits: 1, cd: "Press CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Wave Impact DMG", hits: "Wave Instances", cd: "CD" },
  ],
  Charlotte: [
    { talent: "skill", label: "Photo DMG (Press)", hits: 1, cd: "CD" },
    { talent: "skill", label: "\"Snappy Silhouette\" Mark DMG", every: "\"Snappy Silhouette\" Mark Trigger Interval", duration: "\"Snappy Silhouette\" Mark Duration", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Kamera DMG", hits: "rate", cd: "CD" },
  ],
  Dahlia: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "Skill CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Dori: [
    { talent: "skill", label: "Troubleshooter Shot DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "After-Sales Service Round DMG", hits: /create (\d+) After-Sales Service Rounds/, cd: "CD" },
    { talent: "burst", label: "Connector DMG", every: /every ([\d.]+)s/, duration: "Duration", cd: "CD" },
  ],
  Ifa: [{ talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" }],
  Illuga: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Jean: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Burst DMG", hits: 1, cd: "CD" },
  ],
  Kirara: [
    { talent: "skill", label: "Tail-Flicking Flying Kick DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Cat Grass Cardamom Explosion DMG", hits: "rate", cd: "CD" },
  ],
  "Kujou Sara": [
    { talent: "skill", label: "Tengu Juurai: Ambush DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Tengu Juurai: Titanbreaker DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Tengu Juurai: Stormcluster DMG", hits: /into (\d+) consecutive bouts of Tengu Juurai: Stormcluster/, cd: "CD" },
  ],
  Mika: [{ talent: "skill", label: "Flowfrost Arrow DMG", hits: 1, cd: "CD" }],
  Qiqi: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Herald of Frost DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Sayu: [
    { talent: "skill", label: "Fuufuu Whirlwind Kick Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill Activation DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Muji-Muji Daruma DMG", hits: "rate", cd: "CD" },
  ],
  Thoma: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Fiery Collapse DMG", onCarryNormal: true, every: /Fiery Collapse can be triggered once every ([\d.]+)s/, duration: "Scorching Ooyoroi Duration", cd: "CD" },
  ],
  "Traveler (Electro)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Falling Thunder DMG", onCarryNormal: true, every: /One instance of Falling Thunder can be generated every ([\d.]+)s/, duration: "Duration", cd: "CD" },
  ],
  Vodyanitsa: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "Skill CD" },
    { talent: "skill", label: "Horn of Spring's Call DMG", every: "Horn of Spring's Call Attack Interval", duration: "Duration", cd: "Skill CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Xinyan: [
    { talent: "skill", label: "Swing DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Pyro DoT", hits: "rate", cd: "CD" },
  ],
  Aino: [
    { talent: "skill", label: "Stage 1 DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Stage 2 DMG", hits: 1, cd: "CD" },
    // Passive 2 (#172): "Aino's Elemental Burst DMG is increased by 50% of her Elemental Mastery" (every water ball).
    {
      talent: "burst",
      label: "Water Ball DMG",
      hits: "rate",
      cd: "CD",
      addScaling: [{ from: "passive2", re: /Elemental Burst DMG is increased by (\d+)% of her Elemental Mastery/, stat: "em" }],
    },
  ],
  Albedo: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "Duration" },
    { talent: "skill", label: "Transient Blossom DMG", every: /generated once every (\d+)s/, duration: "Duration", cd: "Duration" },
    { talent: "burst", label: "Burst DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Fatal Blossom DMG", hits: /(\d+) Fatal Blossoms/, cd: "CD" },
  ],
  Alyosha: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Fulgurite Hunting Field DMG", every: /Every (\d+)s, deals/, duration: "Duration", cd: "CD" },
    { talent: "burst", label: "Tugarin DMG", every: /maul them every (\d+)s/, duration: "Duration", cd: "CD" },
  ],
  Amber: [
    { talent: "skill", label: "Explosion DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Total Fiery Rain DMG", hits: 1, cd: "CD" },
  ],
  Beidou: [
    { talent: "skill", label: "Base DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Lightning DMG", onCarryNormal: true, perSecond: /A maximum of (\d+) lightning discharge can be triggered per second/, duration: "Duration", cd: "CD" },
  ],
  Chiori: [
    { talent: "skill", label: "Upward Sweep Attack DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Tamoto DMG", every: "Tamoto Attack Interval", duration: "Tamoto Duration", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Chongyun: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: /summons (\d+) giant spirit blades/, cd: "CD" },
  ],
  Citlali: [
    { talent: "skill", label: "Obsidian Tzitzimitl DMG", hits: 1, cd: "CD" },
    // Passive 2 (#172): "Frostfall Storm DMG is increased by 90% of Citlali's Elemental Mastery" during her Skill,
    // "Ice Storm DMG is increased by 1200%" during her Burst: both hits only exist then.
    {
      talent: "skill",
      label: "Frostfall Storm DMG",
      hits: "rate", // limited by her Nightsoul points (kit-overrides.json)
      cd: "CD",
      addScaling: [{ from: "passive2", re: /Frostfall Storm DMG is increased by (\d+)% of Citlali's Elemental Mastery/, stat: "em" }],
    },
    {
      talent: "burst",
      label: "Ice Storm DMG",
      hits: 1,
      cd: "CD",
      addScaling: [{ from: "passive2", re: /Ice Storm DMG is increased by (\d+)% of Citlali's Elemental Mastery/, stat: "em" }],
    },
    { talent: "burst", label: "Spiritvessel Skull DMG", hits: 1, cd: "CD" },
  ],
  Columbina: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Gravity Ripple: Continuous DMG", every: "rate", duration: "Gravity Ripple Duration", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    // Gravity Interference (#151): one kind per trigger, the Lunar reaction that built the most Gravity. Rate: every
    // 6s at C0 (kit-overrides.json); KeqingMains' Columbina quick guide (accessed 2026-10-12): C2 "decreases the
    // interval between each Gravity Interference attack from 6s to around 4.5s", and the type is "based on the most
    // frequent Lunar Reaction".
    ...["Lunar-Charged", "Lunar-Bloom", "Lunar-Crystallize"].map((r) => ({
      talent: "skill",
      label: `Gravity Interference: ${r} DMG`,
      every: "rate",
      duration: "Gravity Ripple Duration",
      cd: "CD",
      lunar: r.toLowerCase(),
      whenReaction: r.toLowerCase(),
      pickOne: "Gravity Interference",
    })),
  ],
  Collei: [
    { talent: "skill", label: "Skill DMG", hits: 2, cd: "CD" }, // out and back ("dealing Dendro DMG once again")
    { talent: "burst", label: "Explosion DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Leap DMG", hits: "rate", cd: "CD" },
  ],
  Dehya: [
    { talent: "skill", label: "Indomitable Flame DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Field DMG", every: /This effect can be triggered once every ([\d.]+)s/, duration: "Field Duration", cd: "CD" },
    { talent: "burst", label: "Flame-Mane's Fist DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Incineration Drive DMG", hits: 1, cd: "CD" },
  ],
  Durin: [
    { talent: "skill", label: "Transmutation: Confirmation of Purity DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Principle of Purity: As the Light Shifts DMG", hits: 1, cd: "CD" },
    // Passive 2 (#195): each Burst gives 10 Primordial Fusion stacks; a dragon hit uses one for "3% of the original DMG
    // for every 100 ATK", up to 75%: 10 of the ~18 hits per Burst.
    {
      talent: "burst",
      label: "Dragon of White Flame DMG",
      every: "rate",
      duration: "Dragon of White Flame Duration",
      cd: "CD",
      boost: { from: "passive2", stacks: /gains (\d+) stacks of Primordial Fusion/, re: /by ([\d.]+)% of the original DMG for every 100 ATK/, per: 100, stat: "atk", max: /maximum of (\d+)% additional DMG/ },
    },
  ],
  Emilie: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "Skill CD" },
    { talent: "skill", label: "Level 1 Lumidouce Case Attack DMG", every: "rate", duration: "Lumidouce Case Duration", cd: "Skill CD" },
    { talent: "skill", label: "Spiritbreath Thorn DMG", every: "Spiritbreath Thorn Interval", duration: "Lumidouce Case Duration", cd: "Skill CD" },
    // Dew falls every 0.3s, but one opponent can be targeted only every 0.7s: that's the single-target rate.
    { talent: "burst", label: "Level 3 Lumidouce Case Attack DMG", every: /1 opponent can become the target every ([\d.]+) seconds/, duration: "Level 3 Lumidouce Case Duration", cd: "CD" },
  ],
  Escoffier: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "Press CD" },
    { talent: "skill", label: "Frosty Parfait DMG", every: "rate", duration: "Cold Storage Mode Duration", cd: "Press CD" },
    { talent: "skill", label: "Surging Blade DMG", every: "Surging Blade CD Interval", duration: "Cold Storage Mode Duration", cd: "Press CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Fischl: [
    { talent: "skill", label: "Summoning DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Oz's ATK DMG", every: "rate", duration: "rate", cd: "CD" },
    { talent: "burst", label: "Falling Thunder DMG", hits: 1, cd: "CD" },
  ],
  Furina: [
    { talent: "skill", label: "Ousia Bubble DMG", hits: 1, cd: "CD" },
    ...["Gentilhomme Usher DMG", "Surintendante Chevalmarin DMG", "Mademoiselle Crabaletta DMG"].map((label) => ({
      talent: "skill",
      label,
      every: "rate",
      duration: "Duration",
      cd: "CD",
      times: /(\d+)% of their original DMG/, // the 4-character value of "110%/120%/130%/140%"
      // Only members above 50% HP count, and the Salon drains them to 50%: without another healer they stay there
      // after the first rotation, so the bonus needs a healer (#130), like her Fanfare ceiling.
      timesNeedsHealer: true,
    })),
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Ineffa: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Birgitta Discharge DMG", every: "rate", duration: "Birgitta Duration", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    // Overclocking Circuit (#151): with thunderclouds nearby, each Discharge adds an attack "considered Lunar-Charged
    // DMG" (passive 1), so it shares the Discharge's rate.
    {
      talent: "skill",
      label: "Birgitta Discharge DMG",
      name: "Overclocking Circuit (passive 1)",
      passive: { from: "passive1", re: /equal to (\d+)% of Ineffa's ATK/, stat: "atk" },
      every: "rate",
      duration: "Birgitta Duration",
      cd: "CD",
      lunar: "lunar-charged",
      whenReaction: "lunar-charged",
    },
  ],
  Jahoda: [
    { talent: "skill", label: "Filled Treasure Flask DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    // The robots only deal damage at Ascendant Gleam (KQM), so the source carries that condition (#100).
    { talent: "burst", label: "Purrsonal Coordinated Assistance Robot DMG", hits: "rate", cd: "CD", when: { ascendantGleam: true } },
  ],
  Kachina: [
    { talent: "skill", label: "Turbo Twirly Independent DMG", every: "rate", duration: "rate", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Kaeya: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: "rate", cd: "CD" },
  ],
  Lauma: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Frostgrove Sanctuary Attack DMG", every: "rate", duration: "Frostgrove Sanctuary Duration", cd: "CD" },
  ],
  Linnea: [{ talent: "skill", label: "Lumi Pound-Pound Pummeler DMG", every: "rate", duration: "Lumi Duration", cd: "CD" }],
  Lisa: [
    { talent: "skill", label: "Stack 3 Conductive Hold DMG", hits: 1, cd: "Holding CD" },
    { talent: "burst", label: "Discharge DMG", hits: "rate", cd: "CD" },
  ],
  Lynette: [
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Bogglecat Box DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "Vivid Shot DMG", hits: "rate", cd: "CD" }, // once it absorbs Hydro/Pyro/Cryo/Electro
  ],
  Nahida: [
    { talent: "skill", label: "Hold DMG", hits: 1, cd: "Seed of Skandha Duration" },
    { talent: "skill", label: "Tri-Karma Purification DMG", every: "Tri-Karma Purification Trigger Interval", duration: "Seed of Skandha Duration", cd: "Hold CD", needsReaction: /(After you trigger Elemental Reactions on opponents)/ },
  ],
  Nilou: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Luminous Illusion/Water Wheel DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Lingering Aeon DMG", hits: 1, cd: "CD" },
  ],
  Odette: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: '"Plume" Dance Move DMG', every: "rate", duration: "Solo Dance Double Duration", cd: "CD" },
    { talent: "skill", label: '"Wing" Dance Move DMG', every: "rate", duration: "Solo Dance Double Duration", cd: "CD" },
    { talent: "skill", label: "Coda at Dawn's Tolling Stellar-Conduct/Stellar Swirl DMG", hits: 1, cd: "Coda at Dawn's Tolling CD" },
    { talent: "burst", label: "Slash DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Final Slash DMG", hits: 1, cd: "CD" },
  ],
  Ororon: [
    { talent: "skill", label: "Spirit Orb DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Ritual DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Soundwave Collision DMG", hits: "rate", cd: "CD" },
  ],
  Prune: [
    { talent: "skill", label: "Ring-A-Ding-Ding! Hexhunter Chime DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Witchlure Bell DMG", hits: "rate", cd: "CD" },
  ],
  Rosaria: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Ice Lance DoT", hits: "rate", cd: "CD" },
  ],
  Sigewinne: [
    { talent: "skill", label: "Bolstering Bubblebalm DMG", hits: /After bouncing (\d+) times/, cd: "CD" },
    { talent: "burst", label: "Skill DMG", every: "rate", duration: "Duration", cd: "CD" },
  ],
  // Passive 2 Verdant Luxury (#172): "Every point of Elemental Mastery ... increases the DMG dealt by Razorgrass Blade
  // by 0.15% and the DMG dealt by Surgent Manifestation by 0.1%" (Skill and Burst).
  "Traveler (Dendro)": [
    {
      talent: "skill",
      label: "Skill DMG",
      hits: 1,
      cd: "CD",
      dmgBonusPer: [{ from: "passive2", re: /DMG dealt by Razorgrass Blade by ([\d.]+)%/, stat: "em" }],
    },
    {
      talent: "burst",
      label: "Lea Lotus Lamp Attack DMG",
      hits: "rate",
      cd: "CD",
      dmgBonusPer: [{ from: "passive2", re: /DMG dealt by Surgent Manifestation by ([\d.]+)%/, stat: "em" }],
    },
  ],
  "Traveler (Pyro)": [
    { talent: "skill", label: "Blazing Threshold", every: "rate", duration: "rate", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  "Traveler (Geo)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "DMG Per Shockwave", hits: "rate", cd: "CD" },
  ],
  // Off-field: the Frostpierce Star's ice crystals and the Burst's javelin strikes (not the 2 extra strikes at 8
  // Frostglow, which on-field Stellar-Conduct play builds). Under Radiance: Stellar-Conduct the crystals follow the
  // Traveler's own attacks instead, which is on-field play (#136).
  "Traveler (Cryo)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Ice Crystal DMG", every: "rate", duration: "Frostpierce Star Duration", cd: "CD" },
    { talent: "burst", label: "Ice Javelin DMG", hits: "No. of Strikes in Attack", cd: "CD" },
  ],
  Venti: [
    { talent: "skill", label: "Press DMG", hits: 1, cd: "Press CD" },
    { talent: "burst", label: "DoT", hits: "rate", cd: "CD" },
  ],
  Xiangling: [
    { talent: "skill", label: "Flame DMG", hits: "rate", cd: "CD" },
    { talent: "burst", label: "1-Hit Swing DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "2-Hit Swing DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "3-Hit Swing DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Pyronado DMG", hits: "rate", cd: "CD" },
  ],
  Xingqiu: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Sword Rain DMG", onCarryNormal: true, every: "rate", hits: "rate", duration: "Duration", cd: "CD" },
  ],
  "Yae Miko": [
    // Three Sesshou Sakura at level 3 ("A maximum of 3"), each striking as often as the wiki says.
    { talent: "skill", label: "Sesshou Sakura DMG: Level 3", hits: "rate", times: /A maximum of (\d+) Sesshou Sakura/, cd: "Duration" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Tenko Thunderbolt DMG", hits: 3, cd: "CD" }, // one per Sesshou Sakura
  ],
  Yelan: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Exquisite Throw DMG", onCarryNormal: true, every: /Can occur once every (second)/, duration: "Duration", cd: "CD" },
  ],
};

// A table row's multiplier per stat, at TALENT_LEVEL: "{p1:P} ATK+{p2:P} DEF" -> { atk, def }, "{p:F2P} Max HP" -> { hp },
// "{p1:P}+{p2:P}" (two hits) -> their sum, "... ×3" -> three times, "({a} ATK+{b} EM)×2" -> both twice.
// "{a}/{b}" lists alternatives (Low/High Plunge, Raiden's Initial/per-stack Resolve): `pick` chooses one (default
// the first); a stat word only after the last alternative ("{a}/{b} Max HP") applies to all of them.
const STAT_WORDS = [
  [/^Max HP/, "hp"],
  [/^DEF/, "def"],
  [/^Elemental Mastery/, "em"],
  [/^ATK/, "atk"],
];
function scalingOf(attrs, label, id, pick = 0) {
  const entry = attrs.labels.find((l) => l.split("|")[0].trim() === label);
  if (!entry) throw new Error(`${id}: no talent label "${label}" (labels: ${attrs.labels.join("; ")})`);
  const format = entry.slice(entry.indexOf("|") + 1).replace(/[()]/g, "");
  const alts = format.split(/(?<=\}[^{}]*)\/(?=[^{}]*\{)/);
  if (pick >= alts.length) throw new Error(`${id}: label "${label}" has no alternative ${pick}`);
  let alt = alts[pick];
  const shared = alts[alts.length - 1].slice(alts[alts.length - 1].lastIndexOf("}") + 1).replace(/\s*[×x]\s*\d+\s*$/, "");
  if (!alt.slice(alt.lastIndexOf("}") + 1).replace(/\s*[×x]\s*\d+\s*$/, "").trim()) alt = alt.replace(/(\s*[×x]\s*\d+\s*)?$/, shared + "$1");
  const times = Number(alt.match(/[×x]\s*(\d+)\s*$/)?.[1] ?? 1);
  alt = alt.replace(/\s*[×x]\s*\d+\s*$/, "");
  const out = {};
  // "{a}+{b}" with no stat words between them are hits of the same stat; a stat word after a value names its stat.
  const terms = [...alt.matchAll(/\{(param\d+):[^}]*\}\s*([^{+]*)/g)];
  let pending = [];
  for (const [, key, words] of terms) {
    const value = attrs.parameters[key]?.[TALENT_LEVEL - 1];
    if (value === undefined) throw new Error(`${id}: label "${label}" has no level ${TALENT_LEVEL} value for ${key}`);
    pending.push(value);
    const w = words.trim();
    if (!w && terms[terms.length - 1][1] !== key) continue; // a bare term: its stat comes later (or ATK)
    const stat = STAT_WORDS.find(([re]) => re.test(w))?.[1] ?? "atk";
    out[stat] = round((out[stat] ?? 0) + pending.reduce((a, b) => a + b, 0) * times);
    pending = [];
  }
  return out;
}

function readSubDps(id, specs) {
  const talents = talentsOf(id);
  const rates = OVERRIDES.hitRates?.[id] ?? {};
  const icds = OVERRIDES.icd?.[id] ?? {}; // elemental application ICD per source (#190)
  const missing = [];
  const sources = [];
  for (const s of specs) {
    const attrs = talents[COMBAT[s.talent]].attributes;
    const text = talents[COMBAT[s.talent]].description.replace(/\s+/g, " ");
    const rate = rates[`${s.talent}: ${s.label}`];
    const needsRate = [s.hits, s.every, s.duration].includes("rate");
    if (needsRate && !rate) throw new Error(`${id}: "${s.label}" needs a kit-overrides.json hitRates entry`);
    if (needsRate && rate.missing) {
      missing.push(`${s.label}: ${rate.missing}`);
      continue;
    }
    const fromText = (re) => {
      const m = text.match(re);
      if (!m) throw new Error(`${id}: pattern ${re} not found in ${s.talent}: ${text}`);
      return m[1] === "second" ? 1 : Number(m[1]);
    };
    const fromTextRaw = (re) => {
      if (!re.test(text)) throw new Error(`${id}: pattern ${re} not found in ${s.talent}: ${text}`);
      return true;
    };
    const value = (v, rateKey) =>
      v === undefined ? undefined : v === "rate" ? rate[rateKey] : typeof v === "number" ? v : typeof v === "string" ? tableValue(attrs, v, id) : fromText(v);
    const every = s.perSecond ? 1 / fromText(s.perSecond) : value(s.every, "every");
    // A passive's number (#172): "...by 90% of Citlali's Elemental Mastery" -> 0.9.
    const passiveValue = (p) => {
      const ptext = talents[p.from]?.description.replace(/\s+/g, " ") ?? "";
      const m = ptext.match(p.re);
      if (!m) throw new Error(`${id}: pattern ${p.re} not found in ${p.from}: ${ptext}`);
      return Number(m[1]) / 100;
    };
    // `passive`: the whole hit is a passive's (Ineffa's Overclocking Circuit); `addScaling` adds to a talent hit's.
    const scaling = s.passive ? { [s.passive.stat]: passiveValue(s.passive) } : scalingOf(attrs, s.label, id);
    for (const p of s.addScaling ?? []) scaling[p.stat] = round((scaling[p.stat] ?? 0) + passiveValue(p) * (p.times ?? 1));
    const dmgBonusPerStat = s.dmgBonusPer ? Object.fromEntries(s.dmgBonusPer.map((p) => [p.stat, round(passiveValue(p))])) : undefined;
    const boost = s.boost && {
      stacks: passiveValue({ from: s.boost.from, re: s.boost.stacks }) * 100,
      perPoint: round(passiveValue(s.boost) / s.boost.per),
      stat: s.boost.stat,
      max: passiveValue({ from: s.boost.from, re: s.boost.max }),
    };
    sources.push({
      talent: s.talent,
      label: s.name ?? s.label,
      scaling,
      ...(dmgBonusPerStat ? { dmgBonusPerStat } : {}),
      ...(boost ? { boost } : {}),
      ...(s.hits !== undefined ? { hits: value(s.hits, "hits") } : {}),
      ...(every !== undefined ? { every, duration: value(s.duration, "duration") } : {}),
      ...(s.onCarryNormal ? { onCarryNormal: true } : {}),
      ...(s.needsReaction && fromTextRaw(s.needsReaction) ? { needsReaction: true } : {}),
      ...(s.when ? { when: s.when } : {}),
      ...(s.times ? { times: fromText(s.times) / (fromText(s.times) > 10 ? 100 : 1) } : {}),
      ...(s.timesNeedsHealer ? { timesNeedsHealer: true } : {}),
      ...(s.lunar ? { lunar: s.lunar } : {}),
      ...(s.whenReaction ? { whenReaction: s.whenReaction } : {}),
      ...(s.pickOne ? { pickOne: s.pickOne } : {}),
      cd: tableValue(attrs, s.cd, id),
      ...(needsRate ? { rateSource: rate.source } : {}),
      ...(icds[`${s.talent}: ${s.label}`] ? { icd: icds[`${s.talent}: ${s.label}`] } : {}),
      ...(needsRate && rate.alternatives ? { alternatives: rate.alternatives.map(({ source, ...alt }) => ({ ...alt, rateSource: source })) } : {}),
    });
  }
  return { sources, ...(missing.length ? { missing } : {}) };
}

// Carry damage (#101, part of #94): what one rotation of each main DPS deals, so #96 can measure sub-DPS damage
// against the carry's own instead of a generic benchmark. First the 16 carries `npm run compare` measures; the rest
// are listed as missing until later PRs. Read at talent level 9 and C0.
//   hits: the rotation's hits, matched to the rotation tags in data/tags.json:
//     table: normal | skill | burst (which talent table), label (+ pick for "a/b" rows), count per rotation,
//     type: normal | charged | plunge | skill | burst (the DMG type, for buffs), instances (separate hits in one row,
//     for buffs added per hit; default 1), count "rate" (kit-overrides.json hitRates, keyed "carry: <label>"),
//     reacting (how many of `count` trigger the combo's amplifying reaction, where the source says; else from the
//     hit's kit-overrides.json carryIcd entry, icdReacting #226; damage.ts uses its flat estimate for hits with
//     neither), lunar (the hit is direct Lunar reaction DMG of that reaction, #135),
//     when (the hit only lands with { reaction } active and/or at { ascendantGleam: true } / { secretRite: true })
//     collision (a plunge's collision hit: no flat team bonus, as Xianyun's is for the shockwave only),
//     ofRow ({ table, label }: the hit deals that row's share of its own row, as Razor's Soul Companion; with `as`, its
//     own label)
//   combo: the default combo in KQM notation, the one `hits` model and the rotation tags in data/tags.json follow
//   combos (#114): other sourced combos, for the teams they fit. damage.ts takes the first whose `when` matches the
//   team being scored, else the default. Each has combo, hits (the whole rotation, in the format above), buffs (only
//   when they differ from the default's) and when: a list of alternatives, each { reaction (one of the team's active
//   reactions; amplifying ones then multiply this combo's hits), members (a list of id lists: a teammate from each),
//   elements (exact number of teammates of that element), radiance (their own Stellar family is active: Witch's
//   Revelation done, #124) }. Picking a combo by whether its Energy needs are met
//   waits on particle energy (#37).
//   buffs: the carry's own buffs during those hits:
//     atkFromHp (Hu Tao), atkPct, dmgBonus (types), factor (types; a table value, or from + re: a % of the DMG),
//     addPerStack (+ATK multiplier per stack per hit instance: Raiden's Resolve, Mavuika's Fighting Spirit),
//     dmgBonusFromEr (Raiden), masque (Arlecchino), flatAtk (+ATK multiplier x stacks per hit, capped, while one of
//     `reactions` is active: Clorinde), emFromAtk (EM from a share of ATK, capped: Flins), lunarBaseBonus (their
//     Moonsign Benediction's Base DMG bonus to their Lunar reaction per point of a stat, capped: it also applies to
//     their own direct Lunar hits, #135), lunarReactionBonus (Reaction DMG Bonus to their direct hits of that Lunar
//     reaction: Flins), baseDmgMultiplier (labels: Nefer's Veil of Falsehood), emBonus. A buff's `when` ({ reaction,
//     ascendantGleam, secretRite, noHealer }) gates it like a hit's.
//   A hit's `nightsoulBursts` (#288): one per party Nightsoul Burst in the rotation, on that many of the hits with
//   that label at most (Kinich's Hunter's Experience on his next Cannon); damage.ts counts them. Give it count 0.
//   A hit's `additive` marks a Reaction Additive Base DMG Bonus to a Lunar hit (Zibai's passive 1, #146).
//   missing: parts of the rotation not modeled yet, so the damage is too low (none left since #135)
// The rotation lasts as long as a sourced length (data/kit-overrides.json `rotations`, #103: a default, plus lengths
// for teams that fit a combo-style `when`), else the carry's Elemental Burst cooldown (Jessie's earlier choice).
// Team-conditional effects (reactions, Nightsoul Bursts, Moonsign, teammates' elements) are left to the scorer, except
// hits that only exist with them (`when`).
const N = "normal", CH = "charged", PL = "plunge", SK = "skill", BU = "burst";
// Navia's hits in "Q 2[E N3D N2]" (#203): 2 Gunbrella shots, 1 Surging Blade, the 2 Normal Attack strings, her Burst
// and its Cannon Fire Support (every 0.75s for 12s, wiki). Her combos differ only in the Shardshots' buffs.
const naviaHits = [
  { table: "skill", label: "Rosula Shardshot Base DMG", count: 2, type: SK },
  { table: "skill", label: "Surging Blade DMG", count: 1, type: SK },
  { table: "normal", label: "1-Hit DMG", count: 4, type: N },
  { table: "normal", label: "2-Hit DMG", count: 4, type: N },
  { table: "normal", label: "3-Hit DMG", count: 2, type: N },
  { table: "burst", label: "Skill DMG", count: 1, type: BU },
  { table: "burst", label: "Cannon Fire Support DMG", count: 16, type: BU },
];
// Mavuika's combos (#114) differ only in their Flamestrider Charged Attacks: E, Q (Sunfell Slice), then Cyclic/Final.
// These are her Melt and Vaporize combos, and Sunfell Slice reacts in them (#121, web research 2026-10-13: KQM's
// Mavuika quick guide has the Burst hit melt/vaporize, about a third of her damage), so `reacting: 1`.
const mavuikaHits = ({ cyclic, cyclicReacting, final = 0, finalReacting }) => [
  { table: "skill", label: "Skill DMG", count: 1, type: SK },
  { table: "burst", label: "Skill DMG", count: 1, reacting: 1, type: BU, fightingSpirit: "sunfell" },
  { table: "skill", label: "Flamestrider Charged Attack Cyclic DMG", count: cyclic, reacting: cyclicReacting, type: CH, fightingSpirit: "ca" },
  ...(final ? [{ table: "skill", label: "Flamestrider Charged Attack Final DMG", count: final, reacting: finalReacting, type: CH, fightingSpirit: "ca" }] : []),
];
// Arlecchino's combos (#119): her Skill (Spike, then the Cleave when she claims the Directive), `ca` Charged Attacks,
// strings[n] Normal Attack n-Hits (the 4-Hit row is two hits) and her Burst.
const arlecchinoHits = ({ ca, strings }) => [
  { table: "skill", label: "Spike DMG", count: 1, type: SK },
  { table: "skill", label: "Cleave DMG", count: 1, type: SK },
  { table: "normal", label: "Charged Attack DMG", count: ca, type: CH },
  ...Object.entries(strings).map(([n, count]) => ({ table: "normal", label: `${n}-Hit DMG`, count, type: N, ...(n === "4" ? { instances: 2 } : {}) })),
];
const CARRIES = {
  "Hu Tao": {
    // E, N2C x7, Q every other rotation. KeqingMains quick guide (fetched 2026-10-12): N2C is "optimal for most Hu Tao
    // teams", "around 7N2CJ" at C0; Burst "every other rotation", since building Energy for it each rotation costs
    // damage. Blood Blossom ticks every 4s for 8s ("Blood Blossom Duration").
    combo: "E 7[N2CJ] (Q)",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 7, type: N },
      { table: "normal", label: "2-Hit DMG", count: 7, type: N },
      { table: "normal", label: "Charged Attack", count: 7, type: CH },
      { table: "skill", label: "Blood Blossom DMG", count: 2, type: SK },
      { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
    ],
    buffs: [
      { kind: "atkFromHp", table: "skill", label: "ATK Increase", cap: /cannot exceed (\d+)% of Hu Tao's Base ATK/ },
      // Passive 2: +33% Pyro DMG at 50% HP or less. KeqingMains' Hu Tao quick guide (fetched 2026-10-18): "Hu Tao should
      // be kept at below 50% HP to maximize her damage, making it tricky to use healers with her", and "she can still deal
      // a large amount of damage without this Passive active": off with a teammate who heals her (#2; Bennett's Burst
      // heals below 70% HP, so it counts).
      {
        kind: "dmgBonus",
        from: "passive2",
        re: /Pyro DMG Bonus is increased by (\d+)%/,
        types: [N, CH, PL, SK, BU],
        when: { noHealer: true },
      },
    ],
    combos: [
      {
        // #119. KQM's Hu Tao quick guide (https://keqingmains.com/q/hu-tao-quickguide/, fetched 2026-10-20): "At
        // Constellation 0, N1CJ is Hu Tao's best combo to use in Freeze/Melt teams and VV Vape teams with Thoma and
        // without C6 Xingqiu"; N1C: "players should aim for 7 or 8" (midpoint 7.5). Freeze/Melt is its Vapemelt
        // archetype ("Hu Tao, a Hydro unit, and two Cryo units"), still amplified by Vaporize here; its VV Vape team is
        // Hu Tao, Xingqiu, Sucrose, Thoma (Anemo: the two its teammate list names for Swirling Pyro, Sucrose and
        // Kazuha). Skill and Burst as in the default.
        combo: "E 7.5[N1CJ] (Q)",
        when: [
          { reaction: "vaporize", elements: { Cryo: 2 } },
          { reaction: "vaporize", members: [["Thoma"], ["Sucrose", "Kaedehara Kazuha"]] },
        ],
        hits: [
          { table: "normal", label: "1-Hit DMG", count: 7.5, type: N },
          { table: "normal", label: "Charged Attack", count: 7.5, type: CH },
          { table: "skill", label: "Blood Blossom DMG", count: 2, type: SK },
          { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
        ],
      },
    ],
  },
  "Raiden Shogun": {
    // E, Q, 3[N3C] N1C in Musou Isshin (its Normal/Charged Attacks count as Elemental Burst DMG): one of KeqingMains'
    // quick guide combos (fetched 2026-10-12). The Eye's coordinated attacks: one every 0.9s while she attacks during
    // Musou Isshin's 7s. Resolve: 60, the max (KQM: "quite common to reach maximum Resolve stacks").
    combo: "E Q 3[N3C] N1C",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "skill", label: "Coordinated ATK DMG", count: 7, type: SK },
      { table: "burst", label: "Musou no Hitotachi Base DMG", count: 1, type: BU, resolve: "initial" },
      { table: "burst", label: "1-Hit DMG", count: 4, type: BU, resolve: "isshin" },
      { table: "burst", label: "2-Hit DMG", count: 3, type: BU, resolve: "isshin" },
      { table: "burst", label: "3-Hit DMG", count: 3, type: BU, resolve: "isshin" },
      { table: "burst", label: "Charged Attack DMG", count: 4, type: BU, resolve: "isshin", instances: 2 },
    ],
    buffs: [
      { kind: "addPerStack", table: "burst", label: "Resolve Bonus", pick: 0, stacks: /maximum number of Resolve stacks is (\d+)/, hits: "initial" },
      { kind: "addPerStack", table: "burst", label: "Resolve Bonus", pick: 1, stacks: /maximum number of Resolve stacks is (\d+)/, hits: "isshin" },
      { kind: "dmgBonusPerEnergy", table: "skill", label: "Elemental Burst DMG Bonus", types: [BU] }, // x her own Energy Cost
      { kind: "dmgBonusFromEr", from: "passive2", re: /([\d.]+)% Electro DMG Bonus/ }, // per 1% ER over 100%
    ],
    combos: [
      {
        // #119. KQM's Raiden quick guide (keqingmains.com/q/raiden-quickguide/, fetched 2026-10-21), Xianyun: "Xianyun
        // enables Raiden to use Plunging Attacks"; "Raiden's most notable Plunging Attack combos consist of "6[JP]" and
        // "3[N1CJP] N1C"" (Jessie, 2026-10-21: the first). Her plunges "are considered Elemental Burst damage", so
        // Xianyun's plunge bonus "does not buff" them. 6 plunge impacts (the shockwave),
        // read as high plunges with Xianyun's raised jump (estimate), and each plunge's collision hit ("Plunge DMG";
        // Jessie, 2026-10-21: all of them connect, estimate). Skill, Eye and initial slash as the default.
        combo: "E Q 6[JP], with Xianyun",
        when: [{ members: [["Xianyun"]] }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "skill", label: "Coordinated ATK DMG", count: 7, type: SK },
          { table: "burst", label: "Musou no Hitotachi Base DMG", count: 1, type: BU, resolve: "initial" },
          { table: "burst", label: "Low/High Plunge DMG", pick: 1, count: 6, type: BU, resolve: "isshin" },
          { table: "burst", label: "Plunge DMG", count: 6, type: BU, resolve: "isshin", collision: true },
        ],
      },
    ],
  },
  Xiao: {
    // E, E, Q, plunge x10 (high plunges), each with its collision hit ("Plunge DMG"; Jessie, 2026-10-21: all of them
    // connect, estimate). Bane of All Evil's bonus; his passive 1 ramps 5% -> 25% over 15s (avg 15%).
    combo: "E E Q 10[JhP]",
    hits: [
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      { table: "normal", label: "Low/High Plunge DMG", pick: 1, count: 10, type: PL },
      { table: "normal", label: "Plunge DMG", count: 10, type: PL, collision: true }, // each plunge's collision hit
    ],
    buffs: [
      { kind: "dmgBonus", table: "burst", label: "Normal/Charged/Plunging Attack DMG Bonus", types: [N, CH, PL] },
      { kind: "dmgBonus", value: 0.15, types: [N, CH, PL, SK, BU], note: "passive 1: 5% + 5% per 3s up to 25% over the 15s Burst, about 15% on average" },
    ],
    combos: [
      {
        // #119. KQM's Xiao quick guide (https://keqingmains.com/q/xiao-quickguide/, fetched 2026-10-20), JP (Plunge
        // Spam): "It can also be the best combo in teams where ramping buffs expire early, like with Xianyun or
        // Furina. The optimal combo of this type consists of 11 High Plunges and 2 Low Plunges."
        combo: "E E Q 11[JhP] 2[JlP]",
        when: [{ members: [["Xianyun", "Furina"]] }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 2, type: SK },
          { table: "normal", label: "Low/High Plunge DMG", pick: 1, count: 11, type: PL },
          { table: "normal", label: "Low/High Plunge DMG", pick: 0, count: 2, type: PL },
          { table: "normal", label: "Plunge DMG", count: 13, type: PL, collision: true }, // one per plunge
        ],
      },
    ],
  },
  Wriothesley: {
    // KeqingMains' strongest C0 combo outside Stellar-Conduct teams (pasted by Jessie 2026-10-12): "E 5–6[N3C(J)]"
    // in Chilling Penalty, "Replace the final N3C with Q every other rotation". Took 5 chains (the low end), so
    // 5 N3C plus half a Burst (and its Surging Blade) per rotation.
    combo: "E 5[N3C] (Q)",
    hits: [
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG"].map((label) => ({ table: "normal", label, count: 5, type: N })),
      { table: "normal", label: "Charged Attack DMG", count: 5, type: CH },
      { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
      { table: "burst", label: "Surging Blade DMG", count: 0.5, type: BU },
    ],
    buffs: [
      { kind: "factor", table: "skill", label: "Enhanced Repelling Fist DMG", types: [N] },
      // Rebuke: Vaulting Fist, at most once every 5s: 2 of the 5 Charged Attacks in Chilling Penalty's 10s.
      { kind: "dmgBonus", from: "passive1", re: /will deal (\d+)% increased DMG/, types: [CH], hitsCap: 2 },
      { kind: "atkPct", from: "passive2", re: /increase Wriothesley's ATK by (\d+)%/, times: /Max (\d+) stacks/ }, // full stacks
    ],
    combos: [
      {
        // KQM (pasted by Jessie 2026-10-12): in Stellar-Conduct teams the default combo is "E 3[N5CD] N2" from the
        // second rotation on (the first is E N5 2[N5CD]); it lines up his HP use for 3 Luster: Vaulting Fists while
        // keeping his HP above 50% (Chilling Penalty's condition). The 4-Hit row is 2 hits. No Burst: the combo has
        // none (the non-Stellar one has Q every other rotation). His Radiance (kit-overrides.json passive4) replaces
        // passive 1: Luster: Vaulting Fist has no 50% DMG bonus, so that buff is left out. The Stellar-Conduct DMG
        // the Radiance adds (60%/80% of the 3rd/5th hits, 100% of Luster) is the scorer's Stellar line, not here.
        combo: "E 3[N5CD] N2",
        // His Radiance needs his Witch's Revelation (#124): `radiance`, his own Stellar family active.
        when: [{ reaction: "stellar-conduct", radiance: true }],
        hits: [
          ...["1-Hit DMG", "2-Hit DMG"].map((label) => ({ table: "normal", label, count: 4, type: N })),
          { table: "normal", label: "3-Hit DMG", count: 3, type: N },
          { table: "normal", label: "4-Hit DMG", count: 3, type: N, instances: 2 },
          { table: "normal", label: "5-Hit DMG", count: 3, type: N },
          { table: "normal", label: "Charged Attack DMG", count: 3, type: CH },
        ],
        buffs: [
          { kind: "factor", table: "skill", label: "Enhanced Repelling Fist DMG", types: [N] },
          { kind: "atkPct", from: "passive2", re: /increase Wriothesley's ATK by (\d+)%/, times: /Max (\d+) stacks/ },
        ],
      },
    ],
  },
  // #235. KeqingMains' Mizuki quick guide (https://keqingmains.com/q/mizuki-quickguide/, fetched 2026-10-18): "(Q) E /
  // E(Q)", "no notable combo beyond 'float around'"; sample rotations "Mizuki E (Q)", Burst "every other rotation" (its
  // ER table). Wiki Aisa Utamakura Pilgrimage notes: "Mizuki can deal 7 instances of damage over 5 seconds, and up to 13
  // instances over 10 seconds with her Passive Talent 1 unlocked" (two 2.5s extensions for a Swirl or Stellar Swirl),
  // read as her periodic hits after the Skill's own hit. Passive 4 (Witch's Revelation, kit-overrides.json): after she
  // triggers Swirl or Stellar Swirl, her next periodic hit gains 1,000% of her EM, "once every 2.5s": 4 in 10s (worked
  // out here); in Radiance: Stellar Swirl each also deals "an additional instance of Anemo DMG at 1,000% of her
  // Elemental Mastery" that "is considered Stellar Swirl reaction DMG" (direct Stellar Swirl, coefficient 1: wiki Damage
  // § Direct). Passive 2: EM +100 while teammates hit with Pyro/Hydro/Cryo/Electro (any Swirl team). Left out: the
  // Burst's Munen Shockwaves (snack pick-ups, no sourced count).
  "Yumemizuki Mizuki": {
    radianceInDamage: true, // her Radiance hits are in her damage: no flat Stellar points for them (#235)
    combo: "E (Q)",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "skill", label: "Continuous Attack DMG", count: 7, type: SK },
      { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
    ],
    buffs: [],
    combos: [
      {
        combo: "E (Q), Stellar Swirl, Witch's Revelation",
        when: [{ reaction: "stellar-swirl", radiance: true }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "skill", label: "Continuous Attack DMG", count: 13, type: SK },
          { from: "passive4", re: /will be increased by ([\d,]+)% of her Elemental Mastery/, stat: "em", count: 4, type: SK, addOn: true },
          { from: "passive4", re: /additional instance of Anemo DMG at ([\d,]+)% of her Elemental Mastery/, stat: "em", count: 4, type: SK, lunar: "stellar-swirl" },
          { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
        ],
        buffs: [
          { kind: "emBonus", from: "passive2", re: /her Elemental Mastery will increase by (\d+)/ },
          { kind: "lunarReactionBonus", table: "skill", label: "Elemental Mastery-Based Stellar Swirl DMG Increase", perEm: 100, reaction: "stellar-swirl" },
        ],
      },
      {
        combo: "E (Q), Swirl, Witch's Revelation",
        when: [{ reaction: "swirl", radiance: true }, { reaction: "stellar-swirl", radiance: true }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "skill", label: "Continuous Attack DMG", count: 13, type: SK },
          { from: "passive4", re: /will be increased by ([\d,]+)% of her Elemental Mastery/, stat: "em", count: 4, type: SK, addOn: true },
          { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
        ],
        buffs: [{ kind: "emBonus", from: "passive2", re: /her Elemental Mastery will increase by (\d+)/ }],
      },
      {
        combo: "E (Q), Swirl",
        when: [{ reaction: "swirl" }, { reaction: "stellar-swirl" }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "skill", label: "Continuous Attack DMG", count: 13, type: SK },
          { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
        ],
        buffs: [{ kind: "emBonus", from: "passive2", re: /her Elemental Mastery will increase by (\d+)/ }],
      },
    ],
  },
  // #235. No KQM guide (404, 2026-10-18). GameWith's Vesna guide (https://gamewith.net/genshin-impact/article/show/76472,
  // fetched 2026-10-18): "Elemental Skill -> [ Normal Attack (x1) -> Charged Attack ] -> Special Skill (x2) -> Elemental
  // Burst -> Special Skill -> [ Normal Attack (x1) -> Charged Attack ] -> Special Skill (x2)", then swap out. The wiki (The
  // Art of Victory) agrees on the five Windborne Swords: levels go "from Lv. 1, up to Lv. 3 max", and she leaves Armed for
  // Action "after she has used Windborne Sword at the highest level 3 times": Lv. 1, Lv. 2, Lv. 3 x3. Each Normal and
  // Charged Attack also summons a wind pinion. With Stellar Swirl in the team (Radiance), "DMG dealt by the Spirit Blades
  // become Anemo DMG that is considered Stellar Swirl reaction DMG": their Stellar Swirl rows, direct (wiki Damage §
  // Direct). Rotation: 18.48s, measured in a HoYoLAB test (kit-overrides.json rotations). Left out:
  // passive 2's ATK/EM by teammates' elements.
  Vesna: {
    radianceInDamage: true, // her Radiance: Stellar Swirl Spirit Blades are in her damage (#235)
    combo: "E N1C 2sE Q sE N1C 2sE",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "normal", label: "1-Hit DMG", count: 2, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 2, type: CH },
      { table: "skill", label: "Wind Pinion DMG", count: 4, type: SK },
      { table: "skill", label: "Windborne Sword Lv. 1 DMG", count: 1, type: SK },
      { table: "skill", label: "Windborne Sword Lv. 2 DMG", count: 1, type: SK },
      { table: "skill", label: "Windborne Sword Lv. 2 Spirit Blade DMG", count: 1, type: SK },
      { table: "skill", label: "Windborne Sword Lv. 3 Spirit Blade DMG", count: 3, type: SK, instances: 4 },
      { table: "skill", label: "Windborne Sword Lv. 3 Spirit Blade Final Hit DMG", count: 3, type: SK },
      { table: "burst", label: "Spirit Blade DMG", count: 1, type: BU },
    ],
    buffs: [],
    combos: [
      {
        combo: "E N1C 2sE Q sE N1C 2sE, Radiance: Stellar Swirl",
        when: [{ reaction: "stellar-swirl" }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "normal", label: "1-Hit DMG", count: 2, type: N },
          { table: "normal", label: "Charged Attack DMG", count: 2, type: CH },
          { table: "skill", label: "Wind Pinion DMG", count: 4, type: SK },
          { table: "skill", label: "Windborne Sword Lv. 1 DMG", count: 1, type: SK },
          { table: "skill", label: "Windborne Sword Lv. 2 DMG", count: 1, type: SK },
          { table: "skill", label: "Windborne Sword Lv. 2 Spirit Blade Stellar Swirl DMG", count: 1, type: SK, lunar: "stellar-swirl" },
          { table: "skill", label: "Windborne Sword Lv. 3 Spirit Blade Stellar Swirl DMG", count: 3, type: SK, instances: 4, lunar: "stellar-swirl" },
          { table: "skill", label: "Windborne Sword Lv. 3 Spirit Blade Final Hit Stellar Swirl DMG", count: 3, type: SK, lunar: "stellar-swirl" },
          { table: "burst", label: "Spirit Blade Stellar Swirl DMG", count: 1, type: BU, lunar: "stellar-swirl" },
        ],
        buffs: [
          { kind: "lunarBaseBonus", from: "passive3", re: /Every 100 ATK she has increases the Base Stellar Swirl DMG by ([\d.]+)%/, per: 100, stat: "atk", max: /maximum DMG increase that can be gained this way is (\d+)%/ },
        ],
      },
    ],
  },
  Wanderer: {
    // KeqingMains' Wanderer calcs (#223), linked as "Calcs Here" from the full guide (https://keqingmains.com/wanderer/;
    // sheet 1e2e5ITnHVbT8tyJBqgfO89BWbPX5HcDxMdUm98ECZ0M, Calculator tab, fetched 2026-10-18): a 20s rotation of Burst,
    // E, CA, 5[N1 N2 CA], N1 N2 (his N2C chain, "Repeat until the end of Wanderer's airtime"): 6 N1, 6 N2, 6 Charged
    // Attacks per Windfavored state. The guide: Burst "every other rotation" at C0, so half a Burst. Left out: the 4 wind
    // arrows of a Descent (passive 2, "Gale x4" in the sheet: chance-based, and the wiki gives no attack type) and his
    // passive 1 buffs from the element his Skill touches (Pyro ATK +30% in the sheet), which depend on the team.
    combo: "E C 5[N2C] N2 (Q)",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 6, type: N },
      { table: "normal", label: "2-Hit DMG", count: 6, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 6, type: CH },
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 0.5, type: BU, instances: 5 },
    ],
    buffs: [
      // Windfavored: "Kuugo: Fushoudan DMG" / "Kuugo: Toufukai DMG" are a % of Normal / Charged Attack DMG.
      { kind: "factor", table: "skill", label: "Kuugo: Fushoudan DMG", types: [N] },
      { kind: "factor", table: "skill", label: "Kuugo: Toufukai DMG", types: [CH] },
    ],
  },
  Varesa: {
    // KeqingMains' "most basic and consistent full combo at C0" (pasted by Jessie 2026-10-12):
    // ECP (sQ) ECP ECP (sQ) ECP ECP (sQ) CP CP. E = Skill (Rush), C = the Charged Attack it unlocks, P = plunge,
    // sQ = the short Burst Volcano Kablam (30 Energy, Plunging Attack DMG, only right after a Fiery Passion plunge).
    // Each ECP outside Fiery Passion fills her Nightsoul points and enters it (an extra Skill charge), so 3 ECPs are
    // in Fiery Passion and 2 are not; the closing CP CP have no Skill (no passive 1) and enter it for the next
    // rotation. KQM: ideally 2 sQ per rotation (Jessie), not all 3 (Energy, #37). No full Burst. KQM's other C0
    // combos (ECP ECP (sQ) ECP ECP (sQ) (CP CP); CP CP ECP while her Skill is on cooldown) depend on her Energy and
    // cooldowns, not on the team, so there's nothing to pick by team yet (#114; by Energy: #37).
    hits: [
      { table: "skill", label: "Fiery Passion Rush DMG", count: 3, type: SK },
      { table: "normal", label: "Fiery Passion Charged Attack DMG", count: 3, type: CH },
      { table: "normal", label: "Fiery Passion Low/High Plunge DMG", pick: 1, count: 3, type: PL },
      { from: "passive1", re: /Fiery Passion state, this ground impact DMG is increased by (\d+)% of her ATK/, count: 3, type: PL },
      { table: "skill", label: "Rush DMG", count: 2, type: SK },
      { table: "normal", label: "Charged Attack DMG", count: 4, type: CH },
      { table: "normal", label: "Low/High Plunge DMG", pick: 1, count: 4, type: PL },
      { from: "passive1", re: /Plunging Attack, the shockwave DMG dealt when she hits the ground is increased by (\d+)% of her ATK/, count: 2, type: PL },
      { table: "burst", label: "Volcano Kablam DMG", count: 2, type: PL },
    ],
    buffs: [],
  },
  Mavuika: {
    // E (hold: Flamestrider), Q (Sunfell Slice), C8F on the Flamestrider: KQM's simplest combo, for teams with no
    // Vaporize or Melt (kit-overrides.json hitRates). Combos for Melt and Vaporize teams below (#114).
    // Buffs marked fightingSpirit are read at the limit here; the scorer scales them by the team's Fighting Spirit.
    combo: "E Q C8F",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU, fightingSpirit: "sunfell" },
      { table: "skill", label: "Flamestrider Charged Attack Cyclic DMG", count: "rate", type: CH, fightingSpirit: "ca" },
      { table: "skill", label: "Flamestrider Charged Attack Final DMG", count: "rate", type: CH, fightingSpirit: "ca" },
    ],
    buffs: [
      { kind: "addPerStack", table: "burst", label: "Sunfell Slice DMG Bonus", stacks: "Fighting Spirit Limit", hits: "sunfell", fightingSpirit: true },
      { kind: "addPerStack", table: "burst", label: "Flamestrider Charged Attack DMG Bonus", stacks: "Fighting Spirit Limit", hits: "ca", fightingSpirit: true },
      // Passive 2: the active character (her too) deals up to 40% more DMG at 200 Fighting Spirit after her Burst.
      { kind: "dmgBonus", from: "passive2", re: /maximum increase obtainable this way is (\d+)%/, types: [SK, BU, N, CH, PL], fightingSpirit: true },
    ],
    // KQM's on-field combos after E (pasted by Jessie 2026-10-12). C = Flamestrider Cyclic Charged Attack, F = Final
    // Charged Attack, D = dash cancel, J = jump cancel. Each keeps E and Q (Sunfell Slice) and the buffs above. Where
    // KQM says how many Charged Attacks react, `reacting` says so; other hits use damage.ts's flat estimate.
    combos: [
      {
        // "Q 4[C2D] C": "Vaporize teams with Yelan plus Pyro Traveler or Kachina". 9 Cyclic.
        combo: "E Q 4[C2D] C",
        when: [{ reaction: "vaporize", members: [["Yelan"], ["Traveler (Pyro)", "Kachina"]] }],
        hits: mavuikaHits({ cyclic: 9 }),
      },
      {
        // "Q C3F D C3F": "the highest-DPS Melt combo with Citlali or Rosaria as the solo Cryo unit, allowing 2 Cyclic
        // Charged Attack Melts and 2 Final Charged Attack Melts". 6 Cyclic (2 melt), 2 Final (both melt).
        combo: "E Q C3F D C3F",
        when: [{ reaction: "melt", members: [["Citlali", "Rosaria"]], elements: { Cryo: 1 } }],
        hits: mavuikaHits({ cyclic: 6, cyclicReacting: 2, final: 2, finalReacting: 2 }),
      },
      {
        // "Q C2D C3D C4": "the most consistent, 5 non-reacting and 5 reacting Cyclic Charged Attacks"; needs good Hydro
        // (Furina, Xingqiu, Yelan; or C6 Kaeya, past this C0 model) or double Cryo (Citlali/Rosaria plus Diona or
        // Layla). The notation has 9 Cyclic, KQM's count 10: took their half-reacting share, 4.5 of 9.
        combo: "E Q C2D C3D C4",
        when: [
          { reaction: "vaporize", members: [["Furina", "Xingqiu", "Yelan"]] },
          { reaction: "melt", members: [["Citlali", "Rosaria"], ["Diona", "Layla"]] },
        ],
        hits: mavuikaHits({ cyclic: 9, cyclicReacting: 4.5 }),
      },
      {
        // "Q J C8" and "Q C4J C4": "simpler Melt combos" (8 Cyclic either way), for Melt teams the ones above don't
        // fit. KQM gives no count of the hits that melt.
        combo: "E Q J C8",
        when: [{ reaction: "melt" }],
        hits: mavuikaHits({ cyclic: 8 }),
      },
    ],
  },
  Zibai: {
    // KeqingMains quick guide (fetched 2026-10-12), C0: "E 4[N4E]; if Q is available, replace any N4 with N1 Q". The
    // rotation is her Burst's CD, so Q once: E 3[N4E] N1 Q E. Lunar-Crystallize DMG (#135): the 2nd hit of Spirit
    // Steed's Stride and of her Burst, and at Ascendant Gleam an extra hit on each N4 (Skill text: "considered
    // Lunar-Crystallize Reaction DMG"). Passive 1 ("The DMG dealt by the 2nd hit of Spirit Steed's Stride is increased
    // by 60% of Zibai's DEF") on the first Stride is a Reaction Additive Base DMG Bonus to that Lunar hit (Jessie, #146;
    // KeqingMains' Zibai quick guide: "considered Additive Base DMG Bonus as part of the Lunar-Crystallize damage
    // formula"; the wiki's Lunar-Crystallize page doesn't list it): the wiki's direct Lunar formula adds it after the
    // coefficient, Base DMG bonus and EM bonus (Damage § Direct).
    hits: [
      { table: "skill", label: "Lunar Phase Shift 1-Hit DMG", count: 4, type: N },
      ...[2, 3, 4].map((n) => ({ table: "skill", label: `Lunar Phase Shift ${n}-Hit DMG`, count: 3, type: N })),
      { table: "skill", label: "Lunar Phase Shift 4-Hit Additional DMG", count: 3, type: N, lunar: "lunar-crystallize", when: { ascendantGleam: true } },
      // 4 Strides need the team's Lunar-Crystallize at Ascendant Gleam (#248): KeqingMains' Zibai quick guide (fetched
      // 2026-10-18): "It allows her to gain 35 Phase Shift Radiance between each special Skill use", and "If this effect
      // cannot be triggered, the use of her special Skill will be severely delayed". Without it, ~2 (estimate): the wiki's
      // 10 Radiance a second in Lunar Phase Shift and 5 per Normal Attack hit (once per 0.5s) over KQM's ~11s combo give
      // ~175 Radiance, 2 Strides at 70; with the 35 between Strides, ~280, her 4. Moondrift Harmony refreshing passive 1
      // isn't counted (no sourced rate).
      ...[{}, { when: { reaction: "lunar-crystallize", ascendantGleam: true } }].flatMap((w) => [
        { table: "skill", label: "Spirit Steed's Stride 1-Hit DMG", count: 2, type: SK, ...w },
        { table: "skill", label: "Spirit Steed's Stride 2-Hit DMG", count: 2, type: SK, lunar: "lunar-crystallize", ...w },
      ]),
      { from: "passive1", re: /increased by (\d+)% of Zibai's DEF/, stat: "def", count: 1, type: SK, lunar: "lunar-crystallize", additive: true }, // the first Stride, within 4s of the Skill
      { table: "burst", label: "Skill 1-Hit DMG", count: 1, type: BU },
      { table: "burst", label: "Skill 2-Hit DMG", count: 1, type: BU, lunar: "lunar-crystallize" },
    ],
    buffs: [
      { kind: "lunarBaseBonus", from: "passive3", re: /every 100 DEF that Zibai has increasing Lunar-Crystallize's Base DMG by ([\d.]+)%/, per: 100, stat: "def", max: /maximum of (\d+)%/ },
    ],
  },
  Skirk: {
    // E (Seven-Phase Flash), N5 x3 with its Normal Attacks, Q (Havoc: Extinction: no Void Rifts assumed).
    hits: [
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG", "5-Hit DMG"].map((label) => ({ table: "skill", label, count: 3, type: N })),
    ],
    buffs: [{ kind: "dmgBonus", table: "burst", label: "0/1/2/3 Void Rift Absorption DMG Bonus", pick: 0, types: [N], hitsCap: /canceled when it has triggered (\d+) times/ }],
  },
  Nefer: {
    // E, Phantasm Performance x3, E, Phantasm Performance x3, Q: KeqingMains quick guide (fetched 2026-10-12), "E 3[CD]
    // E CD CQ CD", "6 special Charged Attacks in a full rotation". Lunar-Bloom DMG (#135): the shades' 3 hits ("DMG
    // dealt by the shades is considered Lunar-Bloom DMG"); her own 2 hits and her Burst are Dendro DMG. Phantasm
    // Performance needs Verdant Dew, which only Lunar-Bloom reactions give, so without one it drops out.
    hits: [
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      ...["1-Hit DMG (Nefer)", "2-Hit DMG (Nefer)"].map((p) => ({ table: "skill", label: `Phantasm Performance ${p}`, count: 6, type: CH, when: { reaction: "lunar-bloom" } })),
      ...["1-Hit DMG (Shades)", "2-Hit DMG (Shades)", "3-Hit DMG (Shades)"].map((p) => ({ table: "skill", label: `Phantasm Performance ${p}`, count: 6, type: CH, lunar: "lunar-bloom", when: { reaction: "lunar-bloom" } })),
      { table: "burst", label: "1-Hit DMG", count: 1, type: BU },
      { table: "burst", label: "2-Hit DMG", count: 1, type: BU },
    ],
    buffs: [
      { kind: "lunarBaseBonus", from: "passive3", re: /every point of Elemental Mastery that Nefer has increasing Lunar-Bloom's Base DMG by ([\d.]+)%/, per: 1, stat: "em", max: /maximum of (\d+)%/ },
      // Veil of Falsehood (#148), estimate: 3 stacks for every Phantasm Performance. Passive 1 at Ascendant Gleam: her
      // Charged Attacks absorb the Seeds of Deceit that Lunar-Bloom makes, 1 stack per seed; at 3 stacks EM +100 for
      // 8s. Wiki tooltip: "Each stack of Veil of Falsehood increases the DMG dealt by Nefer's Phantasm Performance by
      // 8%. The initial maximum number of stacks is 3". KeqingMains quick guide (fetched 2026-10-12): an "8% Base DMG
      // Multiplier to Nefer's special Charged Attacks"; ideally 3 stacks from her first one, so +24% and 100 EM
      // "throughout her field time". Needs Lunar-Bloom (the seeds) and Ascendant Gleam.
      {
        kind: "baseDmgMultiplier",
        value: 0.08 * 3,
        labels: ["1-Hit DMG (Nefer)", "2-Hit DMG (Nefer)", "1-Hit DMG (Shades)", "2-Hit DMG (Shades)", "3-Hit DMG (Shades)"].map((p) => `Phantasm Performance ${p}`),
        when: { reaction: "lunar-bloom", ascendantGleam: true },
      },
      { kind: "emBonus", from: "passive1", re: /Elemental Mastery will be increased by (\d+)/, when: { reaction: "lunar-bloom", ascendantGleam: true } },
    ],
  },
  Clorinde: {
    // E (Night Vigil), 6[N3E], Q: KeqingMains' basic combo from 0% Bond of Life (pasted by Jessie 2026-10-12: "E to
    // activate her special Skill state, then N3E until her special Skill state ends. The average player can execute
    // E 6[N3E]"). Each shot adds 35% Bond of Life, so all 18 start under 100%: they pierce for the second "Swift Hunt
    // DMG" value. The Impale the Night after them is at 100%+ (Pact: the third value, x3) and counts as Normal Attack
    // DMG. One Surging Blade: its 10s interval is longer than Night Vigil's 7.5s. The Burst is 5 hits.
    hits: [
      { table: "skill", label: "Swift Hunt DMG", pick: 1, count: 18, type: N },
      { table: "skill", label: "Impale the Night DMG", pick: 2, count: 6, type: N, instances: 3 },
      { table: "skill", label: "Surging Blade DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU, instances: 5 },
    ],
    // Passive 1: after an Electro-related reaction, +20% ATK per stack (3) on Normal Attacks and the Burst, up to 1,800.
    buffs: [
      {
        kind: "flatAtk",
        from: "passive1",
        re: /increased by (\d+)% of Clorinde's ATK/,
        stacks: /Max (\d+) stacks/,
        cap: /achievable this way for the above attacks is ([\d,]+)/,
        types: [N, BU],
        reactions: ["overloaded", "superconduct", "electrocharged", "quicken", "aggravate", "hyperbloom", "lunar-charged", "stellar-conduct"],
      },
    ],
  },
  Flins: {
    // KeqingMains quick guide (fetched 2026-10-12), C0: "E N1 E sQ 2[N4D] N2 E sQ N4D (N5)" (N5 left out). E enters
    // Manifest Flame (its Normal Attacks are the Skill table's rows), each later E is Northland Spearstorm, sQ is
    // Thunderous Symphony (30 Energy); "it is not recommended to use Flins's normal Burst". Thunderous Symphony is
    // Lunar-Charged DMG (#135), with one more Lunar-Charged hit at Ascendant Gleam "if there are thunderclouds nearby"
    // (only Lunar-Charged reactions make them). Normal Attacks and Northland Spearstorm are plain Electro DMG.
    hits: [
      { table: "skill", label: "1-Hit DMG", count: 5, type: N },
      { table: "skill", label: "2-Hit DMG", count: 4, type: N },
      { table: "skill", label: "3-Hit DMG", count: 3, type: N },
      { table: "skill", label: "4-Hit DMG", count: 3, type: N, instances: 2 },
      { table: "skill", label: "Northland Spearstorm DMG", count: 2, type: SK },
      { table: "burst", label: "Thunderous Symphony DMG", count: 2, type: BU, lunar: "lunar-charged" },
      { table: "burst", label: "Thunderous Symphony Additional DMG", count: 2, type: BU, lunar: "lunar-charged", when: { ascendantGleam: true, reaction: "lunar-charged" } },
    ],
    buffs: [
      { kind: "emFromAtk", from: "passive2", re: /increased by (\d+)% of his ATK/, max: /maximum increase obtainable this way is (\d+)/ },
      { kind: "lunarBaseBonus", from: "passive3", re: /every 100 ATK that Flins has increasing Lunar-Charged's Base DMG by ([\d.]+)%/, per: 100, stat: "atk", max: /maximum of (\d+)%/ },
      // Passive 1 (#147): "Ascendant Gleam: Lunar-Charged reactions triggered by Flins will deal an additional 20% DMG".
      // KeqingMains quick guide (fetched 2026-10-12): "It benefits both Lunar-Charged reaction damage and direct
      // Lunar-Charged damage (from his Burst)". The wiki lists it as Reaction DMG Bonus (Damage § Reaction DMG Bonus
      // Multiplier), added to the EM bonus.
      { kind: "lunarReactionBonus", from: "passive1", re: /deal an additional (\d+)% DMG/, reaction: "lunar-charged", when: { ascendantGleam: true } },
    ],
  },
  Arlecchino: {
    // #119. KQM's Arlecchino quick guide (https://keqingmains.com/q/arlecchino-quickguide/, fetched 2026-10-20): "N3D
    // Arlecchino's most recommended combo for general use"; its Bennett flex, Geo and Overloaded sample rotations end
    // "Arlecchino C 5[N3D] N3" (N1C or N3C first in some). E, CA (absorbs the Blood-Debt Directive: Bond of Life up to
    // 145% of Max HP), 6 N3 strings. No Burst (Jessie, 2026-10-21): the guide's sample rotations don't cast it, its one hit is "not
    // particularly noteworthy", it is "best reserved as an emergency heal", and "it is still ideal to avoid using her
    // Burst" (it also clears her surplus Bond of Life); only C6 makes it "well worth using offensively". Team combos
    // below; her main reaction is none, so they stay unamplified.
    combo: "E C 5[N3D] N3",
    hits: arlecchinoHits({ ca: 1, strings: { 1: 6, 2: 6, 3: 6 } }),
    // Masque of the Red Death: each Normal Attack hit adds ATK x the row's ratio x her Bond of Life %, and uses 7.5% of it.
    buffs: [{ kind: "masque", table: "normal", label: "Masque of the Red Death Increase", start: { from: "combat2", re: /within 35s after using her Elemental Skill is (\d+)% of her Max HP/ }, use: { from: "combat1", re: /This will consume ([\d.]+)% of said current Bond of Life/ } }],
    // The same guide's sample rotations by team (#119), first match wins. Members only: no reaction, so none amplify.
    combos: [
      {
        // Forward Melt with Escoffier, Layla or Nicole: "Arlecchino C 2[N6] N3" (Citlali/Nicole/Sucrose,
        // Citlali/Bennett/Escoffier or Layla, Escoffier/Bennett/Venti).
        combo: "E C 2[N6] N3",
        when: [{ members: [["Citlali", "Escoffier"], ["Escoffier", "Layla", "Nicole"]] }],
        hits: arlecchinoHits({ ca: 1, strings: { 1: 3, 2: 3, 3: 3, 4: 2, 5: 2, 6: 2 } }),
      },
      {
        // Forward Melt with Citlali: "Arlecchino C 2[N5D] N5" (Citlali/Bennett/Xilonen, Sucrose or Kazuha).
        combo: "E C 2[N5D] N5",
        when: [{ members: [["Citlali"]] }],
        hits: arlecchinoHits({ ca: 1, strings: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 } }),
      },
      {
        // Furina, Yelan, Xilonen: "Arlecchino 7[N2C] N2" ("This team allows Arlecchino to use N2C to achieve more Vape
        // hits than her usual combo"); the first Charged Attack claims the Directive.
        combo: "E 7[N2C] N2",
        when: [{ members: [["Furina"], ["Yelan"]] }],
        hits: arlecchinoHits({ ca: 7, strings: { 1: 8, 2: 8 } }),
      },
      {
        // Yelan, Bennett, Lan Yan: "Arlecchino 5[N3C] N1".
        combo: "E 5[N3C] N1",
        when: [{ members: [["Yelan"], ["Lan Yan"]] }],
        hits: arlecchinoHits({ ca: 5, strings: { 1: 6, 2: 5, 3: 5 } }),
      },
      {
        // Mona with Bennett or Nicole: "Arlecchino C N3 > Mona N1 E > Arlecchino 4[N3D] N1".
        combo: "E C N3 4[N3D] N1",
        when: [{ members: [["Mona"]] }],
        hits: arlecchinoHits({ ca: 1, strings: { 1: 6, 2: 5, 3: 5 } }),
      },
      {
        // Columbina, Ineffa, Xilonen: "Arlecchino C 6[N3D] N3".
        combo: "E C 6[N3D] N3",
        when: [{ members: [["Columbina"], ["Ineffa"]] }],
        hits: arlecchinoHits({ ca: 1, strings: { 1: 7, 2: 7, 3: 7 } }),
      },
    ],
  },
  Kinich: {
    // E, hold E swings x6 (Loop Shots), Q. Nightsoul points: 2 per second for 10s, 3 per Loop Shot, 4 from a Blind
    // Spot = 42, so 2 Scalespiker Cannons (20 points each, "Nightsoul Point Limit"). Worked out from his kit, for teams
    // without Burning or Burgeon: KQM gives no count for them.
    combo: "E 6N 2E Q (kit estimate)",
    hits: [
      { table: "skill", label: "Loop Shot DMG", count: 6, type: SK },
      { table: "skill", label: "Scalespiker Cannon DMG", count: 2, type: SK },
      // Passive 2, Hunter's Experience (#288): "After a nearby party member triggers a Nightsoul Burst, Kinich will gain 1
      // stack of Hunter's Experience that lasts 15s. Max 2 stacks", consumed by his next Scalespiker Cannon, "each stack
      // consumed increasing the DMG dealt by this Cannon shot by 320% of Kinich's ATK". A Cannon's own DMG, so addOn.
      { from: "passive2", re: /increasing the DMG dealt by this Cannon shot by (\d+)% of Kinich's ATK/, count: 0, type: SK, addOn: true, nightsoulBursts: "Scalespiker Cannon DMG" },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Dragon Breath DMG", count: "rate", type: BU },
    ],
    buffs: [],
    combos: [
      {
        // KeqingMains Kinich quick guide (pasted by Jessie 2026-10-20): "shE N2E Q E 3[N2E]" (shE = Short Hold Skill)
        // "utilizes Kinich's A1 Passive to gain Nightsoul points during his Burst animation in order to immediately fire
        // an extra Scalespiker Cannon", and should "only be done when his Burst is available". His A1 gives 7 points
        // when a Desolation target takes Burning or Burgeon DMG, so the 5 Cannons need one of them (#286); every
        // KQM sample rotation for him is a Burning team. 8 Loop Shots, 5 Cannons, 1 Burst.
        combo: "shE N2E Q E 3[N2E]",
        when: [{ reaction: "burning" }, { reaction: "burgeon" }],
        hits: [
          { table: "skill", label: "Loop Shot DMG", count: 8, type: SK },
          { table: "skill", label: "Scalespiker Cannon DMG", count: 5, type: SK },
          { from: "passive2", re: /increasing the DMG dealt by this Cannon shot by (\d+)% of Kinich's ATK/, count: 0, type: SK, addOn: true, nightsoulBursts: "Scalespiker Cannon DMG" },
          { table: "burst", label: "Skill DMG", count: 1, type: BU },
          { table: "burst", label: "Dragon Breath DMG", count: "rate", type: BU },
        ],
      },
    ],
  },
  Neuvillette: {
    // #119. KQM's full Neuvillette guide (https://keqingmains.com/neuvillette/, fetched 2026-10-20), Combos: "4
    // Charged Attacks: Neuvillette's default combo. Recommended for nearly all scenarios, especially in teams where
    // Neuvillette deals the vast majority of the damage, such as Furina teams. Usually a variation of E > Team > C E
    // C Q > Team > 2[C]". Jessie (2026-10-21): 4 Charged Attacks for every team without its own combo (the quick
    // guide's 3-CA "Q > Team > C E C > Team > C E" is no longer used). Q, E x2, 4 Equitable Judgments at the wiki's 8
    // hits each (As Water Seeks Equilibrium: "a maximum of 8 times per use", once per 0.4s over its 3s): 32. Rotation
    // lengths: kit-overrides.json rotations (KQM's ER calculator, 4-CA rotations).
    combo: "E C E C Q 2[C]",
    hits: [
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Waterfall DMG", count: 2, type: BU }, // "2 waterfalls will descend"
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      { table: "normal", label: "Charged Attack: Equitable Judgment", count: 32, type: CH },
    ],
    buffs: [
      // Passive 1: a stack per kind of reaction the party triggers from the list (they "exist independently"), max 3:
      // Equitable Judgment deals 110%/125%/160%. The scorer counts the team's active reactions in that list.
      {
        kind: "factorByReactions",
        from: "passive1",
        re: /deal (\d+)%\/(\d+)%\/(\d+)% of its original DMG/,
        types: [CH],
        reactions: ["vaporize", "freeze", "electrocharged", "lunar-charged", "bloom", "lunar-bloom", "swirl", "crystallize", "lunar-crystallize"],
      },
      // Passive 2: 0.6% Hydro DMG per 1% HP over 30%, max 30%. Equitable Judgment drains him while he is above 50% HP
      // and Droplets heal him only as it starts (KQM: "he will gradually lose this Hydro DMG Bonus over the course of
      // the attack"), so read at 50% HP: 12%.
      { kind: "dmgBonusFromHp", from: "passive2", per: /gain ([\d.]+)% Hydro DMG Bonus/, above: /greater than (\d+)% of Max HP/, max: /maximum bonus of (\d+)%/, hp: 0.5, types: [N, CH, PL, SK, BU] },
    ],
  },
  "Kamisato Ayaka": {
    // #119. Traveler.gg's Ayaka guide (traveler.gg/kamisato-ayaka-full-character-guide-builds-teams/, 2026-02-22,
    // found by web search for non-KQM sources, Jessie 2026-10-21), team rotations: "Ayaka EDQ 2(N2C N2CD)E" (Furina,
    // Escoffier, Shenhe), "Ayaka EDQ N2C > ... > Ayaka N2C N2CD N2CED" (Shenhe, Kokomi), "Ayaka EDQ 2(N2C) > ... > Ayaka
    // D 2(N2C) E" (Escoffier, Shenhe, Ganyu): 2 Skills, her Burst, 4 N2C; KQM's guide: she uses her Skill twice per
    // rotation. Passive 1: +30% Normal/Charged DMG after the Skill; passive 2: +18% Cryo DMG after the dash.
    combo: "EDQ 2(N2C N2CD) E",
    hits: [
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      { table: "burst", label: "Cutting DMG", count: "rate", type: BU },
      { table: "burst", label: "Bloom DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 4, type: N },
      { table: "normal", label: "2-Hit DMG", count: 4, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 4, type: CH },
    ],
    buffs: [
      { kind: "dmgBonus", from: "passive1", re: /deal (\d+)% increased DMG for/, types: [N, CH] },
      { kind: "dmgBonus", from: "passive2", re: /Gains (\d+)% Cryo DMG Bonus/, types: [N, CH, SK, BU] },
    ],
    combos: [
      {
        // #119. KQM's Ayaka quick guide (https://keqingmains.com/q/ayaka-quickguide/, fetched 2026-10-20): "N3C Ayaka
        // should incorporate a third Normal Attack when paired with characters who have on-attack effects, like Yelan or
        // Xingqiu"; its Furina, Escoffier, Yelan sample rotation: "Ayaka ED N1 Q N3CD 2[N2C] > Yelan N1 E N1 > Ayaka
        // ED N1C". Two Skills, 5 N1, 3 N2, 1 N3, 4 Charged Attacks. Yelan teams only (no Xingqiu sample).
        combo: "ED N1 Q N3CD 2[N2C] ED N1C",
        when: [{ members: [["Yelan"]] }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 2, type: SK },
          { table: "burst", label: "Cutting DMG", count: "rate", type: BU },
          { table: "burst", label: "Bloom DMG", count: 1, type: BU },
          { table: "normal", label: "1-Hit DMG", count: 5, type: N },
          { table: "normal", label: "2-Hit DMG", count: 3, type: N },
          { table: "normal", label: "3-Hit DMG", count: 1, type: N },
          { table: "normal", label: "Charged Attack DMG", count: 4, type: CH },
        ],
      },
    ],
  },
  Alhaitham: {
    // KeqingMains' "Shorter Continuous" rotation (fetched 2026-10-12): "Q + E + N3D N3D N3CD + N3CD N3CD", 18-20s.
    // Q with 3 Mirrors: "3-Mirror Attack Instances". Projections fire on his attacks with 3 Mirrors.
    hits: [
      { table: "skill", label: "Rush Attack DMG", count: 1, type: SK },
      { table: "burst", label: "Single-Instance DMG", count: { table: "burst", label: "3-Mirror Attack Instances" }, type: BU },
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG"].map((label) => ({ table: "normal", label, count: 5, type: N, ...(label === "3-Hit DMG" ? { instances: 2 } : {}) })),
      { table: "normal", label: "Charged Attack DMG", count: 3, type: CH, instances: 2 }, // "{a}+{b}": two hits
      { table: "skill", label: "3-Mirror Projection Attack DMG", count: "rate", type: SK, instances: 3 }, // one hit per Mirror
    ],
    // Passive 2: +0.1% Projection and Burst DMG per EM, up to 100%.
    buffs: [{ kind: "dmgBonusPerEm", from: "passive2", re: /by ([\d.]+)%\. The DMG of both/, max: /maximum of (\d+)% this way/, types: [SK, BU], labels: ["3-Mirror Projection Attack DMG", "Single-Instance DMG"] }],
  },
  // #203 / #137: the main DPS outside the compare, from their KQM quick guides (fetched 2026-10-16).
  Klee: {
    // KQM's Normal Attack Spam, "her easiest combo": "N1 sEQ N3 E 5[N3]"; "This combo gets 5 additional Charged
    // Attacks easily": the Boom-Boom Strikes her third Normal Attack unleashes at Secret Rite (passive 1's Hexerei
    // text), so they need it (#241). Jumpy Dumpty "bounces thrice" per throw, one throw: the guide's sE is cancelled by
    // the Burst before it is released ("her cooldown is not triggered until her Skill is fully released ... cancel her
    // Skill using her Burst"; "Klee generally only uses her Skill once in a rotation"). Sparks 'n' Splash: 6 waves of 4
    // sparks (wiki). Her mines are left out: how many of the 8 hit one opponent isn't sourced.
    combo: "N1 sEQ N3 E 5[N3]",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 7, type: N },
      { table: "normal", label: "2-Hit DMG", count: 6, type: N },
      { table: "normal", label: "3-Hit DMG", count: 6, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 5, type: CH, when: { secretRite: true } },
      { table: "skill", label: "Jumpy Dumpty DMG", count: 3, type: SK },
      { table: "burst", label: "Sparks 'n' Splash DMG", count: "rate", type: BU },
    ],
    // Passive 1 (kit-overrides.json's updated text): a Spark Charged Attack, Boom-Boom Strike, deals 50% more; all 5 are.
    // Passive 4 at Secret Rite: 3 Boom Badges (her Normal Attack, Skill and Burst all land within 20s of the Strikes in
    // this combo) make them deal 150% of their DMG.
    buffs: [
      { kind: "dmgBonus", from: "passive1", re: /Boom-Boom Strike, dealing (\d+)% increased DMG/, types: [CH] },
      { kind: "factor", from: "passive4", re: /Boom-Boom Strike deals [\d.]+%\/[\d.]+%\/([\d.]+)% of its original DMG/, types: [CH], when: { secretRite: true } },
    ],
  },
  Tighnari: {
    // KQM: "E Q 3CS" (Charged Shots: Wreath Arrows; "Upon hit, the Wreath Arrow will create 4 Clusterbloom Arrows").
    // His Burst fires 6 Tanglevine Shafts and a secondary wave (genshin-db: "fire 6 Tanglevine Shafts"; one each).
    // Hits that apply Dendro (and so Spread, #221), from KQM's Tighnari evidence page
    // (library.keqingmains.com/evidence/characters/dendro/tighnari, linked by Jessie 2026-10-20): "CA Lv.1 and CA Lv.2
    // Wreath Arrow have no ICD, CA Lv.2 Clusterbloom Arrow have 2.5s/4 Hits ICD"; "E has no ICD and Q Tanglevine Shaft
    // and Secondary Tanglevine Shaft DMG have normal ICD" (2.5s/3 hits). On one opponent: every Wreath Arrow and the
    // Skill; 1 in 4 Clusterbloom Arrows (each Wreath Arrow's 4 land well inside 2.5s); the 1st and 4th of each 6 shafts.
    combo: "E Q 3CS",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, reacting: 1, type: SK },
      { table: "burst", label: "Tanglevine Shaft DMG", count: 6, reacting: 2, type: BU },
      { table: "burst", label: "Secondary Tanglevine Shaft DMG", count: 6, reacting: 2, type: BU },
      { table: "normal", label: "Wreath Arrow DMG", count: 3, reacting: 3, type: CH },
      { table: "normal", label: "Clusterbloom Arrow DMG", count: 12, reacting: 3, type: CH },
    ],
    buffs: [
      // Passive 1: +50 EM for 4s after each Wreath Arrow: up through his Charged Shots.
      { kind: "emBonus", from: "passive1", re: /Elemental Mastery is increased by (\d+)/ },
      // Passive 2: +0.06% Charged Attack and Burst DMG per EM, up to 60%.
      { kind: "dmgBonusPerEm", from: "passive2", re: /are increased by ([\d.]+)%/, max: /maximum DMG Bonus obtainable this way is (\d+)%/, types: [CH, BU], labels: ["Wreath Arrow DMG", "Clusterbloom Arrow DMG", "Tanglevine Shaft DMG", "Secondary Tanglevine Shaft DMG"] },
    ],
  },
  Lyney: {
    // #230. DotGG's Lyney quick guide (dotgg.gg/genshin-impact-lyney-quick-character-guide/, 2024-05-01), "General
    // Rotation": "Healer doing healing & other supports > Lyney's Charged ATK x4 > Elemental Burst > Elemental Skill >
    // Repeat" (traveler.gg gives the same); KQM's quick guide: "at least 3–4 Charged Shots per combo". So 4 Prop Arrows
    // (Charge Level 2), Q, E. Each Prop Arrow summons a Grin-Malkin Hat; "Only 1 Hat can exist at any given time" and
    // "Creating a Grin-Malkin Hat while another one already exists on the field will destroy it [and] cause it to fire
    // a Pyrotechnic Strike immediately" (wiki Card Force Translocation, Gameplay Notes): arrows 2-4 and the Burst's Hat
    // each fire the previous one (4), and his Skill explodes the Burst's Hat "equal to that of a Pyrotechnic Strike"
    // ("considered Charged Attack DMG"): 5 strikes, all read as Charged Attack DMG (the replaced ones' type: estimate).
    // Passive 1's +80% ATK: the 4 arrow Hats (KQM: the Burst's Hat "cannot benefit from Lyney's A1"). Prop Surplus:
    // 1 per arrow fired above 60% HP (KQM: "fire up to five Charged Shots from above 60% Max HP") + 1 from the Burst = 5,
    // the max, spent by the Skill. Left out: Spiritbreath Thorn (Pneuma, enemy-dependent). Rotation: his Burst cooldown.
    combo: "4[CS] Q E",
    hits: [
      { table: "normal", label: "Prop Arrow DMG", count: 4, type: CH },
      { table: "normal", label: "Pyrotechnic Strike DMG", count: 5, type: CH },
      { from: "passive1", re: /increase DMG dealt by (\d+)% of his ATK/, count: 4, type: CH, addOn: true },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Explosive Firework DMG", count: 1, type: BU },
      { table: "skill", label: "Skill DMG", count: 1, type: SK, tag: "propSurplus" },
    ],
    buffs: [
      { kind: "addPerStack", table: "skill", label: "Skill DMG Bonus", stacks: 5, hits: "propSurplus" },
      // Passive 2 against "opponents affected by Pyro" (his own Pyro): KQM, "Lyney will not gain the buff if he triggers
      // Vaporize or Melt", so not with them active (estimate: off for the whole rotation then).
      { kind: "dmgBonusByMembers", from: "passive2", base: /Increases the DMG dealt by (\d+)%/, per: /additional (\d+)%/, max: /up to (\d+)% increased DMG/, elements: ["Pyro"], unless: ["vaporize", "melt"] },
    ],
  },
  Yoimiya: {
    // KQM: "her entire Normal Attack string repeated 3 times" in Niwabi Fire-Dance (E), the highest-damage combo in
    // most teams; her Burst "should only be used when it is available (typically every 2 or 3 rotations)": 0.4.
    combo: "E 3[N5]",
    hits: [
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG", "5-Hit DMG"].map((label) => ({ table: "normal", label, count: 3, type: N, ...(label === "1-Hit DMG" || label === "4-Hit DMG" ? { instances: 2 } : {}) })),
      { table: "burst", label: "Skill DMG", count: 0.4, type: BU },
    ],
    buffs: [
      { kind: "factor", table: "skill", label: "Blazing Arrow DMG", types: [N] },
      // Passive 1: +2% Pyro DMG per Normal Attack hit, up to 10 stacks: ~8.5 stacks on average over the 3 strings.
      { kind: "dmgBonus", value: 0.17, types: [N, BU], note: "passive1: 2% per hit, 10 stacks max, ~8.5 averaged over E 3[N5]" },
    ],
  },
  Ganyu: {
    // KQM quick guide, Freeze (Citlali): "Ganyu E > ... > Ganyu C¹ EQ 4[C]": 2 Skills, 1 Burst, 5 Frostflake Arrows.
    // Trail of the Qilin deals its Skill DMG twice (KQM library: the dash "dealing AoE Cryo DMG"; the lotus "Blooms
    // profusely when destroyed ... dealing AoE Cryo DMG"). Her Burst's Ice Shards on one opponent (#225): KQM's Ganyu
    // guide (keqingmains.com/ganyu/, fetched 2026-10-21), "In single-target scenarios, it only targets the enemy once
    // every five Ice Shards, resulting in 10 instances of Cryo damage (assuming no random Ice Shards hit)": 10 of 50.
    combo: "E C EQ 4[C]",
    hits: [
      { table: "skill", label: "Skill DMG", count: 4, type: SK },
      { table: "normal", label: "Frostflake Arrow DMG", count: 5, type: CH },
      { table: "normal", label: "Frostflake Arrow Bloom DMG", count: 5, type: CH },
      { table: "burst", label: "Ice Shard DMG", count: 10, type: BU },
    ],
    buffs: [
      // Passive 1: +20% CRIT Rate for the Frostflake Arrows (and blooms) after the first: 4 of 5.
      { kind: "critRate", from: "passive1", re: /increased by (\d+)% for/, share: 4 / 5, labels: ["Frostflake Arrow DMG", "Frostflake Arrow Bloom DMG"] },
      // Passive 2: +20% Cryo DMG inside Celestial Shower: the 4 Charged Attacks after the Burst.
      { kind: "dmgBonus", from: "passive2", re: /grants a (\d+)% Cryo DMG Bonus/, share: 4 / 5, types: [CH] },
    ],
    combos: [
      {
        // #228. KQM quick guide, Melt (Bennett, Jean, Zhongli): "Ganyu E(Q) > Zhongli hE > Bennett Q > Jean EQ > Ganyu
        // 4[C]": one Skill (2 hits), her Burst, 4 Frostflake Arrows, all in Celestial Shower. Its other Melt samples
        // (5[C] with Xilonen, 6[C] with Dehya) skip her Burst. Which arrows Melt: the flat estimate (#226).
        combo: "E Q 4[C]",
        when: [{ reaction: "melt" }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 2, type: SK },
          { table: "normal", label: "Frostflake Arrow DMG", count: 4, type: CH },
          { table: "normal", label: "Frostflake Arrow Bloom DMG", count: 4, type: CH },
          { table: "burst", label: "Ice Shard DMG", count: 10, type: BU }, // 10 of 50 on one opponent (KQM, above)
        ],
        buffs: [
          { kind: "critRate", from: "passive1", re: /increased by (\d+)% for/, share: 3 / 4, labels: ["Frostflake Arrow DMG", "Frostflake Arrow Bloom DMG"] },
          { kind: "dmgBonus", from: "passive2", re: /grants a (\d+)% Cryo DMG Bonus/, types: [CH] },
        ],
      },
    ],
  },
  "Kamisato Ayato": {
    // KQM quick guide, "Default combo (reactions)": "Q > Team > E N15 > Team > E N15"; "15 consecutive Shunsuiken
    // attacks at C0" per Skill: 5 of each of the 3 Shunsuiken hits per Skill. One Water Illusion per Skill (it
    // explodes near opponents or when its duration ends). His Burst's Bloomwater Blades: of the 35 (wiki), 20 hit one
    // opponent in KQM's Ayato calcs (#225; "Ayato Mastersheet" from https://keqingmains.com/ayato/, "Weapon Calcs -
    // Unbuffed" sheet 1bDvtLPH4DzakGYufAyfgm9UvgE4K-4C-a4xmMNWFL3o, Template tab, fetched 2026-10-18: "Bloomwater Blade
    // DMG" x 20 instances in its two-Skill rotation).
    combo: "Q E N15 E N15",
    hits: [
      ...["Shunsuiken 1-Hit DMG", "Shunsuiken 2-Hit DMG", "Shunsuiken 3-Hit DMG"].map((label) => ({ table: "skill", label, count: 10, type: N, tag: "namisen" })),
      { table: "skill", label: "Water Illusion DMG", count: 2, type: SK },
      { table: "burst", label: "Bloomwater Blade DMG", count: 20, type: BU },
    ],
    buffs: [
      // Namisen: Max HP x the row per stack on each Shunsuiken hit. Passive 1 starts him at 2; each hit adds one, up
      // to 4: 2, 3, then 4 for the other 13 of 15 hits, 3.8 on average.
      { kind: "addPerStack", table: "skill", label: "Namisen DMG Bonus", stacks: 3.8, stat: "hp", hits: "namisen" },
      // Burst: Normal Attack DMG Bonus in its field (18s): both Skills fall inside (Skill CD 12s, 6s state).
      { kind: "dmgBonus", table: "burst", label: "Normal Attack DMG Bonus", types: [N] },
    ],
  },
  Navia: {
    // KQM quick guide: "Navia Q > cycle through teammates' abilities > Navia 2[E [combo]]", combo N3D N2 ("the
    // default recommended combo"). Cannon Fire Support every 0.75s (wiki) for 12s: 16. Surging Blade: one per
    // rotation, its 7s interval is longer than the time between her two Skills. Passive 1: +40% Normal Attack DMG
    // for 4s after each Skill (Geo infusion). Without Crystallize she has no Crystal Shrapnel: 5 Rosula Shardshots,
    // 120% (wiki table, 5 hits). Passive 2's ATK per Pyro/Electro/Cryo/Hydro member is left to the scorer.
    combo: "Q 2[E N3D N2]",
    hits: naviaHits,
    buffs: [
      { kind: "dmgBonus", from: "passive1", re: /will be increased by (\d+)%/, types: [N] },
      { kind: "baseDmgMultiplier", value: 0.2, labels: ["Rosula Shardshot Base DMG"] },
    ],
    combos: [
      {
        // KQM: "Her second Skill and all later rotations should have 6 Crystal Shrapnel stacks": 11 Shardshots (wiki:
        // "When all 11 Rosula Shardshots strike, 200%", point blank on one opponent), and the 3 stacks past 3 add 15%
        // DMG each (also to the Surging Blade, wiki).
        combo: "Q 2[E N3D N2]",
        when: [{ reaction: "crystallize" }],
        hits: naviaHits,
        buffs: [
          { kind: "dmgBonus", from: "passive1", re: /will be increased by (\d+)%/, types: [N] },
          { kind: "baseDmgMultiplier", value: 1, labels: ["Rosula Shardshot Base DMG"] },
          { kind: "dmgBonus", value: 0.45, types: [SK], note: "combat2: 15% per Crystal Shrapnel past 3, at 6" },
        ],
      },
    ],
  },
  Yanfei: {
    // KQM quick guide: opener "N1 Q N1C N1 E C", then "3[N3C]". Her Burst and Skill grant the most Scarlet Seals,
    // and each Normal Attack adds one (3 max): every Charged Attack consumes 3. Passive 1: +5% Pyro DMG per Seal
    // consumed for 6s: +15% on the 4 Charged Attacks after the first. Passive 2's extra hit on a CRIT Charged Attack is left out.
    combo: "N1 Q N1C N1 E C 3[N3C]",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 6, type: N },
      { table: "normal", label: "2-Hit DMG", count: 3, type: N },
      { table: "normal", label: "3-Hit DMG", count: 3, type: N },
      { table: "normal", label: "Charged Attack", pick: 3, count: 5, type: CH },
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    buffs: [
      { kind: "dmgBonus", from: "passive1", re: /increase Yanfei's Pyro DMG Bonus by (\d+)%/, times: 3, share: 4 / 5, types: [CH] },
      { kind: "dmgBonus", table: "burst", label: "Charged Attack DMG Bonus", types: [CH] },
    ],
  },
  Cyno: {
    // KQM quick guide, non-Thundering Fury: "E (N1) Q N2E 3[N5 N2E]" ((N1) optional, left out): his Skill before the
    // Burst, then 4 Mortuary Rites; KQM: ideal combos use the Skill "during 3 Endseer stance windows", so 3 Judications
    // (passive 1: +35% on that Mortuary Rite, "3 Duststalker Bolts" each: 9). Burst Normal Attacks: N2 + 3 N5 + 3 N2,
    // 29 hit instances (3- and 4-Hit hit twice).
    combo: "E Q N2E 3[N5 N2E]",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "skill", label: "Mortuary Rite DMG", count: 4, type: SK },
      { table: "burst", label: "1-Hit DMG", count: 7, type: N },
      { table: "burst", label: "2-Hit DMG", count: 7, type: N },
      { table: "burst", label: "3-Hit DMG", count: 3, instances: 2, type: N },
      { table: "burst", label: "4-Hit DMG", count: 3, instances: 2, type: N },
      { table: "burst", label: "5-Hit DMG", count: 3, type: N },
      { from: "passive1", re: /Duststalker Bolts that deal (\d+)% of Cyno's ATK/, count: 9, type: SK },
      // Passive 2: DMG from his EM on those same hits, so no Aggravate or teammates' flat DMG of its own (addOn).
      { from: "passive2", re: /Normal Attack DMG is increased by (\d+)% of his Elemental Mastery/, stat: "em", count: 29, type: N, addOn: true },
      { from: "passive2", re: /Duststalker Bolt DMG .*? increased by (\d+)% of his Elemental Mastery/, stat: "em", count: 9, type: SK, addOn: true },
    ],
    buffs: [
      { kind: "emBonus", table: "burst", label: "Elemental Mastery Bonus" },
      // Judication's +35% on 3 of the 4 Mortuary Rites, averaged; no flat DMG lands on them, so as a multiplier.
      { kind: "baseDmgMultiplier", value: 0.35 * 3 / 4, labels: ["Mortuary Rite DMG"] },
    ],
  },
  Mualani: {
    // KQM quick guide: "3[3-stacked bite]", "She uses 3 fully stacked Sharky's Bites": each a Sharky's Surging Bite
    // (Normal Attack DMG) at 3 Wave Momentum stacks. Her Burst "if available" (Energy decides). On one opponent her
    // missiles have no other marked target. Passive 2 (Burst DMG per party Nightsoul Burst) is left to the scorer.
    combo: "E 3[N1]",
    hits: [
      { table: "skill", label: "Sharky's Bite Base DMG", count: 3, type: N, tag: "bite" },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    buffs: [
      { kind: "addPerStack", table: "skill", label: "Wave Momentum DMG Bonus", stacks: 3, stat: "hp", hits: "bite" },
      { kind: "addPerStack", table: "skill", label: "Sharky's Surging Bite Additional DMG Bonus", stacks: 1, stat: "hp", hits: "bite" },
    ],
  },
  "Arataki Itto": {
    // KQM's Itto Mastersheet (#229; linked from https://keqingmains.com/q/itto-quickguide/, sheet
    // 1mLqhh2OROZ1TItzkvSeEoGIbwsqahXJJ-fD6kS1wlfA, Itto and Combos tabs, fetched 2026-10-18): default combo "C0 0PS
    // Ceiling", na1 e na2 na3 c3f n4 c4f E f, all in his Burst. Its hit counts, buffed plus snapshotted parts: n1 2, n2 2,
    // n3 2, n4 1, ca 7, cf 3, e 2. Burst: ATK from DEF; passive 2 adds 35% DEF to every Kesagiri slash (ca and cf).
    combo: "Q N1 E N2 N3 C3F N4 C4F E F",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 2, type: N },
      { table: "normal", label: "2-Hit DMG", count: 2, type: N },
      { table: "normal", label: "3-Hit DMG", count: 2, type: N },
      { table: "normal", label: "4-Hit DMG", count: 1, type: N },
      { table: "normal", label: "Arataki Kesagiri Combo Slash DMG", count: 7, type: CH },
      { table: "normal", label: "Arataki Kesagiri Final Slash DMG", count: 3, type: CH },
      { from: "passive2", re: /increased by (\d+)% of Arataki Itto's DEF/, stat: "def", count: 10, type: CH, addOn: true },
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
    ],
    buffs: [{ kind: "atkFromDef", table: "burst", label: "ATK Bonus" }],
  },
  Tartaglia: {
    // KQM's full guide (#232; https://keqingmains.com/tartaglia/, fetched 2026-10-18): its calc rotation "Q E + 3[mN2C]
    // 2[mN3C] (%Riptide Slash)"; the Weapon Calcs it links (sheet 1gPXar-_tcy2glyjLp0d8Rnr_qaXLEI1OLI79SU2d0bg,
    // Information tab, "Buffs per hit") list the hits: ranged Q, Stance Change, mN1 x5, mN2 x5, mN3 x2, melee Charged
    // Attack x5 (CA1 + CA2 each) and Riptide Slash x4. Melee Normal and Charged Attacks are Normal / Charged Attack DMG;
    // Riptide Slash and the Stance Change are Skill DMG.
    combo: "Q E 3[mN2C] 2[mN3C]",
    hits: [
      { table: "burst", label: "Skill DMG: Ranged", count: 1, type: BU },
      { table: "skill", label: "Stance Change DMG", count: 1, type: SK },
      { table: "skill", label: "1-Hit DMG", count: 5, type: N },
      { table: "skill", label: "2-Hit DMG", count: 5, type: N },
      { table: "skill", label: "3-Hit DMG", count: 2, type: N },
      { table: "skill", label: "Charged Attack DMG", count: 5, type: CH, instances: 2 },
      { table: "skill", label: "Riptide Slash", count: 4, type: SK },
    ],
    buffs: [],
  },
  Aloy: {
    // KQM's Aloy freeze calc (#232; "Aloy Weapon Calcs" by Greyhound#7836, linked from https://keqingmains.com/aloy/;
    // sheet 1tqQ3ZXky1vrSElLZPgi_qM94q9pX2eGbZpPXOasfjbc, "Aloy freeze" tab, fetched 2026-10-18): "Rotation" (C4) "7 N3RR
    // 1 E 1 Q"; "NA count" 7, "E count" 1, "Q count" 1 (C64-C67). The sheet doesn't spell out "N3RR"; its "NA string" is
    // 236.80% at 88 frames (C234-C235) = her level-9 N1 (35.52% + 39.96%) + N2 (72.52%) + N3 (88.80%), "Infused? TRUE"
    // (C88): an N3 string in Rushing Ice. "E" 641.92% (C240) = Freeze Bomb 301.92% + 5 Chillwater Bomblets x 68%; "Q"
    // 610.64% (C243). 7 x 88 + 67 + 118 frames = 13.35 s, its "Rotation Duration" (C19). Its NA DMG% bonus 64.58% (C109)
    // = Rushing Ice's 45.33% + 19.25%, passive 2's 3.5%/s ramp to 35% averaged (0.55 of the cap); ATK% 16% (C105) is
    // passive 1.
    combo: "E Q 7[N3]",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 7, type: N, instances: 2 },
      { table: "normal", label: "2-Hit DMG", count: 7, type: N },
      { table: "normal", label: "3-Hit DMG", count: 7, type: N },
      { table: "skill", label: "Freeze Bomb DMG", count: 1, type: SK },
      { table: "skill", label: "Chillwater Bomblet DMG", count: 5, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    buffs: [
      { kind: "dmgBonus", table: "skill", label: "Rushing Ice Normal Attack DMG Bonus", types: [N] },
      { kind: "dmgBonus", from: "passive2", re: /maximum Cryo DMG Bonus increase of (\d+)%/, share: 0.55, types: [N] },
      { kind: "atkPct", from: "passive1", re: /her ATK is increased by (\d+)%/ },
    ],
  },
  Noelle: {
    // KQM quick guide: N3D is "Noelle's bread and butter combo"; its rotation for Linnea, Columbina and Illuga or
    // Furina or Gorou: "Noelle EQ 5[N3D] N2" (strings vary by team, KQM). Burst: ATK from DEF.
    combo: "EQ 5[N3D] N2",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Burst DMG", count: 1, type: BU },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 6, type: N },
      { table: "normal", label: "2-Hit DMG", count: 6, type: N },
      { table: "normal", label: "3-Hit DMG", count: 5, type: N },
    ],
    buffs: [{ kind: "atkFromDef", table: "burst", label: "ATK Bonus" }],
  },
  "Shikanoin Heizou": {
    // KQM quick guide, C0 with Burst: "N1C Q (N1) E" ((N1) optional: "to fully stack Declension in the first
    // rotation", left out); his Skill at 4 Declension stacks and Conviction ("When you possess 4 Declension stacks, the
    // Conviction effect will be produced"). Windmuster Iris: one on a single opponent, only with an element to absorb
    // (lands with Swirl). Passive 2's party EM is a buff for the others.
    combo: "N1C Q E",
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 1, type: N },
      { table: "normal", label: "Charged Attack", count: 1, type: CH },
      { table: "burst", label: "Fudou Style Vacuum Slugger DMG", count: 1, type: BU },
      { table: "burst", label: "Windmuster Iris DMG", count: 1, type: BU, when: { reaction: "swirl" } },
      { table: "skill", label: "Skill DMG", count: 1, type: SK, tag: "heartstopper" },
    ],
    buffs: [
      { kind: "addPerStack", table: "skill", label: "Declension DMG Bonus", stacks: 4, hits: "heartstopper" },
      { kind: "addPerStack", table: "skill", label: "Conviction DMG Bonus", stacks: 1, hits: "heartstopper" },
    ],
  },
  Gaming: {
    // KQM quick guide, Vaporize default: Burst, then "seven Skill-plunge cycles"; "Man Chai is resummoned every time
    // Gaming performs his enhanced Plunging Attack" above 50% HP, and KQM counts 4-6 enhanced plunges during the
    // Burst state: 5 Man Chai Smashes. Passive 2: +20% Charmed Cloudstrider DMG at 50% HP or more (his own healing,
    // passive 1, keeps him there).
    combo: "Q 7[EP]",
    hits: [
      { table: "skill", label: "Plunging Attack: Charmed Cloudstrider DMG", count: 7, type: PL },
      { table: "burst", label: "Suanni Man Chai Smash DMG", count: 5, type: BU },
    ],
    buffs: [{ kind: "dmgBonus", from: "passive2", re: /Charmed Cloudstrider will deal (\d+)% more DMG/, types: [PL] }],
    combos: [
      {
        // KQM, Melt default: Burst, then "five to six Skill-plunge cycles": 5.5.
        combo: "Q 5.5[EP]",
        when: [{ reaction: "melt" }],
        hits: [
          { table: "skill", label: "Plunging Attack: Charmed Cloudstrider DMG", count: 5.5, type: PL },
          { table: "burst", label: "Suanni Man Chai Smash DMG", count: 5, type: BU },
        ],
      },
      {
        // His tagged main reaction is Melt, so a default combo would amplify by Melt: KQM's Vaporize default (the hits
        // above) gets its own entry for Vaporize teams (#239 found it unamplified).
        combo: "Q 7[EP]",
        when: [{ reaction: "vaporize" }],
        hits: [
          { table: "skill", label: "Plunging Attack: Charmed Cloudstrider DMG", count: 7, type: PL },
          { table: "burst", label: "Suanni Man Chai Smash DMG", count: 5, type: BU },
        ],
      },
    ],
  },
  Diluc: {
    // KQM quick guide: "Q N2E N2E N2E N2", "An easy and consistent combo for sustained damage": his Burst, 3 Searing
    // Onslaughts and 4 N2 strings, all inside Dawn's Pyro Infusion (8s, +4s from passive 2, which adds 20% Pyro DMG
    // while it lasts). Dawn's DoT (#225): the quick guide, "On larger enemies that cannot be pushed back, you will usually
    // only get 2-3 instances of DoT" (midpoint 2.5; https://keqingmains.com/q/diluc-quickguide/, fetched 2026-10-18).
    combo: "Q N2E N2E N2E N2",
    hits: [
      { table: "burst", label: "Slashing DMG", count: 1, type: BU },
      { table: "burst", label: "DoT", count: 2.5, type: BU },
      { table: "burst", label: "Explosion DMG", count: 1, type: BU },
      { table: "skill", label: "1-Hit DMG", count: 1, type: SK },
      { table: "skill", label: "2-Hit DMG", count: 1, type: SK },
      { table: "skill", label: "3-Hit DMG", count: 1, type: SK },
      { table: "normal", label: "1-Hit DMG", count: 4, type: N },
      { table: "normal", label: "2-Hit DMG", count: 4, type: N },
    ],
    buffs: [{ kind: "dmgBonus", from: "passive2", re: /Diluc gains (\d+)% Pyro DMG Bonus/, types: [N, SK] }],
  },
  Keqing: {
    // KQM quick guide, without 4pc Thundering Fury: "EQE 5[N1C] (N1)" ((N1) optional, left out): Lightning Stiletto,
    // Burst (KQM library: Consecutive Slash "40.8% x 8"), Thunderclap Slash, then 5 N1C (her Charged Attack: "2 rapid
    // sword strikes") in passive 1's Electro Infusion. Passive 2: +15% CRIT Rate for 8s from her Burst: every hit
    // after it (KQM: the combo fits "an ~8s window").
    combo: "EQE 5[N1C]",
    hits: [
      { table: "skill", label: "Lightning Stiletto DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Consecutive Slash DMG", count: 1, instances: 8, type: BU }, // the row is 40.8% x 8
      { table: "burst", label: "Last Attack DMG", count: 1, type: BU },
      { table: "skill", label: "Thunderclap Slash DMG", count: 1, instances: 2, type: SK }, // the row is x 2
      { table: "normal", label: "1-Hit DMG", count: 5, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 5, instances: 2, type: CH },
    ],
    buffs: [
      {
        kind: "critRate",
        from: "passive2",
        re: /CRIT Rate is increased by (\d+)%/,
        labels: ["Skill DMG", "Consecutive Slash DMG", "Last Attack DMG", "Thunderclap Slash DMG", "1-Hit DMG", "Charged Attack DMG"],
      },
    ],
  },
  Kaveh: {
    // KQM Kaveh quick guide (keqingmains.com/q/kaveh-quickguide/, linked by Jessie 2026-10-20, #262): "Kaveh EQ 2[N3D]
    // N1 E 2[N3D] N2 E (N2)", "For C1-C0 Kaveh" ((N2) optional, "can be omitted to save rotation length": left out). Its
    // C2+ combo is "EQ N3D N4 E N4D N4 E (N2)". 3 Skills, his Burst, 15 Normal Attacks in its Dendro infusion; each is one
    // hit at the standard 2.5s/3 hits ICD (wiki Schematic Setup, Advanced Properties). His Bloom DMG (Painted Dome's
    // Dendro Core bonus) stays outside damage (#145); passive 2's EM only feeds those reactions.
    combo: "EQ 2[N3D] N1 E 2[N3D] N2 E",
    hits: [
      { table: "skill", label: "Skill DMG", count: 3, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 6, type: N },
      { table: "normal", label: "2-Hit DMG", count: 5, type: N },
      { table: "normal", label: "3-Hit DMG", count: 4, type: N },
    ],
    buffs: [],
  },
  "Traveler (Cryo)": {
    // #236: no KQM guide. GameWith's Cryo Traveler guide (gamewith.net/genshin-impact/article/show/77315, fetched
    // 2026-10-20), "Premium Stellar-Conduct Traveler Team Rotation" (Yae Miko, Odette, Alyosha; Jessie's Genshin Track
    // rotation for the same team: "Yae EEE -> Alyosha E + Q -> Odette EE -> Traveler E, NA and CA spam, Q when star is
    // full"): "Skill -> [ Normal Attack (x2) -> Charged Attack (x2) ] x2 -> Normal Attack (x2) -> Burst -> Normal
    // Attack (x2) -> Charged Attack": 1 Skill, 8 Normal Attacks (4 1-Hit, 4 2-Hit), 5 Charged Attacks (2 strikes each).
    // Jessie (2026-10-20): they aren't a strong DPS without Stellar Glimmer. This default reads that combo with no
    // Radiance (estimate): Physical attacks, no ice crystals with them (the Star's interval has no rate yet), so no
    // Frostglow and 3 javelin strikes. Left out everywhere: "Frostglow DMG Bonus" (datamine and wiki give 4.69% at
    // level 9 with no unit: per stack or per strike unsourced). No rotation length: their 15s Burst cooldown.
    combo: "E 2[N2 2C] N2 Q N2 C (no Radiance: estimate)",
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "normal", label: "1-Hit DMG", count: 4, type: N, element: "Physical" },
      { table: "normal", label: "2-Hit DMG", count: 4, type: N, element: "Physical" },
      { table: "normal", label: "Charged Attack DMG", count: 5, instances: 2, type: CH, element: "Physical" }, // "{a}+{b}": both strikes
      { table: "burst", label: "Ice Javelin DMG", count: { table: "burst", label: "No. of Strikes in Attack" }, type: BU },
    ],
    buffs: [],
    combos: [
      {
        // GameWith's combo under Radiance: Stellar-Conduct (passive 3: "inside a Polestar Field"). Passive 1: attacks
        // "are converted to Cryo DMG" and "increased by 80% of the Traveler's ATK" (all 18 strikes). The Star "will
        // instead fire an ice crystal at opponents in a coordinated attack when the Traveler hits an opponent ... once
        // every 0.2s": one per attack, 13 (a Charged Attack's 2 rapid strikes, one crystal). Each crystal gives 1
        // Frostglow (max 8); the 10 attacks before the Burst fill it, so "Additional Frostglow Attack Strikes at Stack
        // Max" adds to its strikes, and its DMG "is changed to Cryo DMG of the corresponding Stellar Glimmer reaction".
        combo: "E 2[N2 2C] N2 Q N2 C, Radiance: Stellar-Conduct",
        when: [{ reaction: "stellar-conduct", radiance: true }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "normal", label: "1-Hit DMG", count: 4, type: N },
          { table: "normal", label: "2-Hit DMG", count: 4, type: N },
          { table: "normal", label: "Charged Attack DMG", count: 5, instances: 2, type: CH },
          { from: "passive1", re: /also increased by (\d+)% of the Traveler's ATK/, count: 8, type: N, addOn: true },
          { from: "passive1", re: /also increased by (\d+)% of the Traveler's ATK/, count: 10, type: CH, addOn: true },
          { table: "skill", label: "Ice Crystal DMG", count: 13, type: SK },
          { table: "burst", label: "Stellar-Conduct Ice Javelin Single Strike DMG", count: { table: "burst", label: "No. of Strikes in Attack" }, type: BU, lunar: "stellar-conduct" },
          { table: "burst", label: "Stellar-Conduct Ice Javelin Single Strike DMG", count: { table: "burst", label: "Additional Frostglow Attack Strikes at Stack Max" }, type: BU, lunar: "stellar-conduct" },
        ],
      },
      {
        // GameWith's "Stellar Swirl Traveler Team Rotation" (Odette, Faruzan): "Use their Skill, then Burst. You can use
        // their special Charged Attack after Skill, but it's not necessary": Skill and Burst, the Burst as Stellar Swirl.
        // Outside Stellar-Conduct the Star fires at intervals (no rate yet), so no Frostglow: 3 strikes.
        combo: "E Q, Radiance: Stellar Swirl",
        when: [{ reaction: "stellar-swirl", radiance: true }],
        hits: [
          { table: "skill", label: "Skill DMG", count: 1, type: SK },
          { table: "burst", label: "Stellar Swirl Ice Javelin Single Strike DMG", count: { table: "burst", label: "No. of Strikes in Attack" }, type: BU, lunar: "stellar-swirl" },
        ],
      },
    ],
  },
  "Traveler (Hydro)": {
    // KQM Hydro Traveler quick guide: "Hold Skill can be used to apply Hydro at range for up to 6s, firing up to 22
    // Dewdrops", then the Torrent Surge at its end; "the Hold Skill effectively has a 16s interval between uses"; the
    // Burst "typically every other rotation" (Energy decides here). Left out: Spiritbreath Thorn (no sourced count in a
    // 6s Hold) and Suffusion's HP-based Dewdrop and Torrent Surge bonus (KQM doesn't say it is used).
    combo: "hE Q",
    hits: [
      { table: "skill", label: "Dewdrop DMG", count: 22, type: SK },
      { table: "skill", label: "Torrent Surge DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    buffs: [],
  },
  Razor: {
    // #231. KQM's Multi-Optimization guide (keqingmains.com/misc/multi-optimization/, 2023-06-26), its Physical Razor
    // config: "The assumed rotation is tE Q tE 3x(N4D N3tED)", with these hit weights (both Noblesse states summed;
    // its C6 target left out, C0): N1-N3 6 each, N4 3, Press 5, Burst 1, Soul Companion on N1-N3 6 each and on N4 3.
    // Normal Attacks are Physical; the Wolf Within's Soul Companion hits deal "% Normal Attack DMG" (genshin-db) as
    // Electro, tagged Elemental Burst (wiki Lightning Fang attack table). No rotation length: his 20s Burst cooldown.
    combo: "tE Q tE 3x(N4D N3tED)",
    goblet: "Physical",
    hits: [
      { table: "skill", label: "Press Skill DMG", count: 5, type: SK },
      { table: "burst", label: "Burst DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 6, type: N, element: "Physical" },
      { table: "normal", label: "2-Hit DMG", count: 6, type: N, element: "Physical" },
      { table: "normal", label: "3-Hit DMG", count: 6, type: N, element: "Physical" },
      { table: "normal", label: "4-Hit DMG", count: 3, type: N, element: "Physical" },
      { table: "normal", label: "1-Hit DMG", as: "Soul Companion 1-Hit DMG", ofRow: { table: "burst", label: "Soul Companion DMG" }, count: 6, type: BU },
      { table: "normal", label: "2-Hit DMG", as: "Soul Companion 2-Hit DMG", ofRow: { table: "burst", label: "Soul Companion DMG" }, count: 6, type: BU },
      { table: "normal", label: "3-Hit DMG", as: "Soul Companion 3-Hit DMG", ofRow: { table: "burst", label: "Soul Companion DMG" }, count: 6, type: BU },
      { table: "normal", label: "4-Hit DMG", as: "Soul Companion 4-Hit DMG", ofRow: { table: "burst", label: "Soul Companion DMG" }, count: 3, type: BU },
    ],
    buffs: [],
  },
  Eula: {
    // #222. KQM quick guide: "tE Q N4 hE N4", "Eula's default Burst combo, granting her the highest number of Lightfall
    // stacks (~13 without Attack SPD)". Her Normal Attacks and Lightfall Sword are Physical; Skill and Burst casts Cryo.
    // Grimheart: Press gives 1, her Burst 1 (passive 2), so the Hold consumes 2: 2 Icewhirl Brands (Skill text: "Each
    // consumed stack ... converted into an Icewhirl Brand") and passive 1's Shattered Lightfall Sword, "50% of the
    // basic Physical DMG dealt by a Lightfall Sword" (half the base row, no stacks). Her own RES shred: buffs below.
    combo: "tE Q N4 hE N4",
    goblet: "Physical",
    hits: [
      { table: "skill", label: "Press DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 2, type: N, element: "Physical" },
      { table: "normal", label: "2-Hit DMG", count: 2, type: N, element: "Physical" },
      { table: "normal", label: "3-Hit DMG", count: 2, instances: 2, type: N, element: "Physical" },
      { table: "normal", label: "4-Hit DMG", count: 2, type: N, element: "Physical" },
      { table: "skill", label: "Hold DMG", count: 1, type: SK },
      { table: "skill", label: "Icewhirl Brand DMG", count: 2, type: SK },
      { table: "burst", label: "Lightfall Sword Base DMG", count: 1, type: BU, element: "Physical", tag: "lightfall" },
      { table: "burst", label: "Lightfall Sword Base DMG", count: 0.5, type: BU, element: "Physical" },
    ],
    buffs: [
      { kind: "addPerStack", table: "burst", label: "DMG Per Stack", stacks: 13, hits: "lightfall" },
      // #204: her Hold Skill's Physical and Cryo RES Decrease (7s) on the hits after it: the Lightfall Sword explosions
      // and the Icewhirl Brands. Her last N4 string shares its labels with the first, so it goes without (estimate low).
      { kind: "resShred", table: "skill", label: "Physical RES Decrease", elements: ["Physical"], labels: ["Lightfall Sword Base DMG"] },
      { kind: "resShred", table: "skill", label: "Cryo RES Decrease", elements: ["Cryo"], labels: ["Icewhirl Brand DMG"] },
    ],
    combos: [
      {
        // #119. KQM's Eula quick guide (https://keqingmains.com/q/eula-quickguide/, fetched 2026-10-20): "tE Q N3 hE N4
        // D N2 ... should only be used if Eula is buffed by at least 27% Attack SPD (i.e., Pines, Mika, C2 Jean)", 15
        // Lightfall stacks. Mika teams (C0: Pines and C2 Jean are past the model). Same Skill and Burst hits.
        combo: "tE Q N3 hE N4 D N2",
        when: [{ members: [["Mika"]] }],
        hits: [
          { table: "skill", label: "Press DMG", count: 1, type: SK },
          { table: "burst", label: "Skill DMG", count: 1, type: BU },
          { table: "normal", label: "1-Hit DMG", count: 3, type: N, element: "Physical" },
          { table: "normal", label: "2-Hit DMG", count: 3, type: N, element: "Physical" },
          { table: "normal", label: "3-Hit DMG", count: 2, instances: 2, type: N, element: "Physical" },
          { table: "normal", label: "4-Hit DMG", count: 1, type: N, element: "Physical" },
          { table: "skill", label: "Hold DMG", count: 1, type: SK },
          { table: "skill", label: "Icewhirl Brand DMG", count: 2, type: SK },
          { table: "burst", label: "Lightfall Sword Base DMG", count: 1, type: BU, element: "Physical", tag: "lightfall" },
          { table: "burst", label: "Lightfall Sword Base DMG", count: 0.5, type: BU, element: "Physical" },
        ],
        buffs: [
          { kind: "addPerStack", table: "burst", label: "DMG Per Stack", stacks: 15, hits: "lightfall" },
          { kind: "resShred", table: "skill", label: "Physical RES Decrease", elements: ["Physical"], labels: ["Lightfall Sword Base DMG"] },
          { kind: "resShred", table: "skill", label: "Cryo RES Decrease", elements: ["Cryo"], labels: ["Icewhirl Brand DMG"] },
        ],
      },
    ],
  },
  Chasca: {
    // #233. KQM quick guide, normal combo: "E C[6 6 6 6 4]" ("4 rounds of 6 Shells and one round of 3-4 Shells"): 28
    // Shadowhunt Shells. Skill text: of the 4th, 5th and 6th Shells, "For each Pyro, Hydro, Cryo, or Electro character
    // in the party, one Shadowhunt Shell will randomly be Converted into a Shining Shadowhunt Shell" of their element:
    // 1 per such teammate per 6-Shell round (3 at most), 1 in the 4-Shell round (only its 4th Shell): 5/9/13 for 1/2/3
    // teammates. Passive 1: by the number of their element types, a 33.3%/66.7%/100% chance per round that the 3rd Shell
    // converts too (5 rounds: 1.67/3.33/5) and +15%/35%/65% Shining Shell DMG. The rest stay Anemo. Rotation: her Burst
    // cooldown (KQM gives none). Passive 2's Burning Shadowhunt Shots (teammates' Nightsoul Bursts) are left out.
    combo: "E C[6 6 6 6 4]",
    hits: [
      { table: "skill", label: "Resonance DMG", count: 1, type: SK },
      { table: "skill", label: "Shadowhunt Shell DMG", count: 28, type: CH, byTeammates: { elements: ["Pyro", "Hydro", "Cryo", "Electro"], members: [0, -5, -9, -13], types: [0, -5 / 3, -10 / 3, -5] } },
      { table: "skill", label: "Shining Shadowhunt Shell DMG", count: 0, type: CH, element: "teammates", byTeammates: { elements: ["Pyro", "Hydro", "Cryo", "Electro"], members: [0, 5, 9, 13], types: [0, 5 / 3, 10 / 3, 5] } },
    ],
    buffs: [
      { kind: "dmgBonusByTypes", from: "passive1", re: /Shining Shadowhunt Shell by (\d+)%\/(\d+)%\/(\d+)%/, elements: ["Pyro", "Hydro", "Cryo", "Electro"], labels: ["Shining Shadowhunt Shell DMG"] },
    ],
  },
  Freminet: {
    // #231. KQM quick guide, Cryo Skill DPS: "EQE 4[2E N1] 2E" ("maximizes the number of Pressure Level 0 casts per
    // rotation"): 6 Upward Thrusts, 6 Level 0 Shattering Pressures (Cryo), 4 Normal Attacks (Physical) and the frost
    // each unleashes in Pers Timer (Cryo, Skill DMG; his Burst: "200% of their original DMG"). His main reaction is
    // Freeze, so this is his default. Left out: Spiritbreath Thorns (one per 9s interval, no sourced count) and passive 2
    // (+40% Shattering Pressure after a Shatter).
    combo: "EQE 4[2E N1] 2E",
    hits: [
      { table: "skill", label: "Upward Thrust DMG", count: 6, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "skill", label: "Level 0 Shattering Pressure DMG", count: 6, type: SK },
      { table: "normal", label: "1-Hit DMG", count: 4, type: N, element: "Physical" },
      { table: "skill", label: "Frost DMG", count: 4, type: SK },
    ],
    buffs: [{ kind: "baseDmgMultiplier", value: 1, labels: ["Frost DMG"] }],
    combos: [
      {
        // KQM, Physical Skill DPS: "EQ N2E 3[EN2E N1]" ("maximizes the number of Pressure Level 4 casts"; the last
        // iteration "often only EN2E or EN3E": the notation as given). In his Burst each Normal Attack adds 2 Pressure
        // Levels, so N2 reaches Level 4: 4 Thrusts, 4 Level 4 Shattering Pressures (Physical), 11 Normal Attacks and
        // their frost. Superconduct teams; a Physical goblet on the benchmark build.
        combo: "EQ N2E 3[EN2E N1]",
        when: [{ reaction: "superconduct" }],
        goblet: "Physical",
        hits: [
          { table: "skill", label: "Upward Thrust DMG", count: 4, type: SK },
          { table: "burst", label: "Skill DMG", count: 1, type: BU },
          { table: "skill", label: "Level 4 Shattering Pressure DMG", count: 4, type: SK, element: "Physical" },
          { table: "normal", label: "1-Hit DMG", count: 7, type: N, element: "Physical" },
          { table: "normal", label: "2-Hit DMG", count: 4, type: N, element: "Physical" },
          { table: "skill", label: "Frost DMG", count: 11, type: SK },
        ],
      },
    ],
  },
};

// Which carry hits react (#226): on one opponent, the hits that apply their element (kit-overrides.json `carryIcd`, from
// the Genshin Impact Wiki's Internal Cooldown/Data table), each taken to find the aura it reacts with. Hits of one ICD
// tag and type share a counter: with `every` k, hits 1, k+1, 2k+1... of the rotation apply; the timer's resets are
// left out (estimate: the hits are taken as close together, so this is a lower bound), unless `windows` says how many
// separate timer windows they fall in (uses further apart than the reset, e.g. Ayato's two Skills), each starting the
// counter over. "first": one hit per use applies (`count` is the number of uses, each use's hits land inside the
// reset: estimate). `hits`: hits per count when the row's value sums several (Ayaka's Charged Attack, "x3") and
// `instances` doesn't split it. "none": every hit applies. A hit's `reacting` is its share of the group's applying
// hits times its count. Hits without an entry, or with a sourced `reacting`, keep theirs (damage.ts falls back to its
// flat share for hits with neither).
const STANDARD_CARRY_ICD = { reset: 2.5, every: 3 }; // wiki: Default ICD Type, "2.5" s, "1 0 0 as the repetend"
// How many of the first m hits of a counter apply: hits 1, k+1, 2k+1..., a part hit counting as its fraction.
const applying = (m, every) => {
  if (every === "first") return Math.min(1, m);
  const whole = Math.floor(m);
  return Math.ceil(whole / every) + (whole % every === 0 ? m - whole : 0);
};
const icdUsed = new Set(); // carryIcd keys some hit read, so a misspelt one fails the build
function icdReacting(id, hits, keys) {
  const table = OVERRIDES.carryIcd?.[id] ?? {};
  const groups = new Map();
  hits.forEach((h, i) => {
    const icd = keys[i] && table[keys[i]];
    if (!icd) return;
    icdUsed.add(`${id}|${keys[i]}`);
    if (icd === "none") return void (h.reacting = h.count);
    const { reset, every } = { ...STANDARD_CARRY_ICD, ...icd };
    if (!icd.tag || !(reset > 0) || !(every === "first" || every >= 1)) throw new Error(`${id}: carryIcd "${keys[i]}" needs tag, reset, every`);
    const key = `${icd.tag}|${reset}|${every}`;
    if (!groups.has(key)) groups.set(key, { every, rows: [], windows: undefined });
    const g = groups.get(key);
    g.rows.push({ h, hits: h.count * (h.instances ?? icd.hits ?? 1) });
    if (icd.windows !== undefined) g.windows = icd.windows;
  });
  for (const g of groups.values()) {
    const n = g.rows.reduce((a, r) => a + r.hits, 0);
    const uses = g.rows.reduce((a, r) => a + r.h.count, 0);
    if (!(n > 0)) continue;
    const windows = g.windows ?? (g.every === "first" ? uses : Math.min(1, uses));
    const share = (windows * applying(n / windows, g.every)) / n;
    for (const r of g.rows) r.h.reacting = round(r.h.count * share);
  }
  return hits;
}

// Reads a CARRIES entry into numbers: each hit's multiplier per stat and count, each buff's value.
function readCarry(id, spec) {
  const talents = talentsOf(id);
  const rates = OVERRIDES.hitRates?.[id] ?? {};
  const tableAttrs = (t) => talents[COMBAT[t === "normal" ? "normal" : t]]?.attributes;
  const text = (from) => talents[from].description.replace(/\s+/g, " ");
  const num = (from, re) => {
    const m = text(from).match(re);
    if (!m) throw new Error(`${id}: pattern ${re} not found in ${from}`);
    return Number(m[1].replace(/,/g, "")); // "1,800"
  };
  const missing = [...(spec.missing ?? [])];
  const readHits = (list) => {
    const hits = [];
    const keys = []; // each hit's carryIcd key ("table: label"), for icdReacting (#226)
    for (const h of list) {
      let count = h.count;
      if (count === "rate") {
        const r = rates[`carry: ${h.label}`];
        if (!r) throw new Error(`${id}: "${h.label}" needs a kit-overrides.json hitRates "carry: ${h.label}" entry`);
        if (r.missing) {
          missing.push(`${h.label} (${r.missing})`);
          continue;
        }
        count = r.hits;
      } else if (typeof count === "object") count = tableValue(tableAttrs(count.table), count.label, id);
      if (h.reacting !== undefined && !(h.reacting >= 0 && h.reacting <= count)) throw new Error(`${id}: "${h.label}" reacting ${h.reacting} of ${count}`);
      let scaling = h.from ? { [h.stat ?? "atk"]: num(h.from, h.re) / 100 } : scalingOf(tableAttrs(h.table), h.label, id, h.pick);
      // ofRow: a hit dealing a share of another (Razor's Soul Companion, "% Normal Attack DMG"): that row's value.
      if (h.ofRow) {
        const share = tableValue(tableAttrs(h.ofRow.table), h.ofRow.label, id);
        scaling = Object.fromEntries(Object.entries(scaling).map(([k, v]) => [k, round(v * share)]));
      }
      hits.push({
        label: h.from ? `${h.from} bonus` : (h.as ?? h.label),
        type: h.type,
        scaling,
        count,
        ...(h.instances ? { instances: h.instances } : {}),
        ...(h.reacting !== undefined ? { reacting: h.reacting } : {}),
        ...(h.lunar ? { lunar: h.lunar } : {}),
        ...(h.additive ? { additive: true } : {}),
        ...(h.addOn ? { addOn: true } : {}),
        ...(h.collision ? { collision: true } : {}),
        ...(h.nightsoulBursts ? { nightsoulBursts: h.nightsoulBursts } : {}),
        ...(h.element ? { element: h.element } : {}),
        ...(h.byTeammates ? { byTeammates: { elements: h.byTeammates.elements, ...(h.byTeammates.members ? { members: h.byTeammates.members.map(round) } : {}), ...(h.byTeammates.types ? { types: h.byTeammates.types.map(round) } : {}) } } : {}),
        ...(h.when ? { when: h.when } : {}),
        ...(h.tag ? { tag: h.tag } : h.resolve ? { tag: h.resolve } : h.fightingSpirit ? { tag: h.fightingSpirit } : {}),
      });
      keys.push(h.from || h.addOn || h.reacting !== undefined ? null : `${h.table}: ${h.label}`);
    }
    return icdReacting(id, hits, keys);
  };
  const raw = (t, label, pick = 0) => {
    const s = scalingOf(tableAttrs(t), label, id, pick);
    return Object.values(s)[0];
  };
  const readBuff = (b) => {
    switch (b.kind) {
      case "atkFromHp":
        return { kind: b.kind, value: raw(b.table, b.label), capOfBase: num(COMBAT[b.table], b.cap) / 100 };
      case "addPerStack": {
        const stacks = typeof b.stacks === "number" ? b.stacks : typeof b.stacks === "string" ? tableValue(tableAttrs(b.table), b.stacks, id) : num(COMBAT[b.table], b.stacks);
        return { kind: b.kind, value: raw(b.table, b.label, b.pick), stacks, tag: b.hits, ...(b.stat ? { stat: b.stat } : {}), ...(b.fightingSpirit ? { fightingSpirit: true } : {}) };
      }
      case "dmgBonus": {
        // share: the part of those hits the buff covers (Ganyu's passive 2: the 4 Charged Attacks after her Burst).
        const value = round((b.value ?? (b.from ? num(b.from, b.re) / 100 : raw(b.table, b.label, b.pick))) * (b.times ?? 1) * (b.share ?? 1));
        const cap = typeof b.hitsCap === "number" ? b.hitsCap : b.hitsCap ? num(COMBAT[b.table], b.hitsCap) : undefined;
        return {
          kind: b.kind,
          value,
          types: b.types,
          ...(cap ? { hitsCap: cap } : {}),
          ...(b.note ? { note: b.note } : {}),
          ...(b.fightingSpirit ? { fightingSpirit: true } : {}),
          ...(b.when ? { when: b.when } : {}),
        };
      }
      case "dmgBonusByMembers": {
        // A DMG bonus that grows per teammate of `elements` (Lyney's passive 2, #230): base, +per each, capped; index =
        // number of such teammates (0-3). `unless`: reactions that take it away.
        const base = num(b.from, b.base) / 100, per = num(b.from, b.per) / 100, max = num(b.from, b.max) / 100;
        return { kind: b.kind, values: [0, 1, 2, 3].map((n) => round(Math.min(max, base + per * n))), elements: b.elements, ...(b.unless ? { unless: b.unless } : {}) };
      }
      case "dmgBonusByTypes": {
        const m = text(b.from).match(b.re);
        if (!m) throw new Error(`${id}: pattern ${b.re} not found in ${b.from}`);
        return { kind: b.kind, values: m.slice(1).map((v) => Number(v) / 100), elements: b.elements, labels: b.labels };
      }
      case "resShred":
        return { kind: b.kind, value: raw(b.table, b.label), elements: b.elements, labels: b.labels };
      case "critRate":
        return { kind: b.kind, value: round((num(b.from, b.re) / 100) * (b.share ?? 1)), labels: b.labels };
      case "factor":
        return { kind: b.kind, value: b.from ? num(b.from, b.re) / 100 : raw(b.table, b.label), types: b.types, ...(b.when ? { when: b.when } : {}) };
      case "factorByReactions": {
        const m = text(b.from).match(b.re);
        if (!m) throw new Error(`${id}: pattern ${b.re} not found in ${b.from}`);
        return { kind: b.kind, values: m.slice(1).map((v) => Number(v) / 100), types: b.types, reactions: b.reactions };
      }
      case "dmgBonusFromHp": {
        const value = Math.min(num(b.from, b.max), num(b.from, b.per) * (b.hp * 100 - num(b.from, b.above))) / 100;
        return { kind: "dmgBonus", value: round(value), types: b.types, note: `${b.from} at ${b.hp * 100}% HP` };
      }
      case "atkFromDef":
        return { kind: b.kind, value: raw(b.table, b.label) };
      case "atkPct":
        return { kind: b.kind, value: (num(b.from, b.re) / 100) * (b.times ? num(b.from, b.times) : 1) };
      case "dmgBonusPerEnergy":
        return { kind: "dmgBonus", value: round(raw(b.table, b.label) * tableValue(tableAttrs("burst"), "Energy Cost", id)), types: b.types };
      case "dmgBonusFromEr":
        return { kind: b.kind, perPercent: num(b.from, b.re) / 100 };
      case "dmgBonusPerEm":
        return { kind: b.kind, perEm: num(b.from, b.re) / 100, max: num(b.from, b.max) / 100, types: b.types, labels: b.labels };
      case "flatAtk":
        return { kind: b.kind, value: round((num(b.from, b.re) / 100) * num(b.from, b.stacks)), cap: num(b.from, b.cap), types: b.types, reactions: b.reactions };
      case "masque":
        return { kind: b.kind, ratio: raw(b.table, b.label), start: num(b.start.from, b.start.re) / 100, use: num(b.use.from, b.use.re) / 100 };
      case "emFromAtk":
        return { kind: b.kind, value: num(b.from, b.re) / 100, max: num(b.from, b.max) };
      case "lunarBaseBonus":
        return { kind: b.kind, stat: b.stat, perPoint: round(num(b.from, b.re) / 100 / b.per), max: num(b.from, b.max) / 100 };
      case "lunarReactionBonus":
        // From a passive's text, or a talent table row (`perEm`: per that many points of the carry's EM, Mizuki #235).
        return {
          kind: b.kind,
          value: b.table ? raw(b.table, b.label) : num(b.from, b.re) / 100,
          reaction: b.reaction,
          ...(b.perEm ? { perEm: b.perEm } : {}),
          ...(b.when ? { when: b.when } : {}),
        };
      case "baseDmgMultiplier":
        return { kind: b.kind, value: round(b.value), labels: b.labels, ...(b.when ? { when: b.when } : {}) };
      case "emBonus":
        return { kind: b.kind, value: b.from ? num(b.from, b.re) : raw(b.table, b.label), ...(b.when ? { when: b.when } : {}) };
      default:
        throw new Error(`${id}: unknown carry buff ${b.kind}`);
    }
  };
  const hits = readHits(spec.hits);
  const buffs = spec.buffs.map(readBuff);
  if (spec.combos && !spec.combo) throw new Error(`${id}: a carry with combos needs its default combo's notation (combo)`);
  const combos = (spec.combos ?? []).map((k) => {
    if (!k.combo || !k.when?.length) throw new Error(`${id}: each combo needs combo and when`);
    return { combo: k.combo, when: k.when, hits: readHits(k.hits), ...(k.buffs ? { buffs: k.buffs.map(readBuff) } : {}), ...(k.goblet ? { goblet: k.goblet } : {}) };
  });
  const rotation = OVERRIDES.rotations?.[id] ?? {};
  for (const t of rotation.teams ?? [])
    if (!t.when?.length || !(t.seconds > 0) || !t.source) throw new Error(`${id}: each rotations team needs when, seconds, source`);
  if (Object.keys(rotation).length && !rotation.source) throw new Error(`${id}: rotations needs a source`);
  return {
    rotationSeconds: rotation.seconds ?? tableValue(tableAttrs("burst"), "CD", id),
    ...(rotation.teams?.length ? { rotationTeams: rotation.teams.map((t) => ({ when: t.when, seconds: t.seconds })) } : {}),
    ...(spec.combo ? { combo: spec.combo } : {}),
    ...(spec.radianceInDamage ? { radianceInDamage: true } : {}),
    hits,
    buffs,
    ...(combos.length ? { combos } : {}),
    ...(missing.length ? { missing } : {}),
    ...(spec.goblet ? { goblet: spec.goblet } : {}),
  };
}

const tags = require("../data/tags.json");
// Buffers, and anyone else with a SPEC entry: a kit bonus to the team's reaction damage (Nilou, Kaveh: #256).
const buffers = tags.filter((c) => (c.roles.includes("buffer") && (c.buffs ?? []).length > 0) || SPEC[c.id]);
const characters = {};
for (const c of buffers) {
  const db = genshindb.characters(c.id);
  const stats = db?.stats(90);
  const base = stats ? { hp: Math.round(stats.hp), atk: Math.round(stats.attack), def: Math.round(stats.defense) } : null;
  if (NO_VALUE[c.id]) {
    characters[c.id] = { base, buffs: [], missing: NO_VALUE[c.id] };
    continue;
  }
  if (!SPEC[c.id]) throw new Error(`${c.id} is a buffer in tags.json but has no SPEC entry`);
  characters[c.id] = { base, ...(SPEC[c.id].buildFor ? { buildFor: SPEC[c.id].buildFor } : {}), buffs: readBuffs(c.id, SPEC[c.id]) };
}

// Every Moonsign character with an Ascendant Gleam upgrade needs a GLEAM entry, so a new one can't be missed.
const ascendantGleam = {};
for (const c of tags.filter((c) => (c.families ?? []).includes("moonsign"))) {
  const t = talentsOf(c.id);
  const has = t && ["combat1", "combat2", "combat3", "passive1", "passive2", "passive3"].some((k) => t[k]?.description.includes("Ascendant Gleam"));
  if (has && !GLEAM[c.id]) throw new Error(`${c.id} has an Ascendant Gleam upgrade but no GLEAM entry`);
  if (GLEAM[c.id]) ascendantGleam[c.id] = readGleam(c.id, GLEAM[c.id]);
}

// Every Hexerei character with Secret Rite text needs a SECRET_RITE entry, the same way.
const secretRite = {};
for (const c of tags.filter((c) => (c.families ?? []).includes("hexerei"))) {
  const t = talentsOf(c.id);
  const has = t && Object.values(t).some((x) => SECRET_RITE_HEADING.test(x?.description ?? ""));
  if (has && !SECRET_RITE[c.id]) throw new Error(`${c.id} has Hexerei: Secret Rite text but no SECRET_RITE entry`);
  if (SECRET_RITE[c.id]) secretRite[c.id] = readSecretRite(c.id, SECRET_RITE[c.id]);
}

// Every character whose kit reacts to a party member's Nightsoul Burst needs a NIGHTSOUL_BURST entry.
const nightsoulBurst = {};
for (const c of tags) {
  const t = talentsOf(c.id);
  const has = t && ["passive1", "passive2", "passive3"].some((k) => /triggers? (a )?Nightsoul Bursts?/.test(t[k]?.description ?? ""));
  if (has && !NIGHTSOUL_BURST[c.id]) throw new Error(`${c.id} reacts to Nightsoul Bursts but has no NIGHTSOUL_BURST entry`);
  if (NIGHTSOUL_BURST[c.id]) nightsoulBurst[c.id] = readNightsoulBurst(c.id, NIGHTSOUL_BURST[c.id]);
}
const nightsoulRule = OVERRIDES.rules.nightsoulBurst;

// Mavuika's Fighting Spirit (#116): the Nightsoul points each Nightsoul member gives her per rotation.
const fightingSpirit = readFightingSpirit(tags.filter((c) => (c.families ?? []).includes("nightsoul")).map((c) => c.id));

// Carries (#101): the 16 compare carries first; other main DPS are listed until they get an entry.
const carries = {};
for (const [id, spec] of Object.entries(CARRIES)) carries[id] = readCarry(id, spec);
for (const [id, table] of Object.entries(OVERRIDES.carryIcd ?? {}))
  for (const key of Object.keys(id === "_howTo" ? {} : table))
    if (!icdUsed.has(`${id}|${key}`)) throw new Error(`${id}: carryIcd "${key}" matches no carry hit`);
for (const id of Object.keys(OVERRIDES.rotations ?? {}))
  if (!id.startsWith("_") && !CARRIES[id]) throw new Error(`kit-overrides.json rotations: ${id} has no carry damage model`);
const carriesTodo = tags.filter((c) => c.roles.includes("main-dps") && !CARRIES[c.id]).map((c) => c.id);

// Every off-field sub-DPS needs a SUBDPS entry, so none is silently left without damage. Entries for supports whose
// in-game roles aren't DPS (#105: Citlali, Lauma) stay: their hits still deal damage.
for (const c of tags.filter((c) => c.roles.includes("sub-dps") && c.fieldTime === "off")) {
  if (!SUBDPS[c.id]) throw new Error(`${c.id} is an off-field sub-DPS in tags.json but has no SUBDPS entry`);
}
// Moonsign Benediction's Lunar Reaction Base DMG Bonus (#88): each converter raises the Base DMG of the party's Lunar
// reactions by their own stat, "per `per` points of `stat`", capped. Genshin Impact Wiki, Damage § Reaction Base DMG
// Bonus (fetched 2026-10-18) lists exactly these seven; its formula has one "(1 + % Reaction Base DMG Bonus)" term, so
// several converters' bonuses add. kit.json `lunarBase`; a converter's own direct Lunar hits read theirs too
// (subDps lunarBaseBonus, PR #155; carries: their CARRIES lunarBaseBonus buff).
const benediction = (id, stat, reaction) => ({
  from: "passive3",
  re: new RegExp(`every ${{ atk: "100 ATK", def: "100 DEF", em: "point of Elemental Mastery" }[stat]} that ${id} has increasing ${reaction}'s Base DMG by ([\\d.]+)%`),
  per: stat === "em" ? 1 : 100,
  stat,
  max: /maximum of (\d+)%/,
  reactions: [reaction.toLowerCase()],
});
const LUNAR_CONVERTERS = {
  Flins: benediction("Flins", "atk", "Lunar-Charged"),
  Ineffa: benediction("Ineffa", "atk", "Lunar-Charged"),
  Lauma: benediction("Lauma", "em", "Lunar-Bloom"),
  Nefer: benediction("Nefer", "em", "Lunar-Bloom"),
  Linnea: benediction("Linnea", "def", "Lunar-Crystallize"),
  Zibai: benediction("Zibai", "def", "Lunar-Crystallize"),
  // "Lunar Reaction DMG inflicted by party members gain a Base DMG increase", her own hits included.
  Columbina: {
    from: "passive3",
    re: /For every 1,000 points of Max HP, the Base DMG of Lunar reactions is increased by ([\d.]+)%/,
    per: 1000,
    stat: "hp",
    max: /maximum of (\d+)%/,
    reactions: ["lunar-charged", "lunar-bloom", "lunar-crystallize"],
  },
  // Stellar Jubilee (#235): the same Base DMG bonus to the party's Stellar reactions (wiki Damage § Reaction Base DMG
  // Bonus § Stellar Glimmer lists these four).
  Odette: { from: "passive3", re: /increased by ([\d.]+)% for every 100 points of Odette's ATK/, per: 100, stat: "atk", max: /maximum increase of (\d+)%/, reactions: ["stellar-conduct", "stellar-swirl"] },
  Sandrone: { from: "passive3", re: /increased by ([\d.]+)% for every 100 points of Sandrone's ATK/, per: 100, stat: "atk", max: /maximum increase of (\d+)%/, reactions: ["stellar-conduct", "stellar-swirl"] },
  "Traveler (Cryo)": { from: "passive3", re: /increased by ([\d.]+)% for every 100 points of the Traveler's ATK/, per: 100, stat: "atk", max: /maximum (\d+)% increase/, reactions: ["stellar-conduct", "stellar-swirl"] },
  Vesna: { from: "passive3", re: /Every 100 ATK she has increases the Base Stellar Swirl DMG by ([\d.]+)%/, per: 100, stat: "atk", max: /maximum DMG increase that can be gained this way is (\d+)%/, reactions: ["stellar-swirl"] },
};
const lunarBase = {};
for (const [id, b] of Object.entries(LUNAR_CONVERTERS)) {
  const text = genshindb.talents(id)[b.from].description.replace(/\s+/g, " ");
  const read = (re) => {
    const m = text.match(re);
    if (!m) throw new Error(`${id}: pattern ${re} not found in ${b.from}`);
    return Number(m[1]);
  };
  lunarBase[id] = { stat: b.stat, perPoint: round(read(b.re) / 100 / b.per), max: read(b.max) / 100, reactions: b.reactions };
}
// Set bonuses to the wearer's own damage, as carry buffs (#206), read from genshin-db's set text (4pc unless `pieces`
// is 2). Freeze scores only through these (Jessie, 2026-10-18, #205). Kinds: critRate, dmgBonus (`types`: hit types,
// default every hit; `element`: hits of that element only), atkPct (of base ATK), reactionBonus (`reactions`: the
// Reaction Bonus term of Vaporize/Melt, Aggravate and direct Lunar hits), dmgBonusFromEr (per 100% ER, capped at `max`),
// atkPctPerSame / emPerOther (per other member of the wearer's / another element, up to `max` members). `stacks`: a
// "Max N stacks" read at full stacks, or a number. `when` (damage.ts setFits): aura (an element the team applies),
// reaction (one the team triggers), wearerReacts (the wearer triggers one of the team's reactions), hpChanges (the
// wearer's HP goes up or down: a healer, or HP drain: holderStates), hpDrops (HP drain only), bondOfLife (their own kit
// gives them a Bond of Life: holderStates), nightsoul (their kit has Nightsoul's Blessing: tags.json families),
// noEnergy (no Energy Burst), weapons (the wearer's weapon type), moonsign (nascent: one Moonsign member, ascendant: two
// or more; with a Lunar reaction active).
// 2pc bonuses (`pieces: 2`) are only those the character screen doesn't show (DMG bonus by hit type, conditional DMG):
// an imported build's final stats have the rest (ATK%, elemental DMG, EM, ER), and a benchmark build's generic
// "elemental goblet + set" DMG bonus (benchmark.ts carryDmgBonus) stands in for its 2pc, so only imports get these.
// Effects marked `estimate` are taken as up throughout the rotation where the text needs a trigger the model doesn't
// track (a Skill cast before the hits): the source line says so.
const SETS = {
  "Blizzard Strayer": [
    { kind: "critRate", re: /affected by Cryo, their CRIT Rate is increased by (\d+)%/, when: { aura: "Cryo" } },
    { kind: "critRate", re: /If the opponent is Frozen, CRIT Rate is increased by an additional (\d+)%/, when: { reaction: "freeze" } },
  ],
  "Crimson Witch of Flames": [
    // "Using Elemental Skill increases the 2-Piece Set Bonus by 50% of its starting value ... Max 3 stacks": 7.5% Pyro
    // DMG a stack, at 1 stack (KQM's Hu Tao guide: "only being able to maintain one stack"; Yoimiya's: "1 stack of its
    // 4-piece effect in a typical rotation"; estimate for others; holderStates.setStacks has sourced counts).
    { kind: "dmgBonus", element: "Pyro", re: /increases the 2-Piece Set Bonus by (\d+)% of its starting value/, of2pc: /Pyro DMG Bonus \+(\d+)%/, stacks: 1, maxStacks: /Max (\d+) stacks/ },
    { kind: "reactionBonus", reactions: ["vaporize", "melt"], re: /Increases Vaporize and Melt DMG by (\d+)%/ },
  ],
  "Emblem of Severed Fate": [
    { kind: "dmgBonusFromEr", types: ["burst"], re: /Increases Elemental Burst DMG by (\d+)% of Energy Recharge/, cap: /A maximum of (\d+)% bonus DMG/ },
  ],
  "Gilded Dreams": [
    // "Within 8s of triggering an Elemental Reaction": the wearer triggers one of the team's reactions (kept up: estimate).
    { kind: "atkPctPerSame", re: /ATK is increased by (\d+)% for each party member whose Elemental Type is the same/, cap: /count up to (\d+) characters/, when: { wearerReacts: true } },
    { kind: "emPerOther", re: /Elemental Mastery is increased by (\d+) for every party member with a different Elemental Type/, cap: /count up to (\d+) characters/, flat: true, when: { wearerReacts: true } },
  ],
  "Fragment of Harmonic Whimsy": [
    // KQM: Arlecchino "can easily maintain full stacks"; Clorinde "easily stacks the 4pc effect".
    { kind: "dmgBonus", re: /this character deals (\d+)% increased DMG for 6s/, stacks: /Max (\d+) stacks/, when: { bondOfLife: true } },
  ],
  "Thundering Fury": [
    // Its Skill CD cut is left out.
    { kind: "reactionBonus", reactions: ["aggravate"], re: /the DMG Bonus conferred by Aggravate by (\d+)%/ },
    { kind: "reactionBonus", reactions: ["lunar-charged"], re: /the DMG caused by Lunar-Charged and Stellar-Conduct by (\d+)%/ },
  ],
  "Night of the Sky's Unveiling": [
    // Gleaming Moon: Intent's CRIT Rate "when nearby party members trigger Lunar Reactions": 15% at Nascent Gleam, 30%
    // at Ascendant Gleam. Its teamwide Lunar Reaction DMG +10% is effects.json's (a team buff), not counted here.
    { kind: "critRate", re: /Increases CRIT Rate by (\d+)%\/\d+% when the party's Moonsign is Nascent Gleam/, when: { moonsign: "nascent" } },
    { kind: "critRate", re: /Increases CRIT Rate by \d+%\/(\d+)% when the party's Moonsign is Nascent Gleam\/Ascendant Gleam/, when: { moonsign: "ascendant" } },
  ],
  "Marechaussee Hunter": [
    { kind: "dmgBonus", pieces: 2, types: ["normal", "charged"], re: /Normal and Charged Attack DMG \+(\d+)%/ },
    { kind: "critRate", re: /CRIT Rate will be increased by (\d+)% for 5s/, stacks: /Max (\d+) stacks/, when: { hpChanges: true } },
  ],
  "Finale of the Deep Galleries": [
    // The Burst half stops for 6s after each Normal Attack hit: left out (estimate; Skirk's combo has no Burst hit).
    { kind: "dmgBonus", types: ["normal"], re: /has 0 Elemental Energy, Normal Attack DMG is increased by (\d+)%/, when: { noEnergy: true } },
  ],
  "Long Night's Oath": [
    { kind: "dmgBonus", pieces: 2, types: ["plunge"], re: /Plunging Attack DMG increased by (\d+)%/ },
    // KQM's Varesa guide: she "is able to easily stack its 4pc effect".
    { kind: "dmgBonus", types: ["plunge"], re: /Plunging Attacks deal (\d+)% increased DMG for 6s/, stacks: /Max (\d+) stacks/ },
  ],
  "Vermillion Hereafter": [
    { kind: "atkPct", re: /increasing their ATK by (\d+)% for 16s/, estimate: "after their Burst" },
    { kind: "atkPct", re: /their ATK will further increase by (\d+)%/, stacks: /a maximum of (\d+) times/, when: { hpDrops: true } },
  ],
  "Obsidian Codex": [
    { kind: "dmgBonus", pieces: 2, re: /is on the field, their DMG dealt is increased by (\d+)%/, when: { nightsoul: true } },
    { kind: "critRate", re: /consumes 1 Nightsoul point while on the field, CRIT Rate increases by (\d+)%/, when: { nightsoul: true } },
  ],
  "Shimenawa's Reminiscence": [
    // Its 15 Energy cost is left out (estimate).
    { kind: "dmgBonus", types: ["normal", "charged", "plunge"], re: /Normal\/Charged\/Plunging Attack DMG is increased by (\d+)% for 10s/, estimate: "after their Skill" },
  ],
  "Golden Troupe": [
    { kind: "dmgBonus", pieces: 2, types: ["skill"], re: /^Increases Elemental Skill DMG by (\d+)%/ },
    // The off-field 25% more isn't an on-field carry's.
    { kind: "dmgBonus", types: ["skill"], re: /^Increases Elemental Skill DMG by (\d+)%/ },
  ],
  "Gladiator's Finale": [
    { kind: "dmgBonus", types: ["normal"], re: /uses a Sword, Claymore or Polearm, increases their Normal Attack DMG by (\d+)%/, when: { weapons: ["Sword", "Claymore", "Polearm"] } },
  ],
  "Wanderer's Troupe": [
    { kind: "dmgBonus", types: ["charged"], re: /Increases Charged Attack DMG by (\d+)% if the character uses a Catalyst or a Bow/, when: { weapons: ["Catalyst", "Bow"] } },
  ],
  "Heart of Depth": [
    { kind: "dmgBonus", types: ["normal", "charged"], re: /After using Elemental Skill, increases Normal Attack and Charged Attack DMG by (\d+)%/, estimate: "after their Skill" },
  ],
  "Unfinished Reverie": [
    { kind: "dmgBonus", re: /it will increase by 10% instead until it reaches (\d+)%/, when: { reaction: "burning" } },
  ],
};
const sets = {};
for (const [name, values] of Object.entries(SETS)) {
  const a = genshindb.artifacts(name);
  if (!a || a.name !== name) throw new Error(`${name}: no such artifact set in genshin-db`);
  const texts = { 2: a.effect2Pc.replace(/\s+/g, " "), 4: a.effect4Pc.replace(/\s+/g, " ") };
  const read = (re, pieces) => {
    const m = texts[pieces].match(re);
    if (!m) throw new Error(`${name}: pattern ${re} not found in its ${pieces}pc text: ${texts[pieces]}`);
    return m;
  };
  sets[name] = values.map((v) => {
    const pieces = v.pieces ?? 4;
    const m = read(v.re, pieces);
    const stacks = typeof v.stacks === "number" ? v.stacks : v.stacks ? Number(read(v.stacks, pieces)[1]) : 1;
    const of2pc = v.of2pc ? Number(read(v.of2pc, 2)[1]) / 100 : 1;
    return {
      kind: v.kind,
      ...(pieces === 2 ? { pieces } : {}),
      value: round((Number(m[1]) / (v.flat ? 1 : 100)) * of2pc * stacks),
      // A stacking effect whose stack count a character's kit sets (holderStates.setStacks): the value of one stack.
      ...(v.maxStacks ? { perStack: round((Number(m[1]) / 100) * of2pc), maxStacks: Number(read(v.maxStacks, pieces)[1]) } : {}),
      ...(v.cap ? { max: Number(read(v.cap, pieces)[1]) / (v.kind === "dmgBonusFromEr" ? 100 : 1) } : {}),
      ...(v.types ? { types: v.types } : {}),
      ...(v.element ? { element: v.element } : {}),
      ...(v.reactions ? { reactions: v.reactions } : {}),
      ...(v.when ? { when: v.when } : {}),
      source: `${pieces}pc: "${m[0]}"${stacks > 1 ? ` x${stacks} stacks` : ""}${v.estimate ? ` (taken as up ${v.estimate}: estimate)` : ""}`,
    };
  });
}
// Per-character facts the set and weapon conditions need (#206), each checked against genshin-db's talent text:
// selfHpDrain: their kit drains their own HP (an HP change for Marechaussee; KQM: Neuvillette's "HP drain from
// Neuvillette's Charged Attack", Xiao's "HP drain", Wriothesley's "HP drain ... 4pc Marechaussee Hunter"); partyHpDrain:
// their kit drains the party's HP (Furina's Salon Members); bondOfLife: their kit gives them a Bond of Life.
const HOLDER_STATES = {
  selfHpDrain: {
    Neuvillette: /If Neuvillette's HP is above 50%, he will continuously lose HP/,
    Xiao: /In this state, Xiao will continuously lose HP/,
    Wriothesley: /it will consume a fixed amount of Wriothesley's HP/,
    "Hu Tao": /Hu Tao consumes a set portion of her HP/,
    Lyney: /he will consume a portion of his HP to obtain 1 Prop Surplus stack/,
  },
  partyHpDrain: { Furina: /the Members will increase their current attack's power based on the number of such characters, and consume said characters' HP/ },
  bondOfLife: {
    Arlecchino: /When Arlecchino has a Bond of Life/,
    Clorinde: /When her Bond of Life is equal to or greater than/,
    Sigewinne: /will grant her a Bond of Life/,
  },
};
const holderStates = {};
for (const [state, byId] of Object.entries(HOLDER_STATES)) {
  holderStates[state] = Object.entries(byId).map(([id, re]) => {
    const t = genshindb.talents(id);
    const text = ["combat1", "combat2", "combat3", "passive1", "passive2", "passive3"].map((k) => t?.[k]?.description ?? "").join(" ").replace(/\s+/g, " ");
    if (!re.test(text)) throw new Error(`${id}: ${state} pattern ${re} not found in their talents`);
    return id;
  });
}
// setStacks: a sourced stack count on a stacking set effect for one character, over the set's default (Crimson Witch: 1).
holderStates.setStacks = {
  // KQM Gaming quick guide (keqingmains.com/q/gaming-quickguide, accessed 2026-10-20): "He can easily reach max stacks
  // on the 4pc effect, since he uses his Skill at least 5 times per rotation."
  Gaming: { "Crimson Witch of Flames": 3 },
};
for (const [id, bySet] of Object.entries(holderStates.setStacks)) {
  for (const [set, n] of Object.entries(bySet)) {
    const spec = (sets[set] ?? []).find((v) => v.maxStacks);
    if (!spec || n > spec.maxStacks) throw new Error(`${id}: setStacks ${set} ${n} doesn't fit a stacking effect of that set`);
  }
}
// The 4pc set a carry without a build reads as wearing (#279, #206): their KQM quick guide's pick (accessed
// 2026-10-20), the first option whose `when` fits the team (reaction: the team triggers it; members: one of them is in
// the team; none: always). Only sets in SETS: a carry whose guide picks another (Itto, Navia, Noelle: Husk,
// Nighttime Whispers; Eula: Pale Flame; Klee: Rising Winds; Tartaglia: Nymph's Dream; Heizou, Wanderer: Viridescent
// Venerer, a team set; Keqing: Marechaussee or Night by team; Kaveh: Deepwood Memories) has none yet.
const kqm = (page, quote) => `KQM ${page.replace(/-quickguide$/, "")} quick guide (keqingmains.com/q/${page}, accessed 2026-10-20): "${quote}"`;
const benchmarkSets = {
  Ganyu: [{ set: "Blizzard Strayer", when: { reaction: "freeze" }, source: kqm("ganyu-quickguide", "This set is Ganyu's best-in-slot against freezable enemies") }],
  Freminet: [{ set: "Blizzard Strayer", when: { reaction: "freeze" }, source: kqm("freminet-quickguide", "4pc BS is one of Freminet's best artifact sets in his Cryo Skill DPS playstyle") }],
  "Kamisato Ayaka": [{ set: "Marechaussee Hunter", when: { members: ["Furina"] }, source: kqm("ayaka-quickguide", "4pc Marechaussee Hunter is Ayaka's recommended artifact set for most content when Furina is on the team") }],
  Skirk: [
    { set: "Marechaussee Hunter", when: { members: ["Furina"] }, source: kqm("skirk-quickguide", "Marechaussee offers plenty of CRIT Rate and a Normal Attack DMG Bonus, which makes it on-field Skirk's Best-in-Slot as long as she can maintain full stacks and never uses her regular Burst — in other words, in Furina teams with no split rotations") },
    { set: "Finale of the Deep Galleries", source: kqm("skirk-quickguide", "Galleries performs less than ~2% worse than Marechaussee for Skirk's on-field playstyle ... While it's her best generalist set") },
  ],
  "Hu Tao": [{ set: "Crimson Witch of Flames", source: kqm("hu-tao-quickguide", "4pc Crimson Witch of Flames (4CW) Very strong on Hu Tao as she is able to benefit from everything it provides") }],
  Diluc: [{ set: "Crimson Witch of Flames", source: kqm("diluc-quickguide", "the difference is small enough where 4CW remains the generally recommended set") }],
  Gaming: [{ set: "Crimson Witch of Flames", source: kqm("gaming-quickguide", "4pc Crimson Witch of Flames is Gaming's best artifact set for Melt and Vaporize teams") }],
  "Raiden Shogun": [{ set: "Emblem of Severed Fate", source: kqm("raiden-quickguide", "4pc Emblem of Severed Fate (EoSF) Undisputed best-in-slot set") }],
  Alhaitham: [{ set: "Gilded Dreams", source: kqm("alhaitham-quickguide", "4pc Gilded Dreams is Alhaitham's general Best-in-Slot artifact set") }],
  "Yumemizuki Mizuki": [{ set: "Gilded Dreams", source: kqm("mizuki-quickguide", "4pc Gilded Dreams (GD) Mizuki's BiS artifact set for personal damage in SSW teams") }],
  Arlecchino: [{ set: "Fragment of Harmonic Whimsy", source: kqm("arlecchino-quickguide", "Arlecchino's general Best-in-Slot set grants DMG Bonus according to Bond of Life. She can easily maintain full stacks") }],
  Clorinde: [{ set: "Fragment of Harmonic Whimsy", source: kqm("clorinde-quickguide", "It provides her with the highest personal damage in all her teams, as she easily stacks the 4pc effect") }],
  Cyno: [{ set: "Thundering Fury", source: kqm("cyno-quickguide", "4pc Thundering Fury is Cyno's Best-in-Slot artifact set") }],
  Flins: [{ set: "Night of the Sky's Unveiling", source: kqm("flins-quickguide", "4pc Night of the Sky's Unveiling (NotSU) Flins's best artifact set") }],
  Nefer: [{ set: "Night of the Sky's Unveiling", source: kqm("nefer-quickguide", "Nefer's best-in-slot set by a significant margin") }],
  Zibai: [{ set: "Night of the Sky's Unveiling", source: kqm("zibai-quickguide", "By far Zibai's best artifact set") }],
  Neuvillette: [{ set: "Marechaussee Hunter", source: kqm("neuvillette-quickguide", "Marechaussee's Charged Attack DMG% and hefty CRIT Rate make it Neuvillette's BiS by a sizable margin") }],
  Wriothesley: [{ set: "Marechaussee Hunter", source: kqm("wriothesley-quickguide", "4pc MH only performs slightly behind 4pc DiDS in Stellar-Conduct teams, but it is the Best-in-Slot in Wriothesley's other playstyles") }],
  Xiao: [{ set: "Vermillion Hereafter", source: kqm("xiao-quickguide", "4pc Vermillion Hereafter One of Xiao's best artifact sets. His Burst's HP drain stacks a buff of up to 48% ATK") }],
  Kinich: [{ set: "Obsidian Codex", source: kqm("kinich-quickguide", "4pc Obsidian Codex Kinich's best set, offering 40% CRIT Rate and 15% DMG") }],
  Mavuika: [{ set: "Obsidian Codex", source: kqm("mavuika-quickguide", "4pc Obsidian Codex is on-field Mavuika's Best-in-Slot") }],
  Mualani: [{ set: "Obsidian Codex", source: kqm("mualani-quickguide", "Easily Mualani's Best-in-Slot") }],
  Chasca: [{ set: "Obsidian Codex", source: kqm("chasca-quickguide", "4pc Obsidian Codex Chasca's best set") }],
  Varesa: [{ set: "Long Night's Oath", source: kqm("varesa-quickguide", "Varesa is able to easily stack its 4pc effect for a substantial 100% Plunge DMG Bonus. This set performs either better to around equal to 4pc Obsidian Codex") }],
  Yoimiya: [{ set: "Shimenawa's Reminiscence", source: kqm("yoimiya-quickguide", "4pc SR is the baseline recommendation for almost all of Yoimiya's possible teams") }],
  "Kamisato Ayato": [{ set: "Heart of Depth", source: kqm("ayato-quickguide", "All of these sets perform similarly ... 4pc Heart of Depth is one of Ayato's best sets") }],
  Lyney: [{ set: "Marechaussee Hunter", source: kqm("lyney-quickguide", "Marechaussee Hunter By far Lyney's best artifact set. Lyney pairs well with this set's condition") }],
  Tighnari: [{ set: "Wanderer's Troupe", source: kqm("tighnari-quickguide", "4-piece Wanderer's Troupe (4WT) Provides an unconditional buff to his Charged Shots") }],
};
for (const [id, options] of Object.entries(benchmarkSets)) {
  for (const b of options) if (!sets[b.set]) throw new Error(`${id}: benchmark set ${b.set} isn't in SETS`);
  if (!carries[id]) throw new Error(`${id}: a benchmark set for a character with no carry kit`);
}

// Weapon passives on the holder's own hits (#40, #206), read from genshin-db's passive text at each refinement (R1-R5):
// `values` per refinement. A team-conditional one has `when`: energy (the value is per point of the party's combined
// max Energy, capped at `max`), teammatesSkill (another member uses their Skill), geo (a member deals Geo DMG while
// active), hpChanges (party HP goes up or down: a healer in the team). Static stats a weapon gives (Uraku's DEF) are on
// the character screen, so an imported build already has them; DMG bonuses by type aren't.
const WATATSUMI = [
  {
    kind: "dmgBonus", types: ["burst"], when: { energy: true },
    re: /combined maximum Energy capacity, the Elemental Burst DMG of the character equipping this weapon is increased by ([\d.]+)%/,
    max: /A maximum of ([\d.]+)% increased Elemental Burst DMG/,
  },
];
const WEAPONS = {
  Akuoumaru: WATATSUMI,
  "Mouun's Moon": WATATSUMI,
  "Wavebreaker's Fin": WATATSUMI,
  "Mountain-Bracing Bolt": [
    { kind: "dmgBonus", types: ["skill"], re: /and increases Elemental Skill DMG by ([\d.]+)%/ },
    { kind: "dmgBonus", types: ["skill"], when: { teammatesSkill: true }, re: /Elemental Skill DMG will also increase by ([\d.]+)% for/ },
  ],
  "Uraku Misugiri": [
    { kind: "dmgBonus", types: ["normal"], re: /Normal Attack DMG is increased by ([\d.]+)%/ },
    { kind: "dmgBonus", types: ["skill"], re: /Elemental Skill DMG is increased by ([\d.]+)%/ },
    // "the aforementioned effects increase by 100%": the same values again.
    { kind: "dmgBonus", types: ["normal"], when: { geo: true }, re: /Normal Attack DMG is increased by ([\d.]+)%(?=.*increase by 100%)/ },
    { kind: "dmgBonus", types: ["skill"], when: { geo: true }, re: /Elemental Skill DMG is increased by ([\d.]+)%(?=.*increase by 100%)/ },
  ],
  "Splendor of Tranquil Waters": [
    // Each "for 6s. Max N stacks", taken at full stacks while the team's HP keeps changing (estimate).
    { kind: "dmgBonus", types: ["skill"], when: { hpChanges: true }, re: /Elemental Skill DMG dealt will be increased by ([\d.]+)% for 6s/, stacks: /for 6s\. Max (\d+) stacks/ },
    { kind: "hpPct", when: { hpChanges: true }, re: /Max HP will be increased by ([\d.]+)% for 6s/, stacks: /Max HP will be increased by [\d.]+% for 6s\. Max (\d+) stacks/ },
  ],
  // More passives on the holder's own damage (#206): DMG bonus by hit type (no `types`: every hit), atkPct (of base
  // ATK), atkFromEm (of the holder's EM). Only what the character screen doesn't show: the static ATK%, HP%, CRIT and
  // "All Elemental DMG Bonus" parts (Haran's, Calamity Queller's 12%) are in an import's final stats. Conditions:
  // teammatesSkill, hpChanges (as above, or the holder's HP drain: kit.json holderStates), bondOfLife (their kit gives
  // them a Bond of Life), aura (a member applies one of these elements), reactions (the team triggers one). Stacks
  // gained by the holder's own hits or casts (a Skill, Normal Attacks) are taken as full (estimate, `full`).
  "Haran Geppaku Futsu": [
    { kind: "dmgBonus", types: ["normal"], when: { teammatesSkill: true }, re: /each stack of Wavespike consumed will increase Normal Attack DMG by ([\d.]+)%/, stacks: /Max (\d+) stacks/ },
  ],
  "Kagura's Verity": [
    { kind: "dmgBonus", types: ["skill"], full: true, re: /increasing the wielding character's Elemental Skill DMG by ([\d.]+)%/, stacks: /Max (\d+) stacks/ },
    { kind: "dmgBonus", full: true, re: /gain a ([\d.]+)% All Elemental DMG Bonus when they possess 3 stacks/ },
  ],
  "Calamity Queller": [
    // On-field: its off-field doubling is left out.
    { kind: "atkPct", full: true, re: /causing ATK to increase by ([\d.]+)% per second/, stacks: /maximum of (\d+) stacks/ },
  ],
  "Tome of the Eternal Flow": [
    { kind: "dmgBonus", types: ["charged"], when: { hpChanges: true }, re: /Charged Attack DMG will be increased by ([\d.]+)% for 4s/, stacks: /Max (\d+) stacks/ },
  ],
  "Crimson Moon's Semblance": [
    // The second part needs a Bond of Life of 30% Max HP or more (Arlecchino's Masque; estimate for other holders).
    { kind: "dmgBonus", when: { bondOfLife: true }, re: /when the equipping character has a Bond of Life, they gain a ([\d.]+)% DMG Bonus/ },
    { kind: "dmgBonus", when: { bondOfLife: true }, re: /then gain an additional ([\d.]+)% DMG Bonus/ },
  ],
  Absolution: [
    { kind: "dmgBonus", when: { bondOfLife: true }, re: /increases the DMG the equipping character deals by ([\d.]+)% for 6s/, stacks: /Max (\d+) stacks/ },
  ],
  "Thundering Pulse": [
    { kind: "dmgBonus", types: ["normal"], full: true, re: /Thunder Emblem increases Normal Attack DMG by [\d.]+\/[\d.]+\/([\d.]+)%/ },
  ],
  "Aqua Simulacra": [{ kind: "dmgBonus", re: /the DMG dealt by the wielder of this weapon is increased by ([\d.]+)%/ }],
  "Polar Star": [
    { kind: "dmgBonus", types: ["skill", "burst"], re: /Elemental Skill and Elemental Burst DMG increased by ([\d.]+)%/ },
    { kind: "atkPct", full: true, re: /ATK is increased by [\d.]+\/[\d.]+\/[\d.]+\/([\d.]+)%/ },
  ],
  '"The Catch"': [{ kind: "dmgBonus", types: ["burst"], re: /Increases Elemental Burst DMG by ([\d.]+)%/ }], // its Burst CRIT Rate: left out
  Rust: [
    { kind: "dmgBonus", types: ["normal"], re: /Increases Normal Attack DMG by ([\d.]+)%/ },
    { kind: "dmgBonus", types: ["charged"], negative: true, re: /decreases Charged Attack DMG by ([\d.]+)%/ },
  ],
  Hamayumi: [
    // Doubled at full Energy: left out.
    { kind: "dmgBonus", types: ["normal"], re: /Increases Normal Attack DMG by ([\d.]+)%/ },
    { kind: "dmgBonus", types: ["charged"], re: /and Charged Attack DMG by ([\d.]+)%/ },
  ],
  "Kitain Cross Spear": [{ kind: "dmgBonus", types: ["skill"], re: /Increases Elemental Skill DMG by ([\d.]+)%/ }],
  "Wolf-Fang": [{ kind: "dmgBonus", types: ["skill", "burst"], re: /DMG dealt by Elemental Skill and Elemental Burst is increased by ([\d.]+)%/ }],
  "Dragon's Bane": [{ kind: "dmgBonus", when: { aura: ["Hydro", "Pyro"] }, re: /affected by Hydro or Pyro by ([\d.]+)%/ }],
  "Lion's Roar": [{ kind: "dmgBonus", when: { aura: ["Pyro", "Electro"] }, re: /affected by Pyro or Electro by ([\d.]+)%/ }],
  Rainslasher: [{ kind: "dmgBonus", when: { aura: ["Hydro", "Electro"] }, re: /affected by Hydro or Electro by ([\d.]+)%/ }],
  "Iron Sting": [{ kind: "dmgBonus", full: true, re: /increases all DMG by ([\d.]+)% for 6s/, stacks: /Max (\d+) stacks/ }],
  "Fang of the Mountain King": [
    // Full stacks with a Burning or Burgeon in the team (3 stacks a trigger); its Skill-hit stacks alone: left out.
    { kind: "dmgBonus", types: ["skill", "burst"], when: { reactions: ["burning", "burgeon"] }, re: /Elemental Skill and Burst DMG is increased by ([\d.]+)% for 6s/, stacks: /Max (\d+) stacks/ },
  ],
  "Staff of the Scarlet Sands": [
    { kind: "atkFromEm", full: true, re: /gain ([\d.]+)% of their Elemental Mastery as bonus ATK\. Max/, stacks: /Max (\d+) stacks/ },
  ],
  "Primordial Jade Winged-Spear": [
    { kind: "atkPct", full: true, re: /On hit, increases ATK by ([\d.]+)% for 6s/, stacks: /Max (\d+) stacks/ },
    { kind: "dmgBonus", full: true, re: /While in possession of the maximum possible stacks, DMG dealt is increased by ([\d.]+)%/ },
  ],
  "Lumidouce Elegy": [
    { kind: "dmgBonus", when: { reactions: ["burning"] }, re: /the DMG dealt is increased by ([\d.]+)%/, stacks: /max (\d+) stacks/ },
  ],
  "Fruitful Hook": [
    { kind: "dmgBonus", types: ["normal", "charged", "plunge"], full: true, re: /Normal, Charged, and Plunging Attack DMG increased by ([\d.]+)% for 10s/ },
  ],
};
const weapons = {};
for (const [name, specs] of Object.entries(WEAPONS)) {
  const w = genshindb.weapons(name);
  if (!w || w.name !== name) throw new Error(`${name}: no such weapon in genshin-db`);
  const texts = [w.r1, w.r2, w.r3, w.r4, w.r5].map((r) => r.description.replace(/\s+/g, " "));
  const read = (re, text) => {
    const m = text.match(re);
    if (!m) throw new Error(`${name}: pattern ${re} not found in its passive text: ${text}`);
    return Number(m[1]);
  };
  weapons[name] = specs.map((s) => {
    const stacks = s.stacks ? read(s.stacks, texts[0]) : 1;
    return {
      kind: s.kind,
      ...(s.types ? { types: s.types } : {}),
      values: texts.map((t) => round((read(s.re, t) / 100) * stacks * (s.negative ? -1 : 1))),
      ...(s.max ? { max: texts.map((t) => read(s.max, t) / 100) } : {}),
      ...(s.when ? { when: s.when } : {}),
      source: `R1: "${texts[0].match(s.re)[0]}"${stacks > 1 ? ` x${stacks} stacks` : ""}${s.full ? " (taken at full stacks / up throughout: estimate)" : ""}`,
    };
  });
}

// Level 90 base HP/ATK/DEF (character only), for a sub-DPS's benchmark build when the player has none (#158), and the
// level 90 ascension stat (#166: genshin-db substatType and its value; EM is flat, the rest are fractions).
// genshin-db matches names loosely, so the name is checked; the Traveler's base stats are Lumine's.
function baseStatsOf(id) {
  const db = genshindb.characters(id.startsWith("Traveler (") ? "Lumine" : id);
  if (!db || (db.name !== id && !id.startsWith("Traveler ("))) return null;
  const s = db.stats(90);
  const ascension = { stat: db.substatType, value: Math.round(s.specialized * 10000) / 10000 };
  return { hp: Math.round(s.hp), atk: Math.round(s.attack), def: Math.round(s.defense), ascension };
}

const subDps = {};
for (const [id, spec] of Object.entries(SUBDPS)) {
  subDps[id] = { base: baseStatsOf(id), ...readSubDps(id, spec) };
  if (lunarBase[id]?.reactions.some((r) => r.startsWith("lunar-"))) subDps[id].lunarBaseBonus = lunarBase[id];
}

// Every Stellar member needs a STELLAR entry, so a new one (or new Radiance text) can't be missed.
const stellar = {};
for (const c of tags.filter((c) => (c.families ?? []).includes("stellar"))) {
  if (!STELLAR[c.id]) throw new Error(`${c.id} is Stellar in tags.json but has no STELLAR entry`);
  stellar[c.id] = readStellar(c.id, STELLAR[c.id]);
}

// Shields and heals (#177). Each healer/shielder's effects that keep the team up: a shield, or healing over time.
// Scored by coverage: the share of the rotation an effect is up, duration / cooldown (capped at 1), both from the
// talent tables; a character's effects combine as 1 - product(1 - uptime). Sizes (absorption, healing per tick) are
// kept for review and a later size check; they aren't scored yet (Jessie's call, #177).
//   talent, value: the table row with the size; duration: a table label, a number, or { from, re } in the text;
//   cd: a table label (of `talent`, or { talent, label }); paws: Diona's Hold fires this many Icy Paws, each adds
//   the "per Paw" duration; from + re (instead of talent + value): a passive's sentence with the size
//   missing: no duration or cooldown to read; the scorer then counts the member as covering the rotation, as the
//   flat healer/shielder tag did
// Instant heals (Barbara's and Jean's Burst, Baizhu's Skill) top HP up once; they add no coverage and are left out.
const SUSTAIN = {
  Alyosha: { missing: "Tugarin's healing (passive 1) has no duration or rate in genshin-db's text" },
  Baizhu: [{ kind: "shield", talent: "burst", value: "Seamless Shield DMG Absorption", duration: "Pulsing Clarity Duration", cd: "CD" }],
  Barbara: [{ kind: "heal", talent: "skill", value: "Continuous Regeneration", duration: "Duration", cd: "CD" }],
  Beidou: { missing: "her Hold shield lasts only while the Skill is held; no duration in the tables" },
  Bennett: [{ kind: "heal", talent: "burst", value: "Continuous Regeneration Per Sec", duration: "Duration", cd: "CD" }],
  // Newsflash Field Duration is the field's own; the wiki gives no longer duration for Kamera's regeneration.
  Charlotte: [{ kind: "heal", talent: "burst", value: "Kamera Continuous Regeneration", duration: "Newsflash Field Duration", cd: "CD" }],
  Chevreuse: [{ kind: "heal", talent: "skill", value: "HP Regeneration Over Time", duration: "Healing Duration", cd: "CD" }],
  Citlali: [{ kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Dahlia: [{ kind: "shield", talent: "burst", value: "Shield of Sacred Favor DMG Absorption", duration: "Favonian Favor Duration", cd: "CD" }],
  Diona: [
    { kind: "shield", talent: "skill", value: "Base Shield DMG Absorption", duration: "Duration", paws: 5, cd: "Hold CD" },
    { kind: "heal", talent: "burst", value: "HP Regeneration Over Time", duration: "Duration", cd: "CD" },
  ],
  Dori: [{ kind: "heal", talent: "burst", value: "Continuous Healing", duration: "Duration", cd: "CD" }],
  Escoffier: [{ kind: "heal", from: "passive1", re: /Rehab Diet effect for (\d+)s: Restores HP for nearby active characters every 1s based on ([\d.]+)% of Escoffier's ATK/, cd: { talent: "burst", label: "CD" } }],
  Furina: [{ kind: "heal", talent: "skill", value: "Singer of Many Waters Healing", duration: "Duration", cd: "CD" }],
  Iansan: [{ kind: "heal", from: "passive2", re: /she will heal your current active character for (\d+)% of her ATK/, duration: { talent: "burst", label: "Duration" }, cd: { talent: "burst", label: "CD" } }],
  Ifa: { missing: "his Tonicshots heal while he's on-field in Nightsoul's Blessing; no duration in the tables" },
  Ineffa: [{ kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Jahoda: [{ kind: "heal", talent: "burst", value: "Purrsonal Coordinated Assistance Robot Healing", duration: "Purrsonal Coordinated Assistance Robot Duration", cd: "CD" }],
  Jean: { missing: "the Dandelion Field's duration isn't in genshin-db or the wiki's talent table" },
  Kirara: [{ kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  "Kuki Shinobu": [{ kind: "heal", talent: "skill", value: "Grass Ring of Sanctification Healing", duration: "Duration", cd: "CD" }],
  "Lan Yan": [{ kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Layla: [{ kind: "shield", talent: "skill", value: "Base Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Linnea: [{ kind: "heal", talent: "burst", value: "Continuous Healing", duration: "Healing Duration", cd: "CD" }],
  Mika: [{ kind: "heal", talent: "burst", value: "Eagleplume Healing", duration: "Eagleplume Duration", cd: "CD" }],
  Nicole: [{ kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Noelle: [{ kind: "shield", talent: "skill", value: "DMG Absorption", duration: "Duration", cd: "CD" }],
  Qiqi: [
    { kind: "heal", talent: "skill", value: "Continuous Regeneration", duration: "Duration", cd: "CD" },
    { kind: "heal", talent: "burst", value: "Healing", duration: "Duration", cd: "CD" },
  ],
  "Sangonomiya Kokomi": [
    { kind: "heal", talent: "skill", value: "Regeneration", duration: "Duration", cd: "CD" },
    { kind: "heal", talent: "burst", value: "HP Regeneration Per Hit", duration: "Duration", cd: "CD" },
  ],
  Sayu: [{ kind: "heal", talent: "burst", value: "Muji-Muji Daruma Healing", duration: "Duration", cd: "CD" }],
  Sigewinne: { missing: "Bolstering Bubblebalm heals per bounce; no duration in the tables" },
  Thoma: [
    { kind: "shield", talent: "skill", value: "Shield DMG Absorption", duration: "Shield Duration", cd: "CD" },
    { kind: "shield", talent: "burst", value: "Shield DMG Absorption", duration: "Scorching Ooyoroi Duration", cd: "CD" },
  ],
  Vodyanitsa: [{ kind: "heal", talent: "skill", value: "Song of Ages Past Healing", duration: "Duration", cd: "Skill CD" }],
  Xianyun: [{ kind: "heal", talent: "burst", value: "Continuous Healing", duration: "Duration", cd: "CD" }],
  Xilonen: [{ kind: "heal", talent: "burst", value: "Continuous Healing", duration: "Ebullient Rhythm Duration", cd: "CD" }],
  Xinyan: [{ kind: "shield", talent: "skill", value: "Shield Level 3 DMG Absorption", duration: "Shield Duration", cd: "CD" }],
  Yaoyao: [{ kind: "heal", talent: "skill", value: "White Jade Radish Healing", duration: "Yuegui: Throwing Mode Duration", cd: "CD" }],
  "Yumemizuki Mizuki": [{ kind: "heal", talent: "burst", value: "Snack Pick-Up HP Regeneration", duration: "Duration", cd: "CD" }],
  Zhongli: [{ kind: "shield", talent: "skill", value: ["Shield Base Absorption", "Additional Shield Absorption"], duration: "Shield Duration", cd: "Hold CD" }],
};

// A shield's or heal's size from table rows like "{p}% Max HP+{q}": { hp: p, flat: q } (a bare number is flat).
function sizeOf(attrs, labels, id) {
  const out = {};
  for (const label of [labels].flat()) {
    const entry = attrs.labels.find((l) => l.split("|")[0].trim() === label);
    if (!entry) throw new Error(`${id}: no talent label "${label}" (labels: ${attrs.labels.join("; ")})`);
    for (const [, key, words] of entry.slice(entry.indexOf("|") + 1).matchAll(/\{(param\d+):[^}]*\}\s*([^{+]*)/g)) {
      const stat = STAT_WORDS.find(([re]) => re.test(words.trim()))?.[1] ?? "flat";
      out[stat] = round((out[stat] ?? 0) + attrs.parameters[key][TALENT_LEVEL - 1]);
    }
  }
  return out;
}

function readSustain(id, spec) {
  if (spec.missing) return { effects: [], coverage: null, missing: spec.missing };
  const talents = talentsOf(id);
  const effects = spec.map((e) => {
    const attrsOf = (t) => talents[COMBAT[t]].attributes;
    const label = (x, t) => (typeof x === "string" ? tableValue(attrsOf(t), x, id) : tableValue(attrsOf(x.talent), x.label, id));
    if (e.from) {
      const text = talents[e.from].description.replace(/\s+/g, " ");
      const m = text.match(e.re);
      if (!m) throw new Error(`${id}: pattern ${e.re} not found in ${e.from}: ${text}`);
      // Escoffier's sentence holds the duration first, then the % of ATK; Iansan's only the %.
      const duration = e.duration ? label(e.duration) : Number(m[1]);
      const cd = label(e.cd);
      return { kind: e.kind, size: { atk: Number(m[m.length - 1]) / 100 }, source: `${e.from}: "${m[0]}"`, duration, cd, uptime: uptime(duration, cd) };
    }
    const duration = typeof e.duration === "number" ? e.duration : label(e.duration, e.talent) * (e.paws ?? 1);
    const cd = label(e.cd, e.talent);
    const values = [e.value].flat();
    return {
      kind: e.kind,
      size: sizeOf(attrsOf(e.talent), values, id),
      source: `${e.talent} talent ${values.map((v) => `"${v}"`).join(" + ")}, "${typeof e.duration === "string" ? e.duration : e.duration.label}"${e.paws ? ` x ${e.paws} Icy Paws (Hold)` : ""} / "${typeof e.cd === "string" ? e.cd : e.cd.label}", level ${TALENT_LEVEL}`,
      duration,
      cd,
      uptime: uptime(duration, cd),
    };
  });
  return { effects, coverage: round(1 - effects.reduce((a, e) => a * (1 - e.uptime), 1)) };
}

// Every healer and shielder needs a SUSTAIN entry, so a new one can't be missed.
const sustain = {};
for (const c of tags.filter((c) => c.roles.includes("healer") || c.roles.includes("shielder"))) {
  if (!SUSTAIN[c.id]) throw new Error(`${c.id} heals or shields in tags.json but has no SUSTAIN entry`);
  sustain[c.id] = readSustain(c.id, SUSTAIN[c.id]);
}
for (const id of Object.keys(SUSTAIN)) if (!sustain[id]) throw new Error(`SUSTAIN: ${id} isn't a healer or shielder in tags.json`);

const out = new URL("../data/kit.json", import.meta.url);
writeFileSync(
  out,
  JSON.stringify({ source: `genshin-db ${version}`, talentLevel: TALENT_LEVEL, baseStatsLevel: 90, characters, ascendantGleam, secretRite,
      nightsoulBurst: {
        // Seconds between Nightsoul Bursts by the number of Natlanese members; the top count means "or more".
        cooldownByNatlanese: nightsoulRule.cooldownSecondsByNatlanMembers,
        // Nightsoul characters who aren't Natlanese, so don't count toward triggering it.
        notNatlanese: ["Traveler (Pyro)"],
        source: nightsoulRule.source,
        characters: nightsoulBurst,
      },
      fightingSpirit,
      stellar,
      lunarBase,
      sets,
      benchmarkSets,
      holderStates,
      weapons,
      subDps,
      sustain,
      carries,
      carriesTodo }, null, 2) + "\n",
);
const missingCarryHits = Object.entries(carries).flatMap(([id, d]) => (d.missing ?? []).map((m) => `${id} ${m.split(" (")[0]}`));
if (missingCarryHits.length) console.log(`carry hits with no count yet (kit-overrides.json hitRates "carry: ..."): ${missingCarryHits.join(", ")}`);
const missingHits = Object.entries(subDps).flatMap(([id, d]) => (d.missing ?? []).map((m) => `${id} ${m.split(":")[0]}`));
if (missingHits.length) console.log(`sub-DPS hits with no rate yet (kit-overrides.json hitRates): ${missingHits.join(", ")}`);
const empty = Object.entries(OVERRIDES.characters).flatMap(([id, c]) => c.slots.filter((s) => !s.text.trim()).map((s) => `${id} ${s.talent || "(talent?)"}`));
const nightsoul = OVERRIDES.rules.nightsoulBurst.whoCanTrigger.trim() ? 0 : 1;
if (empty.length + nightsoul > 0) {
  console.log(`kit-overrides.json: ${empty.length + nightsoul} empty: ${[...empty, ...(nightsoul ? ["rules.nightsoulBurst"] : [])].join(", ")}`);
}
console.log(
  `Wrote ${Object.keys(characters).length} buffers (${Object.values(characters).filter((c) => c.missing).length} without a readable value), ${Object.keys(ascendantGleam).length} Ascendant Gleam upgrades, ${Object.keys(secretRite).length} Secret Rite effects, ${Object.keys(nightsoulBurst).length} Nightsoul Burst effects, ${Object.keys(stellar).length} Stellar members, ${Object.keys(subDps).length} sub-DPS, ${Object.keys(sustain).length} healers/shielders (${Object.values(sustain).filter((s) => s.missing).length} without a coverage), ${Object.keys(carries).length} carries (${carriesTodo.length} to do)`,
);
