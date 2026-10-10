import { baseAtk } from "@/lib/build/base-atk";

// The build editor runs in the browser and genshin-db only on the server, so the editor asks here for a
// hand-typed build's base ATK (#80): /api/base-atk?character=Bennett&level=90&weapon=Sapwood%20Blade&weaponLevel=90
// plus optional ascension and weaponAscension (phase 0-6, #82) for a level that can be before or after ascending.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const level = Number(q.get("level"));
  const weaponLevel = Number(q.get("weaponLevel"));
  const character = q.get("character");
  const weapon = q.get("weapon");
  if (!character || !weapon || !Number.isInteger(level) || !Number.isInteger(weaponLevel)) {
    return Response.json({ error: "Needs character, level, weapon and weaponLevel." }, { status: 400 });
  }
  // Optional; missing or not a phase = before ascending.
  const phase = (key: string) => {
    const n = Number(q.get(key) ?? NaN);
    return Number.isInteger(n) && n >= 0 && n <= 6 ? n : undefined;
  };
  const value = baseAtk(character, { level, ascension: phase("ascension") }, weapon, { level: weaponLevel, ascension: phase("weaponAscension") });
  if (value === undefined) return Response.json({ error: "genshin-db doesn't know that character or weapon." }, { status: 404 });
  return Response.json({ baseAtk: value });
}
