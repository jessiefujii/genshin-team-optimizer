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
const sentences = (text) => text.split(/(?<=[.!?])\s+(?=[A-Z"])/);

const PARTY = /(party members?|all party|nearby (?:party )?characters?|active (?:party )?(?:characters?|members?)|characters within|characters protected|the team)/i;
const ROLE_RULES = {
  healer: (s) => /(heal|restor\w* HP|HP regeneration|regenerat\w* HP)/i.test(s) && PARTY.test(s),
  shielder: (s) => /\bshield\b/i.test(s) && !/shield DMG Absorption is increased/i.test(s),
  battery: (s) => /(Energy|Elemental Energy)/.test(s) && /(regenerat|restor|recover|gain)/i.test(s) && /party members?|active character/i.test(s),
  buffer: (s) =>
    (PARTY.test(s) && /(increas|boost|gain|grant)/i.test(s) && /(ATK|DMG Bonus|DMG|Elemental Mastery|CRIT|DEF|Max HP)\b/.test(s)) ||
    (/(decreas|reduc)/i.test(s) && /\b(RES|DEF)\b/.test(s) && /(opponent|enem)/i.test(s)),
};

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
        if (test(s)) (roleHits[role] ??= []).push(`${t.talent}: ${s.slice(0, 220)}`);
  const buffs = texts.flatMap((t) => sentences(t.text).filter((s) => ROLE_RULES.buffer(s)).map((s) => ({ talent: t.talent, text: s.slice(0, 260) })));

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
