// Reads each character's in-game Character Roles (#105) from the Genshin Impact Wiki infobox into
// data/wiki-roles.json: where they fight (On-Field / Off-Field) and what they do (DPS, Support, Survivability).
// Then sets the matching tags in data/tags.json, so scoring takes them from the game, not guides:
//   DPS + On-Field: main-dps; DPS + Off-Field: sub-dps (both when both); no DPS: neither
//   fieldTime: on / off, or flex with both
// The finer support roles (buffer, battery, enabler, healer, shielder) stay hand-written: the wiki only says
// Support or Survivability. Network: run by hand with `npm run roles` when characters are added; both JSONs are
// committed.
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://genshin-impact.fandom.com/api.php";
const tags = JSON.parse(readFileSync(new URL("../data/tags.json", import.meta.url), "utf8"));
// Roles changed from the wiki's by Jessie's decision (data/role-overrides.json): `add` wiki roles (Traveler (Cryo)
// on-field, #136), `drop` tags.json roles (Lan Yan not a main DPS, #216).
const overrides = JSON.parse(readFileSync(new URL("../data/role-overrides.json", import.meta.url), "utf8")).characters;

// The wiki page for a tags.json id: the same name ("Traveler (Anemo)" too).
const pageOf = (id) => id.replace(/ /g, "_");

async function rolesOf(id) {
  const page = pageOf(id);
  const res = await fetch(`${API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&redirects=1`);
  const json = await res.json();
  const html = json.parse?.text?.["*"];
  if (!html) throw new Error(`${id}: no wiki page ${page} (${json.error?.info ?? res.status})`);
  // The infobox shows each role as an icon: <img alt="Character Role Off-Field" ...>.
  const roles = [...new Set([...html.matchAll(/alt="Character Role ([^"]+)"/g)].map((m) => m[1]))];
  if (roles.length === 0) throw new Error(`${id}: no Character Roles in the infobox of ${page}`);
  return { roles, source: `https://genshin-impact.fandom.com/wiki/${page}` };
}

const out = {};
const failed = [];
for (const c of tags) {
  try {
    out[c.id] = await rolesOf(c.id);
  } catch (e) {
    failed.push(e.message);
  }
}
writeFileSync(
  new URL("../data/wiki-roles.json", import.meta.url),
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), characters: out }, null, 2) + "\n",
);
console.log(`Wrote ${Object.keys(out).length} characters' roles`);

// Apply them to tags.json.
const changed = [];
for (const c of tags) {
  const wikiRoles = out[c.id]?.roles;
  if (!wikiRoles) continue; // no roles on the wiki: keep the hand tags
  const roles = [...wikiRoles, ...(overrides[c.id]?.add ?? [])];
  const on = roles.includes("On-Field");
  const off = roles.includes("Off-Field");
  const dps = roles.includes("DPS");
  const dropped = overrides[c.id]?.drop ?? [];
  const want = [...(dps && on ? ["main-dps"] : []), ...(dps && off ? ["sub-dps"] : [])].filter((r) => !dropped.includes(r));
  const dpsRole = (r) => r === "main-dps" || r === "sub-dps";
  const kept = c.roles.filter((r) => !dpsRole(r) || want.includes(r)); // keeps the existing order
  const nextRoles = [...want.filter((r) => !kept.includes(r)), ...kept];
  const fieldTime = on && off ? "flex" : on ? "on" : "off";
  const before = `${c.roles.join(", ")} / ${c.fieldTime}`;
  if (nextRoles.join() !== c.roles.join() || fieldTime !== c.fieldTime) {
    c.roles = nextRoles;
    c.fieldTime = fieldTime;
    changed.push(`${c.id}: ${before} -> ${c.roles.join(", ")} / ${c.fieldTime}`);
  }
}
writeFileSync(new URL("../data/tags.json", import.meta.url), JSON.stringify(tags, null, 2) + "\n");
if (changed.length) console.log(`tags.json: ${changed.length} changed\n${changed.join("\n")}`);
if (failed.length) console.log(`No roles for ${failed.length}:\n${failed.join("\n")}`);
