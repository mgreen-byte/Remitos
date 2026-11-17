// Coordenadas a partir de links de Google Maps y kilómetros por ruta (OSRM, gratuito, sin clave).

const ok = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// Lee "lat,lng" de un texto: coordenadas sueltas o links largos de Maps (@lat,lng · !3dlat!4dlng · q=lat,lng · ll= · query= · /place/lat,lng).
export function coordsDeTexto(t) {
  const s = decodeURIComponent(String(t || "")).replace(/\+/g, " ");
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination|daddr|center)=\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\/(?:place|search|dir)\/[^/]*?(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = Number(String(m[1]).replace(",", ".")), lng = Number(String(m[2]).replace(",", "."));
      if (ok(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

// Coordenadas de un link (los cortos, maps.app.goo.gl, se abren en el servidor).
const cache = new Map();
export async function coordsDe(link) {
  if (!link) return null;
  const directo = coordsDeTexto(link);
  if (directo) return directo;
  if (cache.has(link)) return cache.get(link);
  let res = null;
  try {
    const r = await fetch(`/api/coords?u=${encodeURIComponent(link)}`);
    if (r.ok) { const j = await r.json(); if (j && ok(j.lat, j.lng)) res = { lat: j.lat, lng: j.lng }; }
  } catch { /* sin conexión: queda sin ubicación */ }
  cache.set(link, res);
  return res;
}

// Distancia en línea recta (km)
export function kmRecta(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Km por ruta de cada tramo entre puntos consecutivos. Si el servicio no responde: línea recta × 1,3 (estimado).
export async function kmTramos(puntos) {
  if (puntos.length < 2) return { tramos: [], estimado: false };
  try {
    const coords = puntos.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j.code === "Ok" && j.routes?.[0]?.legs?.length === puntos.length - 1) {
      return { tramos: j.routes[0].legs.map((l) => l.distance / 1000), estimado: false };
    }
  } catch { /* cae al estimado */ }
  const tramos = [];
  for (let i = 1; i < puntos.length; i++) tramos.push(kmRecta(puntos[i - 1], puntos[i]) * 1.3);
  return { tramos, estimado: true };
}

// Link de Google Maps con todo el recorrido (para mandar al transporte).
export function linkRecorrido(puntos) {
  if (!puntos.length) return "";
  return `https://www.google.com/maps/dir/${puntos.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("/")}`;
}
