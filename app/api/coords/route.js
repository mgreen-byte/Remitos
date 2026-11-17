// Abre un link de Google Maps (también los cortos maps.app.goo.gl) y devuelve sus coordenadas.
// Solo sigue links de dominios de Google, para no usarse como proxy de cualquier sitio.
import { coordsDeTexto } from "@/lib/rutas";

export const dynamic = "force-dynamic";

const PERMITIDO = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;

export async function GET(req) {
  const u = new URL(req.url).searchParams.get("u") || "";
  let url;
  try { url = new URL(u); } catch { return Response.json({ error: "link inválido" }, { status: 400 }); }
  for (let i = 0; i < 6; i++) {
    if (!/^https?:$/.test(url.protocol) || !PERMITIDO.test(url.hostname)) return Response.json({ error: "solo links de Google Maps" }, { status: 400 });
    const c = coordsDeTexto(url.href);
    if (c) return Response.json(c, { headers: { "cache-control": "public, max-age=86400" } });
    let r;
    try {
      r = await fetch(url.href, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0", "accept-language": "es-AR" } });
    } catch { return Response.json({ error: "no se pudo abrir el link" }, { status: 502 }); }
    const sig = r.headers.get("location");
    if (sig && r.status >= 300 && r.status < 400) {
      url = new URL(sig, url);
      // La página de consentimiento trae el destino real en "continue"
      const cont = url.searchParams.get("continue");
      if (cont && /consent\./i.test(url.hostname)) url = new URL(cont);
      continue;
    }
    const html = (await r.text()).slice(0, 400000);
    const m = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/) || html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) || html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return Response.json({ lat, lng }, { headers: { "cache-control": "public, max-age=86400" } });
    }
    break;
  }
  return Response.json({ error: "no encontré coordenadas en el link" }, { status: 404 });
}
