// Link corto del recorrido: /r/AB12CD → redirige al link de Google Maps guardado (sin iniciar sesión).
export const dynamic = "force-dynamic";

const MAPS = /^https:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl\/)/i;

export async function GET(_req, { params }) {
  const codigo = String(params?.codigo || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  if (!codigo) return new Response("Link inválido", { status: 400 });
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/url_de_link`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_codigo: codigo }),
      cache: "no-store",
    });
    const url = await r.json();
    if (typeof url === "string" && MAPS.test(url)) return Response.redirect(url, 302);
  } catch { /* cae al 404 */ }
  return new Response("Este link de recorrido no existe o venció.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
