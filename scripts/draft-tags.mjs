// Drafts tags.json's reactions, support roles and party buffs from each character's kit text (#178, design doc Phase 3:
// "Draft roles, reactions and conditions from the kit text, reviewed"), and writes the differences to
// data/tags-draft.json for Jessie to review. It never changes tags.json: what she accepts is applied by hand.
//
// Kit text: genshin-db talents (Normal Attack, Skill, Burst, passives; constellations left out: scored at C0).
// - reactions: every reaction the character's element takes part in (scoring/reactions.ts REQUIREMENTS, Lunar and
//   Stellar included), when their talents deal that element's DMG. The scorer still needs the team's elements, and a
//   converter for Lunar and Stellar ones (canTrigger), before any of them is active.
// - roles: healer (restores HP to party members or the active character), shielder (creates a shield), battery (gives
//   party members Energy), buffer (raises party members' or the active character's ATK, DMG, EM, CRIT, DEF or HP, or
//   lowers opponents' RES or DEF). DPS roles come from the wiki (npm run roles); enabler isn't drafted.
// - buffs: each sentence of a party buff, with its talent: what tags.json `buffs` could hold.
// Usage: npm run draft-tags
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const genshindb = require("genshin-db");
const tags = JSON.parse(readFileSync(new URL("../data/tags.json", import.meta.url), "utf8"));

// scoring/reactions.ts REQUIREMENTS: the elements each reaction needs (all, plus one of anyOf).
const AURA = ["Pyro", "Hydro", "Electro", "Cryo"];
const REACTIONS = {
  vaporize: ["Pyro", "Hydro"],
  melt: ["Pyro", "Cryo"],
  freeze: ["Hydro", "Cryo"],
  superconduct: ["Electro", "Cryo"],
  electrocharged: ["Electro", "Hydro"],
  overloaded: ["Pyro", "Electro"],
  burning: ["Pyro", "Dendro"],
  bloom: ["Dendro", "Hydro"],
  hyperbloom: ["Dendro", "Hydro", "Electro"],
  burgeon: ["Dendro", "Hydro", "Pyro"],
  quicken: ["Dendro", "Electro"],
  aggravate: ["Dendro", "Electro"],
  spread: ["Dendro", "Electro"],
  swirl: ["Anemo", ...AURA],
  crystallize: ["Geo", ...AURA],
  "lunar-charged": ["Electro", "Hydro"],
  "lunar-bloom": ["Dendro", "Hydro"],
  "lunar-crystallize": ["Geo", "Hydro"],
  "stellar-conduct": ["Electro", "Cryo"],
  "stellar-swirl": ["Anemo", "Cryo"],
};
// Swirl and Crystallize take the aura elements as the other side only: a Pyro character "takes part" in a Swirl only
// as the aura, which the Anemo member triggers. So those two count for their trigger element alone.
const takesPart = (r, element) => (r === "swirl" || r === "crystallize" ? REACTIONS[r][0] === element : REACTIONS[r].includes(element));

const TALENTS = ["combat1", "combat2", "combat3", "passive1", "passive2", "passive3", "passive4"];
const TALENT_NAME = { combat1: "normal", combat2: "skill", combat3: "burst", passive1: "passive1", passive2: "passive2", passive3: "passive3", passive4: "passive4" };
const dbIdOf = (id) => (id.startsWith("Traveler (") ? "Lumine" : id);
const elementOf = (id) => (id.startsWith("Traveler (") ? id.slice("Traveler (".length, -1) : genshindb.characters(dbIdOf(id))?.elementText);
function textsOf(id) {
  // Travelers' talents are per element in genshin-db: "Lumine (Anemo)" style names.
  const t = id.startsWith("Traveler (") ? genshindb.talents(`Lumine (${elementOf(id)})`) : genshindb.talents(id);
  if (!t) return null;
  return TALENTS.filter((k) => t[k]?.description).map((k) => ({ talent: TALENT_NAME[k], name: t[k].name, text: t[k].description.replace(/\s+/g, " ") }));
}
// Sentences, with each "·" bullet its own sentence behind the clause that introduces it: the clause names who
// receives ("she will grant all nearby party members the following effects: · Press: ... DMG increased"), the bullet
// what (#178: Chasca's passive 1 read as one sentence mixed her teammates, the condition, with her own DMG).
const sentences = (text) =>
  text.split(/(?<=[.!?])\s+(?=[A-Z"])/).flatMap((s) => {
    const [lead, ...bullets] = s.split(/\s*·\s*/);
    // The bullet first, so the effect shows before the (long) clause it hangs from.
    return bullets.length ? [lead, ...bullets.map((b) => (lead ? `${b} [${lead}]` : b))].filter(Boolean) : [s];
  });

const PARTY = /(party members?|all party|all characters|nearby (?:party )?characters?|active (?:party |team )?(?:characters?|members?)|team members?|connected character|characters? within|characters protected|characters who|(?:these|those) characters|the team)/i;
// A reaction's DMG raised for others is a party buff even when the character is named (Baizhu: "increase the Burning,
// Bloom, Hyperbloom, and Burgeon reaction DMG dealt by these characters", from his Max HP; Jessie, 2026-10-24).
const REACTION_DMG =
  /\b(Burning|Bloom|Hyperbloom|Burgeon|Lunar-\w+|Swirl|Stellar[- ]\w+|Electro-Charged|Overloaded|Superconduct|Aggravate|Spread|Vaporize|Melt|Crystallize|Quicken)\b[^.]{0,80}?\bDMG\b/;
const ROLE_RULES = {
  // Healing worded many ways (#178 review: "their health will continuously regenerate", "regenerates the HP of
  // characters", "Continuously restore HP" for the connected character, "triggers healing on an active team member").
  healer: (s) =>
    /(heal|restor\w*(?: \w+){0,2} (?:HP|health)|HP regeneration|regenerat\w*(?: \w+){0,2} (?:HP|health)|health will (?:continuously )?regenerate)/i.test(s) &&
    PARTY.test(s),
  shielder: (s) => /\bshield\b/i.test(s) && !/shield DMG Absorption is increased/i.test(s),
  battery: (s) => /(Energy|Elemental Energy)/.test(s) && /(regenerat|restor|recover|gain)/i.test(s) && /party members?|active character/i.test(s),
  buffer: (s) =>
    (PARTY.test(s) && /(increas|boost|gain|grant)/i.test(s) && /(ATK|DMG Bonus|DMG|Elemental Mastery|CRIT|DEF|Max HP)\b/.test(s)) ||
    (/(decreas|reduc)/i.test(s) && /\b(RES|DEF)\b/.test(s) && /(opponent|enem)/i.test(s)) ||
    (PARTY.test(s) && /(increas|boost)/i.test(s) && REACTION_DMG.test(s)),
};

// A self buff names the party only as its condition ("Baizhu gains ... according to the current HP of your current
// active character"): the character's own name, or her/his, gains or is increased, and no party member or active
// character receives anything. Not a party buff, so neither the buffer role nor a buff entry.
// A receiver is the party or the active character as what gains, never as the trigger ("when nearby party members
// trigger a Nightsoul Burst, Mavuika's ATK increases").
const RECEIVER = new RegExp(
  [
    "party members?(?:'|'s)? (?:will )?(?:gain|have|receive)",
    "party members?(?:'|'s) [^.]{0,40}?(?:is|are|will be) (?:increased|boosted)",
    "(?:all|nearby|other nearby) party members(?! trigger| hit| create| deal| use)",
    "active (?:party )?(?:character|member)s?(?:'s)? [^.]{0,50}?(?:is|are|will be) (?:increased|boosted)",
    "(?:increas|boost)\\w* (?:the )?[^.]{0,40}?of (?:all |your |the )?(?:nearby |current )?(?:active|party)",
    "grant\\w* [^.]{0,40}?(?:party|active)",
    "(?:this|that) character's",
    "characters? who [^.]{0,60}?(?:gain|will gain|receive)",
    "(?:reaction )?DMG dealt by (?:these|those|nearby|party|all|other)",
    "characters? (?:within|protected)[^.]{0,60}?(?:gain|increas|have)",
  ].join("|"),
  "i",
);
const namesOf = (id) => [...new Set([id, ...id.split(" ")].filter((n) => n.length > 2 && !n.startsWith("(")))];
function selfBuff(s, id) {
  const alts = namesOf(id).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const self = new RegExp(
    `\\b(?:${alts})(?:'s)?\\s+(?:will\\s+)?(?:gain|gains|obtain|obtains|receive|receives)\\b` +
      `|\\bgrants?\\s+(?:${alts})\\b` +
      `|\\b(?:${alts})'s\\s+[^.]{0,60}?\\b(?:(?:is|are|will be)\\s+(?:increased|boosted)|increases|will increase)` +
      `|\\b(?:her|his)\\s+(?:own\\s+)?[^.]{0,40}?\\b(?:is|are|will be)\\s+increased` +
      `|\\bincreas\\w*\\s+(?:her|his|(?:${alts})'s)\\b` +
      `|\\b(?:dealt by|DMG)\\s+(?:${alts})(?:'s)?\\s+(?:deals|Normal|Charged|Elemental|Plunging)`,
    "i",
  );
  return self.test(s) && !RECEIVER.test(s);
}
// A buff sentence's mark key in the review page: its talent and a hash of its text, stable when the list changes.
const keyOf = (talent, text) => {
  let h = 5381;
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `buff:${talent}:${h.toString(36)}`;
};

// Battery from particles too (Jessie, 2026-10-24: a battery "can be one like bennett with a short skill cooldown that
// can be switched to another characters so that they can get the energy particles produced"). data/particles.json:
// Skill particles per use and cooldown (wiki Energy/Data); `timing` cast (on the Skill) or field (made off-field over
// its duration), `flat` Energy given straight to others. A main DPS's particles mostly feed themselves.
const PARTICLES = JSON.parse(readFileSync(new URL("../data/particles.json", import.meta.url), "utf8")).characters;
const SWAP_RATE = 0.4; // particles a second on cast: Bennett's 2.25 per 5s is 0.45
const FIELD_RATE = 0.25; // off-field: Fischl's Oz ~6.4 per 25s is 0.26
function batteryEvidence(c) {
  const p = PARTICLES[c.id];
  if (!p) return [];
  const out = [];
  for (const f of p.flat ?? []) if (f.to !== "self") out.push(`particles.json: ${f.energy} Energy to ${f.to} (${f.note})`);
  if (p.perUse && p.cd && !c.roles.includes("main-dps")) {
    const rate = p.perUse / p.cd;
    if ((p.timing === "field" && rate >= FIELD_RATE) || (p.timing !== "field" && rate >= SWAP_RATE))
      out.push(`particles.json: Skill ${p.perUse} particles per ${p.cd}s (${rate.toFixed(2)}/s, ${p.timing === "field" ? "off-field" : "on cast, swap to catch"})`);
  }
  return out;
}

// Buffer from the set a character wears (Jessie, 2026-10-24: "some buffers are because of the artifact sets a character
// uses"): their benchmark set (kit.json benchmarkSets, KQM's picks) with a party-wide effect in kit.json sets.
const KIT = JSON.parse(readFileSync(new URL("../data/kit.json", import.meta.url), "utf8"));
const PARTY_SET = new Set(Object.entries(KIT.sets).filter(([, effects]) => effects.some((e) => e.party)).map(([name]) => name));
const setEvidence = (id) =>
  [...new Set((KIT.benchmarkSets[id] ?? []).map((o) => o.set).filter((s) => PARTY_SET.has(s)))].map((s) => `benchmark set: 4pc ${s} (party-wide)`);

const draft = {};
let changed = 0;
for (const c of tags) {
  const element = elementOf(c.id);
  const texts = textsOf(c.id);
  if (!element || !texts) {
    draft[c.id] = { note: "no genshin-db kit text" };
    continue;
  }
  const all = texts.map((t) => t.text).join(" ");
  const appliesElement = new RegExp(`${element} DMG`).test(all);
  const reactions = appliesElement ? Object.keys(REACTIONS).filter((r) => takesPart(r, element)) : [];
  const roleHits = {};
  for (const t of texts)
    for (const s of sentences(t.text))
      for (const [role, test] of Object.entries(ROLE_RULES))
        if (test(s) && !(role === "buffer" && selfBuff(s, c.id))) (roleHits[role] ??= []).push(`${t.talent}: ${s}`);
  const fromParticles = batteryEvidence(c);
  if (fromParticles.length) (roleHits.battery ??= []).unshift(...fromParticles);
  const fromSets = setEvidence(c.id);
  if (fromSets.length) (roleHits.buffer ??= []).push(...fromSets);
  const buffs = texts.flatMap((t) =>
    sentences(t.text)
      .filter((s) => ROLE_RULES.buffer(s) && !selfBuff(s, c.id))
      .map((s) => ({ key: keyOf(t.talent, s), talent: t.talent, text: s })),
  );

  const entry = {};
  const addR = reactions.filter((r) => !c.reactions.includes(r));
  const dropR = c.reactions.filter((r) => !reactions.includes(r));
  if (addR.length || dropR.length) entry.reactions = { element, appliesElement, add: addR, remove: dropR };
  const support = ["healer", "shielder", "battery", "buffer"];
  const addRoles = support.filter((r) => roleHits[r] && !c.roles.includes(r)).map((r) => ({ role: r, because: roleHits[r].slice(0, 2) }));
  // Tagged but not found in the text: more likely the patterns missing it (or a constellation's) than a wrong tag.
  const notInText = support.filter((r) => !roleHits[r] && c.roles.includes(r));
  if (addRoles.length || notInText.length) entry.roles = { add: addRoles, notInText };
  const tagged = new Set((c.buffs ?? []).map((b) => b.talent));
  const untagged = buffs.filter((b) => !tagged.has(b.talent));
  if (untagged.length) entry.buffsNotInTags = untagged;
  // The whole text of each talent an item cites (#178 review: sentences alone can hide their context).
  const cited = new Set([...(entry.roles?.add ?? []).flatMap((r) => r.because.map((b) => b.split(":")[0])), ...(entry.buffsNotInTags ?? []).map((b) => b.talent)]);
  if (cited.size) entry.talents = Object.fromEntries(texts.filter((t) => cited.has(t.talent)).map((t) => [t.talent, { name: t.name, text: t.text }]));
  if (Object.keys(entry).length) {
    draft[c.id] = entry;
    changed++;
  }
}
writeFileSync(new URL("../data/tags-draft.json", import.meta.url), JSON.stringify(draft, null, 2) + "\n");
const count = (k, f) => Object.values(draft).reduce((a, e) => a + (e[k] ? f(e[k]) : 0), 0);
console.log(
  `tags-draft.json: ${changed} of ${tags.length} characters differ; reactions +${count("reactions", (r) => r.add.length)} ` +
    `-${count("reactions", (r) => r.remove.length)}; roles +${count("roles", (r) => r.add.length)}, ${count("roles", (r) => r.notInText.length)} not found in text; ` +
    `party buffs not in tags: ${count("buffsNotInTags", (b) => b.length)}`,
);
