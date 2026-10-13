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
    // Skill + Burst + 1 Spiritvessel Skull (one opponent) = 51, enough for Opal Fire (50+), which burns them all. Her
    // passive 1 adds 16 after a Melt or Frozen while Itzpapa is out, at most once every 8s: once, since Mavuika's Pyro
    // melts with her Cryo. Passive 2: 4 per party Nightsoul Burst, once per rotation (one Nightsoul Burst, as for
    // Ororon) (#126; the wiki research there put the 16 on her C4, but genshin-db's passive 1 text has it, so it stays).
    Citlali: {
      parts: [
        { from: "combat2", re: /Citlali gains (\d+) Nightsoul points/ },
        { talent: "burst", label: "Ice Storm Nightsoul Point Gain" },
        { talent: "burst", label: "Spiritvessel Skull Nightsoul Point Gain" },
        { from: "passive1", re: /Citlali will regain (\d+) Nightsoul points/ },
        { from: "passive2", re: /when nearby party members trigger Nightsoul Bursts, Citlali regains (\d+) Nightsoul points/ },
      ],
      note: "Skill + Burst + 1 Skull + passive 1 once (Melt with Mavuika) + passive 2 once (one Nightsoul Burst)",
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
  return { points: round(points), ...(fromTeammates ? { fromTeammates } : {}), ...(cap ? { cap } : {}), note: spec.note, source: sources.join("; ") };
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
//   (per character, SUBDPS_LUNAR_BASE below) lunarBaseBonus: { stat, perPoint, max, reactions }: their own Moonsign
//       Benediction's Base DMG bonus to their direct Lunar hits of those reactions
//   passive: { from, re, stat } the multiplier comes from a passive's text instead of the `label` row (`name` then
//       names the source; `label` still keys its hit rate and table values)
//   when: the source only hits under that condition ({ ascendantGleam: true }, like a carry hit's `when`)
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
  Chongyun: [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Skill DMG", hits: /summons (\d+) giant spirit blades/, cd: "CD" },
  ],
  Citlali: [
    { talent: "skill", label: "Obsidian Tzitzimitl DMG", hits: 1, cd: "CD" },
    { talent: "skill", label: "Frostfall Storm DMG", hits: "rate", cd: "CD" }, // limited by her Nightsoul points (kit-overrides.json)
    { talent: "burst", label: "Ice Storm DMG", hits: 1, cd: "CD" },
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
  "Traveler (Dendro)": [
    { talent: "skill", label: "Skill DMG", hits: 1, cd: "CD" },
    { talent: "burst", label: "Lea Lotus Lamp Attack DMG", hits: "rate", cd: "CD" },
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
    const passiveText = s.passive && talents[s.passive.from].description.replace(/\s+/g, " ");
    const passiveValue = s.passive && Number(passiveText.match(s.passive.re)?.[1]);
    if (s.passive && !passiveValue) throw new Error(`${id}: pattern ${s.passive.re} not found in ${s.passive.from}`);
    sources.push({
      talent: s.talent,
      label: s.name ?? s.label,
      scaling: s.passive ? { [s.passive.stat]: passiveValue / 100 } : scalingOf(attrs, s.label, id),
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
//     reacting (how many of `count` trigger the combo's amplifying reaction, where the source says; damage.ts uses
//     its flat estimate for hits without it), lunar (the hit is direct Lunar reaction DMG of that reaction, #135),
//     when (the hit only lands with { reaction } active and/or at { ascendantGleam: true })
//   combo: the default combo in KQM notation, the one `hits` model and the rotation tags in data/tags.json follow
//   combos (#114): other sourced combos, for the teams they fit. damage.ts takes the first whose `when` matches the
//   team being scored, else the default. Each has combo, hits (the whole rotation, in the format above), buffs (only
//   when they differ from the default's) and when: a list of alternatives, each { reaction (one of the team's active
//   reactions; amplifying ones then multiply this combo's hits), members (a list of id lists: a teammate from each),
//   elements (exact number of teammates of that element) }. Picking a combo by whether its Energy needs are met
//   waits on particle energy (#37).
//   buffs: the carry's own buffs during those hits:
//     atkFromHp (Hu Tao), atkPct, dmgBonus (types), factor (types), addPerStack (+ATK multiplier per stack per hit
//     instance: Raiden's Resolve, Mavuika's Fighting Spirit), dmgBonusFromEr (Raiden), masque (Arlecchino),
//     flatAtk (+ATK multiplier x stacks per hit, capped, while one of `reactions` is active: Clorinde),
//     emFromAtk (EM from a share of ATK, capped: Flins), lunarBaseBonus (their Moonsign Benediction's Base DMG bonus
//     to their Lunar reaction per point of a stat, capped: it also applies to their own direct Lunar hits, #135),
//     lunarReactionBonus (Reaction DMG Bonus to their direct hits of that Lunar reaction: Flins), baseDmgMultiplier
//     (labels: Nefer's Veil of Falsehood), emBonus. A buff's `when` ({ reaction, ascendantGleam }) gates it like a hit's.
//   A hit's `additive` marks a Reaction Additive Base DMG Bonus to a Lunar hit (Zibai's passive 1, #146).
//   missing: parts of the rotation not modeled yet, so the damage is too low (none left since #135)
// The rotation lasts as long as the carry's Elemental Burst cooldown (Jessie's choice; sourced lengths: #103).
// Team-conditional effects (reactions, Nightsoul Bursts, Moonsign, teammates' elements) are left to the scorer, except
// hits that only exist with them (`when`).
const N = "normal", CH = "charged", PL = "plunge", SK = "skill", BU = "burst";
// Mavuika's combos (#114) differ only in their Flamestrider Charged Attacks: E, Q (Sunfell Slice), then Cyclic/Final.
// These are her Melt and Vaporize combos, and Sunfell Slice reacts in them (#121, web research 2026-10-13: KQM's
// Mavuika quick guide has the Burst hit melt/vaporize, about a third of her damage), so `reacting: 1`.
const mavuikaHits = ({ cyclic, cyclicReacting, final = 0, finalReacting }) => [
  { table: "skill", label: "Skill DMG", count: 1, type: SK },
  { table: "burst", label: "Skill DMG", count: 1, reacting: 1, type: BU, fightingSpirit: "sunfell" },
  { table: "skill", label: "Flamestrider Charged Attack Cyclic DMG", count: cyclic, reacting: cyclicReacting, type: CH, fightingSpirit: "ca" },
  ...(final ? [{ table: "skill", label: "Flamestrider Charged Attack Final DMG", count: final, reacting: finalReacting, type: CH, fightingSpirit: "ca" }] : []),
];
const CARRIES = {
  "Hu Tao": {
    // E, N2C x7, Q every other rotation. KeqingMains quick guide (fetched 2026-10-12): N2C is "optimal for most Hu Tao
    // teams", "around 7N2CJ" at C0; Burst "every other rotation", since building Energy for it each rotation costs
    // damage. Blood Blossom ticks every 4s for 8s ("Blood Blossom Duration").
    hits: [
      { table: "normal", label: "1-Hit DMG", count: 7, type: N },
      { table: "normal", label: "2-Hit DMG", count: 7, type: N },
      { table: "normal", label: "Charged Attack", count: 7, type: CH },
      { table: "skill", label: "Blood Blossom DMG", count: 2, type: SK },
      { table: "burst", label: "Skill DMG", count: 0.5, type: BU },
    ],
    buffs: [
      { kind: "atkFromHp", table: "skill", label: "ATK Increase", cap: /cannot exceed (\d+)% of Hu Tao's Base ATK/ },
      // Passive 2: +33% Pyro DMG at 50% HP or less; KQM: keep her "below 50% HP to maximize her damage".
      { kind: "dmgBonus", from: "passive2", re: /Pyro DMG Bonus is increased by (\d+)%/, types: [N, CH, PL, SK, BU] },
    ],
  },
  "Raiden Shogun": {
    // E, Q, 3[N3C] N1C in Musou Isshin (its Normal/Charged Attacks count as Elemental Burst DMG): one of KeqingMains'
    // quick guide combos (fetched 2026-10-12). The Eye's coordinated attacks: one every 0.9s while she attacks during
    // Musou Isshin's 7s. Resolve: 60, the max (KQM: "quite common to reach maximum Resolve stacks").
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
        when: [{ reaction: "stellar-conduct" }],
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
      { table: "skill", label: "Spirit Steed's Stride 1-Hit DMG", count: 4, type: SK },
      { table: "skill", label: "Spirit Steed's Stride 2-Hit DMG", count: 4, type: SK, lunar: "lunar-crystallize" },
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
    // KeqingMains quick guide (fetched 2026-10-12): "Neuvillette can perform 2–4 Charged Attacks per rotation"; its
    // 3-CA rotation, "Q > Team > C E C > Team > C E", is "Easier for managing buff and ability uptimes" (the 4-CA one,
    // for teams where he deals most of the damage, is #119). So Q, E x2, CA x3 (Equitable Judgment, 3s each).
    hits: [
      { table: "burst", label: "Skill DMG", count: 1, type: BU },
      { table: "burst", label: "Waterfall DMG", count: 2, type: BU }, // "2 waterfalls will descend"
      { table: "skill", label: "Skill DMG", count: 2, type: SK },
      { table: "normal", label: "Charged Attack: Equitable Judgment", count: "rate", type: CH },
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
  const missing = [...(spec.missing ?? [])];
  const readHits = (list) => {
    const hits = [];
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
      const scaling = h.from ? { [h.stat ?? "atk"]: num(h.from, h.re) / 100 } : scalingOf(tableAttrs(h.table), h.label, id, h.pick);
      hits.push({
        label: h.from ? `${h.from} bonus` : h.label,
        type: h.type,
        scaling,
        count,
        ...(h.instances ? { instances: h.instances } : {}),
        ...(h.reacting !== undefined ? { reacting: h.reacting } : {}),
        ...(h.lunar ? { lunar: h.lunar } : {}),
        ...(h.additive ? { additive: true } : {}),
        ...(h.when ? { when: h.when } : {}),
        ...(h.resolve ? { tag: h.resolve } : h.fightingSpirit ? { tag: h.fightingSpirit } : {}),
      });
    }
    return hits;
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
        const stacks = typeof b.stacks === "string" ? tableValue(tableAttrs(b.table), b.stacks, id) : num(COMBAT[b.table], b.stacks);
        return { kind: b.kind, value: raw(b.table, b.label, b.pick), stacks, tag: b.hits, ...(b.fightingSpirit ? { fightingSpirit: true } : {}) };
      }
      case "dmgBonus": {
        const value = b.value ?? (b.from ? num(b.from, b.re) / 100 : raw(b.table, b.label, b.pick));
        const cap = typeof b.hitsCap === "number" ? b.hitsCap : b.hitsCap ? num(COMBAT[b.table], b.hitsCap) : undefined;
        return { kind: b.kind, value, types: b.types, ...(cap ? { hitsCap: cap } : {}), ...(b.note ? { note: b.note } : {}), ...(b.fightingSpirit ? { fightingSpirit: true } : {}) };
      }
      case "factor":
        return { kind: b.kind, value: raw(b.table, b.label), types: b.types };
      case "factorByReactions": {
        const m = text(b.from).match(b.re);
        if (!m) throw new Error(`${id}: pattern ${b.re} not found in ${b.from}`);
        return { kind: b.kind, values: m.slice(1).map((v) => Number(v) / 100), types: b.types, reactions: b.reactions };
      }
      case "dmgBonusFromHp": {
        const value = Math.min(num(b.from, b.max), num(b.from, b.per) * (b.hp * 100 - num(b.from, b.above))) / 100;
        return { kind: "dmgBonus", value: round(value), types: b.types, note: `${b.from} at ${b.hp * 100}% HP` };
      }
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
        return { kind: b.kind, value: num(b.from, b.re) / 100, reaction: b.reaction, ...(b.when ? { when: b.when } : {}) };
      case "baseDmgMultiplier":
        return { kind: b.kind, value: round(b.value), labels: b.labels, ...(b.when ? { when: b.when } : {}) };
      case "emBonus":
        return { kind: b.kind, value: num(b.from, b.re), ...(b.when ? { when: b.when } : {}) };
      default:
        throw new Error(`${id}: unknown carry buff ${b.kind}`);
    }
  };
  const hits = readHits(spec.hits);
  const buffs = spec.buffs.map(readBuff);
  if (spec.combos && !spec.combo) throw new Error(`${id}: a carry with combos needs its default combo's notation (combo)`);
  const combos = (spec.combos ?? []).map((k) => {
    if (!k.combo || !k.when?.length) throw new Error(`${id}: each combo needs combo and when`);
    return { combo: k.combo, when: k.when, hits: readHits(k.hits), ...(k.buffs ? { buffs: k.buffs.map(readBuff) } : {}) };
  });
  return {
    rotationSeconds: tableValue(tableAttrs("burst"), "CD", id),
    ...(spec.combo ? { combo: spec.combo } : {}),
    hits,
    buffs,
    ...(combos.length ? { combos } : {}),
    ...(missing.length ? { missing } : {}),
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

// Mavuika's Fighting Spirit (#116): the Nightsoul points each Nightsoul member gives her per rotation.
const fightingSpirit = readFightingSpirit(tags.filter((c) => (c.families ?? []).includes("nightsoul")).map((c) => c.id));

// Carries (#101): the 16 compare carries first; other main DPS are listed until they get an entry.
const carries = {};
for (const [id, spec] of Object.entries(CARRIES)) carries[id] = readCarry(id, spec);
const carriesTodo = tags.filter((c) => c.roles.includes("main-dps") && !CARRIES[c.id]).map((c) => c.id);

// Every off-field sub-DPS needs a SUBDPS entry, so none is silently left without damage. Entries for supports whose
// in-game roles aren't DPS (#105: Citlali, Lauma) stay: their hits still deal damage.
for (const c of tags.filter((c) => c.roles.includes("sub-dps") && c.fieldTime === "off")) {
  if (!SUBDPS[c.id]) throw new Error(`${c.id} is an off-field sub-DPS in tags.json but has no SUBDPS entry`);
}
// A sub-DPS's own Moonsign Benediction Base DMG bonus to their direct Lunar hits (Jessie, 2026-10-12, PR #155), read
// like a carry's lunarBaseBonus: per `per` points of `stat`, capped. Teammates' bonuses to them stay with #88.
// Columbina's is for every Lunar reaction "inflicted by party members", so her own hits too.
const SUBDPS_LUNAR_BASE = {
  Ineffa: {
    from: "passive3",
    re: /every 100 ATK that Ineffa has increasing Lunar-Charged's Base DMG by ([\d.]+)%/,
    per: 100,
    stat: "atk",
    max: /maximum of (\d+)%/,
    reactions: ["lunar-charged"],
  },
  Columbina: {
    from: "passive3",
    re: /For every 1,000 points of Max HP, the Base DMG of Lunar reactions is increased by ([\d.]+)%/,
    per: 1000,
    stat: "hp",
    max: /maximum of (\d+)%/,
    reactions: ["lunar-charged", "lunar-bloom", "lunar-crystallize"],
  },
};
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
  const b = SUBDPS_LUNAR_BASE[id];
  if (!b) continue;
  const text = genshindb.talents(id)[b.from].description.replace(/\s+/g, " ");
  const read = (re) => {
    const m = text.match(re);
    if (!m) throw new Error(`${id}: pattern ${re} not found in ${b.from}`);
    return Number(m[1]);
  };
  subDps[id].lunarBaseBonus = { stat: b.stat, perPoint: round(read(b.re) / 100 / b.per), max: read(b.max) / 100, reactions: b.reactions };
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
      fightingSpirit,
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
