import { fetchEnkaProfile, parseUid } from "@/lib/enka/fetch";

// Proxy for Enka.Network: the browser calls this instead of Enka, so every request carries our
// User-Agent and repeat imports come from the cache.
export async function GET(_req: Request, ctx: RouteContext<"/api/enka/[uid]">) {
  const uid = parseUid((await ctx.params).uid);
  if (!uid) {
    return Response.json({ error: "A UID is 9 or 10 digits." }, { status: 400 });
  }

  const result = await fetchEnkaProfile(uid);
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: result.status });
  }
  return Response.json({ ...result.data, fetchedAt: result.fetchedAt });
}
