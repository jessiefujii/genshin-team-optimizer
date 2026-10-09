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
  Rosaria: { from: "passive2", values: [{ kind: "critRate", re: /cannot exceed (\d+)%/, unit: "CRIT Rate % (max)", percent: true }], duration: /for (\d+)s/, cd: { talent: "burst", label: "CD" } },
  Sigewinne: { from: "passive1", values: [{ kind: "flatDmg", re: /increases the DMG by (\d+)/, unit: "flat Skill DMG per 1,000 Max HP above 30,000", appliesTo: ["skill"] }] },
  Sucrose: { from: "passive2", values: [{ kind: "emFromEm", re: /equal to (\d+)% of Sucrose's Elemental Mastery/, unit: "of Sucrose's EM as EM", percent: true }], duration: /for (\d+)s/ },
  Xianyun: { from: "passive2", values: [{ kind: "flatDmgFromAtk", re: /increased by (\d+)% of Xianyun's ATK/, unit: "of Xianyun's ATK as flat Plunge DMG (max 9,000)", percent: true, appliesTo: ["plunge"], max: 9000 }] },
  Xinyan: { from: "passive2", values: [{ kind: "dmgBonus", re: /deal (\d+)% increased Physical DMG/, unit: "Physical DMG %", percent: true, physical: true }] },
  Yelan: { from: "passive2", values: [{ kind: "dmgBonus", re: /maximum increase to DMG dealt is (\d+)%/, unit: "active character DMG %, averaged over the ramp from 1% to the max", percent: true, scale: 0.5 }] },
  Zhongli: { from: "combat2", values: [{ kind: "resShred", re: /Elemental RES and Physical RES of opponents in a small AoE by (\d+)%/, unit: "all RES", percent: true }], duration: "Shield Duration", cd: "Hold CD", table: "skill" },
};

// Buffs we know about but can't read a number for: the value isn't in the text genshin-db gives.
const NO_VALUE = {
  Ifa: "Rescue Essentials' per-point bonus isn't stated in the passive text",
  Prune: "Tolling Rally's bonus isn't stated in the passive text",
};

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

const round = (n) => (n === null || n === undefined ? n : Math.round(n * 10000) / 10000);
const uptime = (duration, cd) => (duration && cd ? round(Math.min(1, duration / cd)) : null);

function readBuffs(id, spec) {
  const talents = genshindb.talents(id);
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
    return {
      kind: v.kind,
      value: steps ? steps.values[steps.values.length - 1] : round((Number(m[1]) / (v.percent ? 100 : 1)) * (v.scale ?? 1)),
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
  const text = genshindb.talents(id)[spec.from].description.replace(/\s+/g, " ");
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
  characters[c.id] = { base, buffs: readBuffs(c.id, SPEC[c.id]) };
}

// Every Moonsign character with an Ascendant Gleam upgrade needs a GLEAM entry, so a new one can't be missed.
const ascendantGleam = {};
for (const c of tags.filter((c) => (c.families ?? []).includes("moonsign"))) {
  const t = genshindb.talents(c.id);
  const has = t && ["combat1", "combat2", "combat3", "passive1", "passive2", "passive3"].some((k) => t[k]?.description.includes("Ascendant Gleam"));
  if (has && !GLEAM[c.id]) throw new Error(`${c.id} has an Ascendant Gleam upgrade but no GLEAM entry`);
  if (GLEAM[c.id]) ascendantGleam[c.id] = readGleam(c.id, GLEAM[c.id]);
}

const out = new URL("../data/kit.json", import.meta.url);
writeFileSync(
  out,
  JSON.stringify({ source: `genshin-db ${version}`, talentLevel: TALENT_LEVEL, baseStatsLevel: 90, characters, ascendantGleam }, null, 2) + "\n",
);
console.log(
  `Wrote ${Object.keys(characters).length} buffers (${Object.values(characters).filter((c) => c.missing).length} without a readable value), ${Object.keys(ascendantGleam).length} Ascendant Gleam upgrades`,
);
