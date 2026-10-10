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
//   times: a multiplier from the text (Furina's Salon Members with 4 characters above 50% HP)
const SUBDPS = {
  Aino: [
    { talent: "skill", label: "Stage 1 DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Stage 2 DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Water Ball DMG", hits: "rate", cd: "CD" },
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
  Citlali: [
    { talent: "skill", label: "Obsidian Tzitzimitl DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Frostfall Storm DMG", hits: "rate", cd: "CD" }, // limited by her Nightsoul points (kit-overrides.json)
    { talent: "burst", label: "Ice Storm DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Spiritvessel Skull DMG", hits: 1, cd: "CD" },
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
    { talent: "burst", label: "Dragon of White Flame DMG", every: "rate", duration: "Dragon of White Flame Duration", cd: "CD" },
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
    })),
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Ineffa: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Birgitta Discharge DMG", every: "rate", duration: "Birgitta Duration", cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
  ],
  Jahoda: [
    { talent: "skill", label: "Filled Treasure Flask DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Purrsonal Coordinated Assistance Robot DMG", every: "rate", duration: "Purrsonal Coordinated Assistance Robot Duration", cd: "CD" },
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
  Nahida: [
    { talent: "skill", label: "Hold DMG", hits: 1, cd: "Seed of Skandha Duration" },
    { talent: "skill", label: "Tri-Karma Purification DMG", every: "Tri-Karma Purification Trigger Interval", duration: "Seed of Skandha Duration", cd: "Hold CD" },
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
  "Traveler (Dendro)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Lea Lotus Lamp Attack DMG", hits: "rate", cd: "CD" },
  ],
  "Traveler (Geo)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "DMG Per Shockwave", hits: "rate", cd: "CD" },
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
    const value = (v, rateKey) =>
      v === undefined ? undefined : v === "rate" ? rate[rateKey] : typeof v === "number" ? v : typeof v === "string" ? tableValue(attrs, v, id) : fromText(v);
    const every = s.perSecond ? 1 / fromText(s.perSecond) : value(s.every, "every");
    sources.push({
      talent: s.talent,
      label: s.label,
      scaling: scalingOf(attrs, s.label, id),
      ...(s.hits !== undefined ? { hits: value(s.hits, "hits") } : {}),
      ...(every !== undefined ? { every, duration: value(s.duration, "duration") } : {}),
      ...(s.onCarryNormal ? { onCarryNormal: true } : {}),
      ...(s.times ? { times: fromText(s.times) / (fromText(s.times) > 10 ? 100 : 1) } : {}),
      cd: tableValue(attrs, s.cd, id),
      ...(needsRate ? { rateSource: rate.source } : {}),
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
//     for buffs added per hit; default 1), count "rate" (kit-overrides.json hitRates, keyed "carry: <label>")
//   buffs: the carry's own buffs during those hits:
//     atkFromHp (Hu Tao), atkPct, dmgBonus (types), factor (types), addPerStack (+ATK multiplier per stack per hit
//     instance: Raiden's Resolve, Mavuika's Fighting Spirit), dmgBonusFromEr (Raiden), masque (Arlecchino),
//     flatAtk (+ATK multiplier x stacks per hit, capped, while one of `reactions` is active: Clorinde)
// The rotation lasts as long as the carry's Elemental Burst cooldown (Jessie's choice; sourced lengths: #103).
// Team-conditional effects (reactions, Nightsoul Bursts, Moonsign, teammates' elements) are left to the scorer.
const N = "normal", CH = "charged", PL = "plunge", SK = "skill", BU = "burst";
const CARRIES = {
  "Hu Tao": {
    // E, N2C x8, Q. Blood Blossom ticks every 4s for 8s ("Blood Blossom Duration").
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 8, type: N },
      { table: "normal", label: "2-Hit DMG", count: 8, type: N },
      { table: "normal", label: "Charged Attack", count: 8, type: CH },
      { table: "skill", label: "Blood Blossom DMG", count: 2, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    buffs: [{ kind: "atkFromHp", table: "skill", label: "ATK Increase", cap: /cannot exceed (\d+)% of Hu Tao's Base ATK/ }],
  },
  "Raiden Shogun": {
    // E, Q, N3C x3 in Musou Isshin (its Normal/Charged Attacks count as Elemental Burst DMG). The Eye's coordinated
    // attacks: one every 0.9s while she attacks during Musou Isshin's 7s. Resolve: 60, the max, assumed full.
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "skill", label: "Coordinated ATK DMG", count: 7, type: SK },
      { table: "burst", label: "Musou no Hitotachi Base DMG", count: 1, type: BU, resolve: "initial" },
      { table: "burst", label: "1-Hit DMG", count: 3, type: BU, resolve: "isshin" },
      { table: "burst", label: "2-Hit DMG", count: 3, type: BU, resolve: "isshin" },
      { table: "burst", label: "3-Hit DMG", count: 3, type: BU, resolve: "isshin" },
      { table: "burst", label: "Charged Attack DMG", count: 3, type: BU, resolve: "isshin", instances: 2 },
    ],
    buffs: [
      { kind: "addPerStack", table: "burst", label: "Resolve Bonus", pick: 0, stacks: /maximum number of Resolve stacks is (\d+)/, hits: "initial" },
      { kind: "addPerStack", table: "burst", label: "Resolve Bonus", pick: 1, stacks: /maximum number of Resolve stacks is (\d+)/, hits: "isshin" },
      { kind: "dmgBonusPerEnergy", table: "skill", label: "Elemental Burst DMG Bonus", types: [BU] }, // x her own Energy Cost
      { kind: "dmgBonusFromEr", from: "passive2", re: /([\d.]+)% Electro DMG Bonus/ }, // per 1% ER over 100%
    ],
  },
  Xiao: {
    // E, E, Q, plunge x10 (high plunges). Bane of All Evil's bonus; his passive 1 ramps 5% -> 25% over 15s (avg 15%).
    hits: [
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      { table: "normal", label: "Low/High Plunge DMG", pick: 1, count: 10, type: PL },
    ],
    buffs: [
      { kind: "dmgBonus", table: "burst", label: "Normal/Charged/Plunging Attack DMG Bonus", types: [N, CH, PL] },
      { kind: "dmgBonus", value: 0.15, types: [N, CH, PL, SK, BU], note: "passive 1: 5% + 5% per 3s up to 25% over the 15s Burst, about 15% on average" },
    ],
  },
  Wriothesley: {
    // E, N x8 (enhanced by Chilling Penalty), CA (Rebuke: Vaulting Fist, +50% DMG), Q.
    hits: [
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG", "5-Hit DMG"].map((label, i) => ({ table: "normal", label, count: i < 3 ? 2 : 1, type: N })),
      { table: "normal", label: "Charged Attack DMG", count: 1, type: CH },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Surging Blade DMG", count: 1, type: BU },
    ],
    buffs: [
      { kind: "factor", table: "skill", label: "Enhanced Repelling Fist DMG", types: [N] },
      { kind: "dmgBonus", from: "passive1", re: /will deal (\d+)% increased DMG/, types: [CH] },
      { kind: "atkPct", from: "passive2", re: /increase Wriothesley's ATK by (\d+)%/, times: /Max (\d+) stacks/ }, // full stacks
    ],
  },
  Varesa: {
    // E, plunge, E, plunge, Q, plunge, in Fiery Passion. Her passive 1 adds 180% ATK to the plunge after each Skill.
    hits: [
      { table: "skill", label: "Fiery Passion Rush DMG", count: 2, type: SK },
      { table: "normal", label: "Fiery Passion Low/High Plunge DMG", pick: 1, count: 3, type: PL },
      { from: "passive1", re: /Fiery Passion state, this ground impact DMG is increased by (\d+)% of her ATK/, count: 2, type: PL },
      { table: "burst", label: "Fiery Passion Flying Kick DMG", count: 1, type: BU },
    ],
    buffs: [],
  },
  Mavuika: {
    // E (hold: Flamestrider), Q (Sunfell Slice), N x10 on the Flamestrider. Fighting Spirit 200 (she Normal Attacks).
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU, fightingSpirit: "sunfell" },
      ...[1, 2, 3, 4, 5].map((n) => ({ table: "skill", label: `Flamestrider Normal Attack ${n}-Hit DMG`, count: 2, type: N, fightingSpirit: "na" })),
    ],
    buffs: [
      { kind: "addPerStack", table: "burst", label: "Sunfell Slice DMG Bonus", stacks: "Fighting Spirit Limit", hits: "sunfell" },
      { kind: "addPerStack", table: "burst", label: "Flamestrider Normal Attack DMG Bonus", stacks: "Fighting Spirit Limit", hits: "na" },
      // Passive 2: the active character (her too) deals up to 40% more DMG at 200 Fighting Spirit after her Burst.
      { kind: "dmgBonus", from: "passive2", re: /maximum increase obtainable this way is (\d+)%/, types: [SK, BU, N, CH, PL] },
    ],
  },
  Zibai: {
    // E, N4E x4 in Lunar Phase Shift: each a Normal Attack string and a Spirit Steed's Stride (4 per mode).
    hits: [
      ...[1, 2, 3, 4].map((n) => ({ table: "skill", label: `Lunar Phase Shift ${n}-Hit DMG`, count: 4, type: N })),
      { table: "skill", label: "Spirit Steed's Stride 1-Hit DMG", count: 4, type: SK },
      { table: "skill", label: "Spirit Steed's Stride 2-Hit DMG", count: 4, type: SK },
      { from: "passive1", re: /increased by (\d+)% of Zibai's DEF/, stat: "def", count: 1, type: SK }, // the first Stride, within 4s of the Skill
    ],
    buffs: [],
  },
  Skirk: {
    // E (Seven-Phase Flash), N5 x3 with its Normal Attacks, Q (Havoc: Extinction: no Void Rifts assumed).
    hits: [
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG", "5-Hit DMG"].map((label) => ({ table: "skill", label, count: 3, type: N })),
    ],
    buffs: [{ kind: "dmgBonus", table: "burst", label: "0/1/2/3 Void Rift Absorption DMG Bonus", pick: 0, types: [N], hitsCap: /canceled when it has triggered (\d+) times/ }],
  },
  Nefer: {
    // E, Phantasm Performance x3, E, Phantasm Performance x3, Q.
    hits: [
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      ...["1-Hit DMG (Nefer)", "2-Hit DMG (Nefer)", "1-Hit DMG (Shades)", "2-Hit DMG (Shades)", "3-Hit DMG (Shades)"].map((p) => ({ table: "skill", label: `Phantasm Performance ${p}`, count: 6, type: CH })),
      { table: "burst", label: "1-Hit DMG", count: 1, type: BU },
      { table: "burst", label: "2-Hit DMG", count: 1, type: BU },
    ],
    buffs: [],
  },
  Clorinde: {
    // E (Night Vigil), N x10 as Swift Hunt shots. Before her Burst her Bond of Life is under 100%, so the shots pierce
    // and deal increased DMG: the second "Swift Hunt DMG" value.
    hits: [
      { table: "skill", label: "Swift Hunt DMG", pick: 1, count: 10, type: N },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
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
    // E (Manifest Flame), E (Northland Spearstorm), Q (Thunderous Symphony within 6s of it). His tags list no Normal
    // Attacks, so this undercounts until the rotation is filled in (#103).
    hits: [
      { table: "skill", label: "Northland Spearstorm DMG", count: 1, type: SK },
      { table: "burst", label: "Thunderous Symphony DMG", count: 1, type: BU },
    ],
    buffs: [],
  },
  Arlecchino: {
    // E, CA (absorbs the Blood-Debt Directive: Bond of Life up to 145% of Max HP), N5 x3, Q.
    hits: [
      { table: "skill", label: "Spike DMG", count: 1, type: SK },
      { table: "skill", label: "Cleave DMG", count: 1, type: SK },
      { table: "normal", label: "Charged Attack DMG", count: 1, type: CH },
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG", "5-Hit DMG"].map((label) => ({ table: "normal", label, count: 3, type: N, instances: label === "4-Hit DMG" ? 2 : 1 })),
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
    ],
    // Masque of the Red Death: each Normal Attack hit adds ATK x the row's ratio x her Bond of Life %, and uses 7.5% of it.
    buffs: [{ kind: "masque", table: "normal", label: "Masque of the Red Death Increase", start: { from: "combat2", re: /within 35s after using her Elemental Skill is (\d+)% of her Max HP/ }, use: { from: "combat1", re: /This will consume ([\d.]+)% of said current Bond of Life/ } }],
  },
  Kinich: {
    // E, hold E swings x6 (Loop Shots), Q. Nightsoul points: 2 per second for 10s, 3 per Loop Shot, 4 from a Blind
    // Spot = 42, so 2 Scalespiker Cannons (20 points each, "Nightsoul Point Limit"). Worked out from his kit.
    hits: [
      { table: "skill", label: "Loop Shot DMG", count: 6, type: SK },
      { table: "skill", label: "Scalespiker Cannon DMG", count: 2, type: SK },
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Dragon Breath DMG", count: "rate", type: BU },
    ],
    buffs: [],
  },
  Neuvillette: {
    // Q, E, CA x2 (Equitable Judgment, 3s each).
    hits: [
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Waterfall DMG", count: 2, type: BU }, // "2 waterfalls will descend"
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "normal", label: "Charged Attack: Equitable Judgment", count: "rate", type: CH },
    ],
    buffs: [],
  },
  "Kamisato Ayaka": {
    // E, Q, dash, N2C x3. Passive 1: +30% Normal/Charged DMG after the Skill; passive 2: +18% Cryo DMG after the dash.
    hits: [
      { table: "skill", label: "Skill DMG", count: 1, type: SK },
      { table: "burst", label: "Cutting DMG", count: "rate", type: BU },
      { table: "burst", label: "Bloom DMG", count: 1, type: BU },
      { table: "normal", label: "1-Hit DMG", count: 3, type: N },
      { table: "normal", label: "2-Hit DMG", count: 3, type: N },
      { table: "normal", label: "Charged Attack DMG", count: 3, type: CH },
    ],
    buffs: [
      { kind: "dmgBonus", from: "passive1", re: /deal (\d+)% increased DMG for/, types: [N, CH] },
      { kind: "dmgBonus", from: "passive2", re: /Gains (\d+)% Cryo DMG Bonus/, types: [N, CH, SK, BU] },
    ],
  },
  Alhaitham: {
    // E, Q, N4 x3. Q with 3 Mirrors: "3-Mirror Attack Instances". Projections fire on his attacks with 3 Mirrors.
    hits: [
      { table: "skill", label: "Rush Attack DMG", count: 1, type: SK },
      { table: "burst", label: "Single-Instance DMG", count: { table: "burst", label: "3-Mirror Attack Instances" }, type: BU },
      ...["1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "4-Hit DMG"].map((label) => ({ table: "normal", label, count: 3, type: N })),
      { table: "skill", label: "3-Mirror Projection Attack DMG", count: "rate", type: SK },
    ],
    // Passive 2: +0.1% Projection and Burst DMG per EM, up to 100%.
    buffs: [{ kind: "dmgBonusPerEm", from: "passive2", re: /by ([\d.]+)%\. The DMG of both/, max: /maximum of (\d+)% this way/, types: [SK, BU], labels: ["3-Mirror Projection Attack DMG", "Single-Instance DMG"] }],
  },
};

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
  const missing = [];
  const hits = [];
  for (const h of spec.hits) {
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
    const scaling = h.from ? { [h.stat ?? "atk"]: num(h.from, h.re) / 100 } : scalingOf(tableAttrs(h.table), h.label, id, h.pick);
    hits.push({
      label: h.from ? `${h.from} bonus` : h.label,
      type: h.type,
      scaling,
      count,
      ...(h.instances ? { instances: h.instances } : {}),
      ...(h.resolve ? { tag: h.resolve } : h.fightingSpirit ? { tag: h.fightingSpirit } : {}),
    });
  }
  const raw = (t, label, pick = 0) => {
    const s = scalingOf(tableAttrs(t), label, id, pick);
    return Object.values(s)[0];
  };
  const buffs = spec.buffs.map((b) => {
    switch (b.kind) {
      case "atkFromHp":
        return { kind: b.kind, value: raw(b.table, b.label), capOfBase: num(COMBAT[b.table], b.cap) / 100 };
      case "addPerStack": {
        const stacks = typeof b.stacks === "string" ? tableValue(tableAttrs(b.table), b.stacks, id) : num(COMBAT[b.table], b.stacks);
        return { kind: b.kind, value: raw(b.table, b.label, b.pick), stacks, tag: b.hits };
      }
      case "dmgBonus": {
        const value = b.value ?? (b.from ? num(b.from, b.re) / 100 : raw(b.table, b.label, b.pick));
        const cap = b.hitsCap ? num(COMBAT[b.table], b.hitsCap) : undefined;
        return { kind: b.kind, value, types: b.types, ...(cap ? { hitsCap: cap } : {}), ...(b.note ? { note: b.note } : {}) };
      }
      case "factor":
        return { kind: b.kind, value: raw(b.table, b.label), types: b.types };
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
      default:
        throw new Error(`${id}: unknown carry buff ${b.kind}`);
    }
  });
  return { rotationSeconds: tableValue(tableAttrs("burst"), "CD", id), hits, buffs, ...(missing.length ? { missing } : {}) };
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

// Carries (#101): the 16 compare carries first; other main DPS are listed until they get an entry.
const carries = {};
for (const [id, spec] of Object.entries(CARRIES)) carries[id] = readCarry(id, spec);
const carriesTodo = tags.filter((c) => c.roles.includes("main-dps") && !CARRIES[c.id]).map((c) => c.id);

// Every off-field sub-DPS needs a SUBDPS entry, so none is silently left without damage.
const subDps = {};
for (const c of tags.filter((c) => c.roles.includes("sub-dps") && c.fieldTime === "off")) {
  if (!SUBDPS[c.id]) throw new Error(`${c.id} is an off-field sub-DPS in tags.json but has no SUBDPS entry`);
  subDps[c.id] = readSubDps(c.id, SUBDPS[c.id]);
}

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
      stellar,
      subDps,
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
  `Wrote ${Object.keys(characters).length} buffers (${Object.values(characters).filter((c) => c.missing).length} without a readable value), ${Object.keys(ascendantGleam).length} Ascendant Gleam upgrades, ${Object.keys(secretRite).length} Secret Rite effects, ${Object.keys(nightsoulBurst).length} Nightsoul Burst effects, ${Object.keys(stellar).length} Stellar members, ${Object.keys(subDps).length} sub-DPS, ${Object.keys(carries).length} carries (${carriesTodo.length} to do)`,
);
