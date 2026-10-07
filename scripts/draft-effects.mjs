// Drafts data/effects.json from genshin-db item text: weapon passives, artifact set bonuses, and the
// constellations of every character in data/tags.json. Run with `node scripts/draft-effects.mjs`.
//
// Only team-relevant effects become entries: buffs for the party or the active character, RES shred,
// Energy for the party (battery), and infusions. Every drafted entry's notes start with 'VERIFY:'.
// Re-running replaces VERIFY entries with fresh drafts and keeps every other entry as it is, so
// remove 'VERIFY:' from an entry once you have checked or edited it.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const genshindb = require("genshin-db");
const OUT = new URL("../data/effects.json", import.meta.url);
const TAGS = new URL("../data/tags.json", import.meta.url);

const ELEMENTS = ["Pyro", "Hydro", "Electro", "Cryo", "Anemo", "Geo", "Dendro"];
const names = (fn) => [...new Set(fn("names", { matchCategories: true }))];

// Who a sentence's effect reaches. null = the holder only (or no one we can tell).
function scopeOf(sentence) {
  if (/active character|character (?:taking|on) the field|new character|characters? (?:inside|within)/i.test(sentence)) {
    return "active";
  }
  if (/(?:all|nearby|other)(?: nearby)? party members|all party members|party members (?:within|in|nearby)|entire party|all characters in the party/i.test(sentence)) {
    return "team";
  }
  return null;
}

const elementsIn = (s) => ELEMENTS.filter((el) => new RegExp(`\\b${el}\\b`).test(s));

// One sentence → the buffs, roles and infusion it describes. `carried` is the scope of an earlier
// sentence that handed the party a named effect ("all party members obtain X. X increases ATK...").
function classify(sentence, carried) {
  const out = { buffs: [], roles: [], infusion: undefined };
  const scope = scopeOf(sentence) ?? carried;

  // Energy for the party, or particles (which go to the whole party).
  if (/Elemental Particles?|Energy (?:to|for) (?:all|nearby|other)|party members?[^.]*(?:regenerat|restor)\w* [\d.]+ Energy/i.test(sentence)) {
    out.roles.push("battery");
  }

  // RES shred on opponents reaches everyone who hits them.
  // "decreases ... Pyro RES" or "Pyro RES ... decreased"
  const shred =
    sentence.match(/(?:decreas|reduc)\w*[^.]*?\b(?:(Physical|Elemental|All Elemental|Pyro|Hydro|Electro|Cryo|Anemo|Geo|Dendro) )?RES\b/i) ??
    sentence.match(/\b(?:(Physical|Elemental|Pyro|Hydro|Electro|Cryo|Anemo|Geo|Dendro) )?RES\b(?: \w+){0,3}? (?:decreased|reduced)/i);
  if (shred && shred[1] !== "Physical") {
    const swirl = /Swirl/i.test(sentence) && /infused|absorbed/i.test(sentence);
    const els = swirl ? [] : elementsIn(sentence);
    out.buffs.push({
      stat: `${swirl ? "Swirled element" : els.length ? els.join("/") : "Elemental"} RES shred`,
      scope: "team",
      ...(els.length ? { elements: els } : {}),
      ...(swirl ? { reactions: ["swirl"] } : {}),
    });
  }

  const infused = sentence.match(new RegExp(`infused with (${ELEMENTS.join("|")})|(${ELEMENTS.join("|")}) infusion`));
  if (infused && scope) out.infusion = infused[1] ?? infused[2];

  // Every stat the sentence raises, e.g. Elegy's "increases Elemental Mastery by 100 and ATK by 20%".
  if (scope && /increase|gain|grant|bonus|\+\d/i.test(sentence)) {
    if (/Elemental Mastery/.test(sentence)) out.buffs.push({ stat: "Elemental Mastery", scope, affects: "EM" });
    if (/\bATK\b(?! SPD)/.test(sentence)) out.buffs.push({ stat: "ATK", scope, affects: "ATK" });
    if (/Max HP|\bHP\b (?:is )?increased/.test(sentence)) out.buffs.push({ stat: "Max HP", scope, affects: "HP" });
    if (/\bDEF\b/.test(sentence) && !/DEF (?:ignore|decrease|reduc)/i.test(sentence)) {
      out.buffs.push({ stat: "DEF", scope, affects: "DEF" });
    }
    if (/CRIT/.test(sentence)) out.buffs.push({ stat: "CRIT", scope });
    if (/Energy Recharge/.test(sentence)) out.buffs.push({ stat: "Energy Recharge", scope });
    if (/DMG/.test(sentence.replace(/CRIT DMG/g, ""))) {
      const els = elementsIn(sentence.replace(/infused with \w+/, ""));
      out.buffs.push({ stat: els.length ? `${els.join("/")} DMG Bonus` : "DMG Bonus", scope, ...(els.length ? { elements: els } : {}) });
    }
  }
  return out;
}

// All sentences of one effect text → an entry, or null if nothing team-relevant was found.
function draft(base, text) {
  const merged = { buffs: [], roles: new Set(), infusion: undefined, evidence: [] };
  let carried = null;
  for (const sentence of text.replace(/\s+/g, " ").split(/(?<=\.)\s+/)) {
    const found = classify(sentence, carried);
    // A party-wide sentence carries over until the text turns back to the holder.
    if (/equipping character|wielder|the character (?:using|equipping)|this character/i.test(sentence)) carried = null;
    else carried = scopeOf(sentence) ?? carried;
    if (found.buffs.length || found.roles.length || found.infusion) merged.evidence.push(sentence.trim());
    merged.buffs.push(...found.buffs);
    found.roles.forEach((r) => merged.roles.add(r));
    merged.infusion ??= found.infusion;
  }
  if (!merged.evidence.length) return null;
  // One buff per stat and scope is enough for the scorer.
  const seen = new Set();
  const buffs = merged.buffs.filter((b) => !seen.has(b.stat + b.scope) && seen.add(b.stat + b.scope));
  const quote = merged.evidence.join(" ");
  return {
    ...base,
    ...(buffs.length ? { buffs } : {}),
    ...(merged.roles.size ? { roles: [...merged.roles] } : {}),
    ...(merged.infusion ? { infusion: merged.infusion } : {}),
    notes: `VERIFY: drafted from text: "${quote.length > 220 ? quote.slice(0, 217) + "..." : quote}"`,
  };
}

const drafts = [];
for (const name of names(genshindb.weapons)) {
  const w = genshindb.weapons(name);
  if (!w || w.rarity < 3 || !w.r1) continue;
  const entry = draft({ source: "weapon", id: w.name, name: w.effectName }, w.r1.description);
  if (entry) drafts.push(entry);
}
for (const name of names(genshindb.artifacts)) {
  const a = genshindb.artifacts(name);
  for (const pieces of [2, 4]) {
    const text = a?.[`effect${pieces}Pc`];
    const entry = text && draft({ source: "set", id: a.name, requires: pieces }, text);
    if (entry) drafts.push(entry);
  }
}
for (const { id } of JSON.parse(readFileSync(TAGS, "utf8"))) {
  const cons = genshindb.constellations(id);
  if (!cons) continue;
  for (let level = 1; level <= 6; level++) {
    const c = cons[`c${level}`];
    const entry = c && draft({ source: "constellation", id, requires: level, name: c.name }, c.description);
    if (entry) drafts.push(entry);
  }
}

// Keep checked entries (no VERIFY); replace drafts.
let existing = [];
try {
  existing = JSON.parse(readFileSync(OUT, "utf8"));
} catch {
  // first run
}
const key = (e) => `${e.source}|${e.id}|${e.requires ?? ""}`;
const kept = existing.filter((e) => !e.notes?.startsWith("VERIFY:"));
const keptKeys = new Set(kept.map(key));
const ORDER = { weapon: 0, set: 1, constellation: 2 };
const all = [...kept, ...drafts.filter((d) => !keptKeys.has(key(d)))].sort(
  (a, b) => ORDER[a.source] - ORDER[b.source] || a.id.localeCompare(b.id) || (a.requires ?? 0) - (b.requires ?? 0),
);

writeFileSync(OUT, JSON.stringify(all, null, 2) + "\n");
const count = (s) => all.filter((e) => e.source === s).length;
console.log(
  `Wrote ${all.length} effects (${count("weapon")} weapons, ${count("set")} set bonuses, ${count("constellation")} constellations); ${kept.length} checked entries kept`,
);
