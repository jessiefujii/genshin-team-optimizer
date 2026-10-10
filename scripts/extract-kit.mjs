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
// condition: the value depends on the team (fightingSpirit: Mavuika, scaled in src/lib/scoring/kit.ts)
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
    values: [{ kind: "dmgBonus", label: "Fanfare to DMG Increase Conversion Ratio", times: "Maximum Fanfare", unit: "DMG % at max Fanfare" }],
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
  Shenhe: { talent: "skill", values: [{ kind: "flatDmgFromAtk", label: "DMG Bonus", unit: "of Shenhe's ATK as flat Cryo DMG", elements: ["Cryo"] }], duration: "Press/Hold Duration", cd: "Press CD" },
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

function readBuffs(id, spec) {
  const talents = talentsOf(id);
  if (!talents) throw new Error(`${id}: no talent data in genshin-db`);
  if (spec.talent) {
    const attrs = talents[COMBAT[spec.talent]].attributes;
    const duration = spec.duration ? tableValue(attrs, spec.duration, id) : null;
    const cd = spec.cd ? tableValue(attrs, spec.cd, id) : null;
    return spec.values.map((v) => ({
      kind: v.kind,
      value: round(tableValue(attrs, v.label, id) * (v.times ? tableValue(attrs, v.times, id) : 1)),
      ...(v.cap ? { max: tableValue(attrs, v.cap, id) } : {}),
      ...limits(v),
      unit: v.unit,
      source: `${spec.talent} talent "${v.label}"${v.times ? ` x "${v.times}"` : ""}, level ${TALENT_LEVEL}`,
      duration,
      cd,
      uptime: uptime(duration, cd),
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
    return {
      kind: v.kind,
      value: steps ? steps.values[steps.values.length - 1] : round((Number(m[1]) / (v.percent ? 100 : 1)) * (v.scale ?? 1)),
      ...(points ? { points } : {}),
      ...(excess ? { threshold: excess.threshold, max: excess.max } : {}),
      ...(steps ? { steps } : {}),
      ...(v.max ? { max: v.max } : {}),
      ...(v.perHp ? { perHp: v.perHp } : {}),
      ...limits(v),
      unit: v.unit,
      source: `${from}: "${m[0]}"`,
      duration,
      cd,
      uptime: uptime(duration, cd),
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
//   target "self", no kind: an upgrade to the carry's own kit (Kinich, Mualani, Chasca), scored like Secret Rite
//   duration / max stacks: how long each stack lasts and how many can be up; no duration = one-off (Chasca's shot)
//   target "own": a support's effect on their own stats or resources; recorded, not scored (sub-DPS damage is
//   Phase 3, resources are the energy check's job)
const NIGHTSOUL_BURST = {
  Chasca: { from: "passive2", target: "self" },
  Citlali: { from: "passive2", target: "own", note: "regains Nightsoul points" },
  Iansan: { from: "passive2", target: "own", note: "Warming Up (her own resource)" },
  Ifa: { from: "passive2", target: "own", note: "his own EM" },
  Kachina: { from: "passive1", target: "own", note: "her own Geo DMG" },
  Kinich: { from: "passive2", target: "self", duration: /lasts (\d+)s/, max: /Max (\d+) stacks/ },
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
    source,
  };
}

// Stellar Glimmer: Radiance (#63). A Stellar member enters Radiance: Stellar-Conduct inside a Polestar Field
// (made when Stellar-Conduct is triggered) and Radiance: Stellar Swirl for 8s after a Stellar Swirl, so a
// Radiance is on when the team has that reaction. What it does is in each kit:
//   target "self": an upgrade to that character's own kit (Sandrone, Vesna, Wriothesley), scored when they carry
//   target "party": buffs that reach the carry (Alyosha, Qiqi, Vodyanitsa), read like SECRET_RITE values; each
//     value's `radiance` is the Radiance it needs, and uptime comes from table labels or a cd sentence
//   target "own": Radiance only changes that support's own damage (sub-DPS damage is Phase 3); recorded, not scored
//   target "none": no Radiance text to read (yet); the character only enables or uses the reactions
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
  Cyno: { target: "none", note: "no Radiance text in genshin-db or kit-overrides.json" },
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
  "Yumemizuki Mizuki": { target: "none", note: "no Radiance text in genshin-db or kit-overrides.json" },
};

function readStellar(id, spec) {
  if (spec.target === "none") return { target: "none", radiance: [], note: spec.note };
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

const tags = require("../data/tags.json");
const buffers = tags.filter((c) => c.roles.includes("buffer") && (c.buffs ?? []).length > 0);
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

// Every Stellar member needs a STELLAR entry, so a new one (or new Radiance text) can't be missed.
const stellar = {};
for (const c of tags.filter((c) => (c.families ?? []).includes("stellar"))) {
  if (!STELLAR[c.id]) throw new Error(`${c.id} is Stellar in tags.json but has no STELLAR entry`);
  stellar[c.id] = readStellar(c.id, STELLAR[c.id]);
}

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
      stellar }, null, 2) + "\n",
);
const empty = Object.entries(OVERRIDES.characters).flatMap(([id, c]) => c.slots.filter((s) => !s.text.trim()).map((s) => `${id} ${s.talent || "(talent?)"}`));
const nightsoul = OVERRIDES.rules.nightsoulBurst.whoCanTrigger.trim() ? 0 : 1;
if (empty.length + nightsoul > 0) {
  console.log(`kit-overrides.json: ${empty.length + nightsoul} empty: ${[...empty, ...(nightsoul ? ["rules.nightsoulBurst"] : [])].join(", ")}`);
}
console.log(
  `Wrote ${Object.keys(characters).length} buffers (${Object.values(characters).filter((c) => c.missing).length} without a readable value), ${Object.keys(ascendantGleam).length} Ascendant Gleam upgrades, ${Object.keys(secretRite).length} Secret Rite effects, ${Object.keys(nightsoulBurst).length} Nightsoul Burst effects, ${Object.keys(stellar).length} Stellar members`,
);
