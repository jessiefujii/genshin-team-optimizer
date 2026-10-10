import { baseAtk } from "@/lib/build/base-atk";

// The build editor runs in the browser and genshin-db only on the server, so the editor asks here for a
// hand-typed build's base ATK (#80): /api/base-atk?character=Bennett&level=90&weapon=Sapwood%20Blade&weaponLevel=90
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const level = Number(q.get("level"));
  const weaponLevel = Number(q.get("weaponLevel"));
  const character = q.get("character");
  const weapon = q.get("weapon");
  if (!character || !weapon || !Number.isInteger(level) || !Number.isInteger(weaponLevel)) {
    return Response.json({ error: "Needs character, level, weapon and weaponLevel." }, { status: 400 });
  }
  const value = baseAtk(character, level, weapon, weaponLevel);
  if (value === undefined) return Response.json({ error: "genshin-db doesn't know that character or weapon." }, { status: 404 });
  return Response.json({ baseAtk: value });
}
