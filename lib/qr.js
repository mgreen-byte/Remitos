// Código QR del link de ubicación (Google Maps). Se genera en el navegador, sin servicios externos.
import qrcode from "./qrcodeGen";

// Zona libre del remito preimpreso (mm sobre A4): esquina inferior izquierda, a la izquierda de las firmas.
// No pisa la tabla, así que se conservan los 15 renglones. (Alternativa medida: esquina superior derecha, left 186 / top 6.)
export const QR_COORDS = { left: 15, top: 252, size: 20 };
export const QR_LEYENDA = ["UBICACIÓN", "DE DESCARGA"]; // debajo del QR

const DOMINIOS = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+\/maps)(\/|\?|$)/i;

// Devuelve un link de Maps válido o "" (acepta también coordenadas "-38.7,-62.3" y links sin https://).
export function normalizarGps(v) {
  let t = String(v ?? "").trim();
  if (!t || t === "0" || t === "-") return "";
  const coord = t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (coord) return `https://www.google.com/maps?q=${coord[1].replace(",", ".")},${coord[2].replace(",", ".")}`;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  t = t.replace(/\s+/g, "");
  return DOMINIOS.test(t) && t.length <= 500 ? t : "";
}

// Módulos del QR como path de SVG (un cuadradito por módulo oscuro) en una grilla de n x n.
export function qrPath(texto) {
  const qr = qrcode(0, "M");
  qr.addData(String(texto));
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { n, d, isDark: (r, c) => qr.isDark(r, c) };
}

// Link de ubicación de un remito ya emitido: el de la línea de orden de carga de sus renglones
// (el remito se trae con remito_items(*, linea:ordenes_carga_lineas(gps))).
export function gpsDeRemito(r) {
  // Traslado entre plantas: la ubicación es la de la planta de destino.
  if (r?.tipo === "traslado") return normalizarGps(r?.destino?.gps);
  for (const it of r?.remito_items || []) {
    const g = normalizarGps(it?.linea?.gps);
    if (g) return g;
  }
  return "";
}
