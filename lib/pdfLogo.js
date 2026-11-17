// Logo de la empresa para los PDF (Stine Seed / MS Technologies).
const LOGOS = {
  ms: { url: "/logo-mst.png", ratio: 1626 / 384 },
  stine: { url: "/logo-color.png", ratio: 600 / 174 },
};

const cache = {};
async function cargar(url) {
  if (cache[url]) return cache[url];
  const r = await fetch(url);
  const blob = await r.blob();
  cache[url] = await new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = mal; fr.readAsDataURL(blob); });
  return cache[url];
}

// Dibuja el logo con alto fijo (mm) y devuelve el ancho usado (0 si no hay logo).
export async function dibujarLogo(doc, empresa, x, y, alto) {
  const l = LOGOS[empresa];
  if (!l) return 0;
  try {
    const img = await cargar(l.url);
    const w = Math.min(alto * l.ratio, 60);
    doc.addImage(img, "PNG", x, y, w, w / l.ratio, undefined, "FAST");
    return w;
  } catch { return 0; }
}
