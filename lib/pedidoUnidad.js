// Pedido de unidad al transporte: datos, PDF y texto para WhatsApp / mail.
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";
import { norm } from "./util";

const domPlanta = (p) => { const d = String(p?.domicilio || "").trim(); const pr = String(p?.provincia || "").trim(); return d && pr && d.toUpperCase().includes(pr.toUpperCase()) ? d : [d, pr].filter(Boolean).join(", "); };
export const TIPOS_UNIDAD = ["Chasis", "Chasis y acoplado", "Semirremolque", "Batea", "Camioneta / utilitario"];
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: d });
const fmtF = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

// Destinos en orden de descarga: el último renglón de la orden es el primer destino.
// Toma lo pendiente (saldo); si no queda saldo, toma lo pedido.
export function armarDestinos(lineas, productos = []) {
  const hayPend = lineas.some((l) => Number(l.saldo) > 0);
  const ls = [...lineas]
    .filter((l) => !hayPend || Number(l.saldo) > 0)
    .map((l, i) => [l, i])
    .sort((a, b) => (a[0].posicion ?? 1e9) - (b[0].posicion ?? 1e9) || a[1] - b[1])
    .map((x) => x[0])
    .reverse();
  const m = new Map();
  for (const l of ls) {
    const k = `${norm(l.cliente)}||${norm(l.domicilio)}`;
    if (!m.has(k)) m.set(k, { cliente: l.cliente, domicilio: l.domicilio || "", localidad: l.localidad || "", provincia: l.provincia || "", entregar_en: l.entregar_en || "", gps: "", items: [] });
    const d = m.get(k);
    if (!d.gps && l.gps) d.gps = l.gps;
    const cant = hayPend ? Number(l.saldo) : Number(l.cantidad);
    const kgu = Number(productos.find((p) => p.id === l.producto_id)?.kg_por_unidad) || 0;
    const kg = Number(l.kilos) > 0 && Number(l.cantidad) > 0 ? (Number(l.kilos) * cant) / Number(l.cantidad) : cant * kgu;
    d.items.push({ producto: [l.producto_texto, l.presentacion].filter(Boolean).join(" · "), lote: l.lote_texto || "", ov: l.ov || "", cantidad: cant, kg });
  }
  return { destinos: [...m.values()], pendiente: hayPend };
}

export function textoPedido(p) {
  const L = [];
  L.push(`*PEDIDO DE UNIDAD · ${p.empresaNombre || ""}*`.replace(" · *", "*"));
  L.push(`Orden de carga: ${p.orden.numero}`);
  if (p.orden.fecha_carga) L.push(`Fecha de carga: ${fmtF(p.orden.fecha_carga)}`);
  L.push(`Tipo de unidad: ${p.tipoUnidad || "a definir"}`);
  L.push("");
  L.push(`*Carga en:* ${p.planta?.nombre || "—"}`);
  if (p.planta?.domicilio) L.push(`Domicilio: ${domPlanta(p.planta)}`);
  if (p.planta?.gps) L.push(`Ubicación: ${p.planta.gps}`);
  const cont = [p.planta?.contacto_nombre, p.planta?.contacto_telefono].filter(Boolean).join(" · ");
  if (cont) L.push(`Contacto: ${cont}`);
  if (p.planta?.horario_atencion) L.push(`Horario de atención: ${p.planta.horario_atencion}`);
  L.push("");
  p.destinos.forEach((d, i) => {
    L.push(`*Destino ${i + 1}:* ${d.cliente}`);
    L.push(`${[d.localidad, d.provincia].filter(Boolean).join(", ") || d.domicilio}${p.km.tramos[i] != null ? ` · ${fmt(p.km.tramos[i])} km` : ""}`);
    if (d.domicilio && d.localidad) L.push(`Dirección: ${d.domicilio}`);
    if (d.gps) L.push(`Ubicación: ${d.gps}`);
    d.items.forEach((it) => L.push(`- ${fmt(it.cantidad)} u. ${it.producto}${it.lote ? " · lote " + it.lote : ""}${it.kg ? ` (${fmt(it.kg)} kg)` : ""}`));
    L.push("");
  });
  L.push(`*Total:* ${fmt(p.totU)} u. · ${fmt(p.totKg)} kg`);
  if (p.km.total != null) L.push(`*Recorrido:* ${fmt(p.km.total)} km (solo ida, desde el depósito)${p.km.estimado ? " — estimado" : ""}${p.km.faltan ? ` — faltan ubicaciones de ${p.km.faltan} destino(s)` : ""}`);
  if (p.recorrido) L.push(`Ver recorrido: ${p.recorrido}`);
  if (p.obs) { L.push(""); L.push(`Observaciones: ${p.obs}`); }
  return L.join("\n");
}

export async function descargarPedidoPdf(p) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14;
  const VERDE = [22, 101, 52], GRIS = [110, 110, 110], NEGRO = [30, 30, 30];
  let y = M;
  const logoW = await dibujarLogo(doc, p.empresa, M, y - 2, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE);
  doc.text("Pedido de unidad", M + (logoW ? logoW + 6 : 0), y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...GRIS);
  doc.text(`Orden de carga ${p.orden.numero}`, M + (logoW ? logoW + 6 : 0), y + 11.5);
  y += 18;
  const salto = (h) => { if (y + h > H - 14) { doc.addPage(); y = M; } };
  const caja = (titulo, filas) => {
    const alto = 8 + filas.reduce((a, f) => a + 5 * Math.max(1, doc.splitTextToSize(String(f[1]), W - 2 * M - 46).length), 0);
    salto(alto + 3);
    doc.setFillColor(246, 248, 246); doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3);
    doc.roundedRect(M, y, W - 2 * M, alto, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE);
    doc.text(titulo.toUpperCase(), M + 4, y + 5.5);
    let yy = y + 11;
    for (const [et, v, link] of filas) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
      doc.text(et, M + 4, yy);
      doc.setFontSize(10); doc.setTextColor(...(link ? [20, 90, 160] : NEGRO));
      const ls = doc.splitTextToSize(String(v), W - 2 * M - 46);
      ls.forEach((t, i) => { doc.text(t, M + 42, yy + i * 5); if (link && i === 0) doc.link(M + 42, yy - 3.5, doc.getTextWidth(t), 5, { url: String(v) }); });
      yy += 5 * Math.max(1, ls.length);
    }
    y += alto + 4;
  };
  caja("Datos del viaje", [
    ["Fecha de carga", fmtF(p.orden.fecha_carga)],
    ["Tipo de unidad", p.tipoUnidad || "a definir"],
    ["Carga total", `${fmt(p.totU)} unidades · ${fmt(p.totKg)} kg`],
    ["Recorrido", p.km.total != null ? `${fmt(p.km.total)} km, solo ida desde el depósito${p.km.estimado ? " (estimado)" : ""}${p.km.faltan ? ` · faltan ubicaciones de ${p.km.faltan} destino(s)` : ""}` : "sin ubicaciones para calcular"],
    ...(p.recorrido ? [["Ver recorrido", p.recorrido, true]] : []),
    ...(p.obs ? [["Observaciones", p.obs]] : []),
  ]);
  const pl = p.planta || {};
  caja("Depósito de carga", [
    ["Depósito", pl.nombre || "—"],
    ["Domicilio", domPlanta(pl) || "—"],
    ...(pl.gps ? [["Ubicación", pl.gps, true]] : []),
    ["Contacto", [pl.contacto_nombre, pl.contacto_telefono].filter(Boolean).join(" · ") || "—"],
    ["Horario de atención", pl.horario_atencion || "—"],
  ]);
  // Destinos
  salto(12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE);
  doc.text("DESTINOS EN ORDEN DE DESCARGA", M, y + 3); y += 6;
  const cols = [["", 7], ["Producto", 74], ["Lote", 40], ["O/V", 22], ["Cant.", 15], ["Kg", 24]];
  p.destinos.forEach((d, i) => {
    salto(20 + d.items.length * 5);
    doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
    doc.text(`${i + 1}. ${d.cliente}`, M, y + 5);
    if (p.km.tramos[i] != null) { doc.setTextColor(...VERDE); doc.text(`${fmt(p.km.tramos[i])} km`, W - M, y + 5, { align: "right" }); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRIS);
    const dir = [d.domicilio, d.localidad && !String(d.domicilio).toUpperCase().includes(d.localidad) ? d.localidad : "", d.provincia].filter(Boolean).join(" · ");
    const dl = doc.splitTextToSize(dir || "—", W - 2 * M);
    doc.text(dl, M, y + 10); y += 10 + dl.length * 4;
    if (d.entregar_en) { doc.text(`Entregar en: ${d.entregar_en}`, M, y); y += 4.5; }
    if (d.gps) { doc.setTextColor(20, 90, 160); const t = doc.splitTextToSize(d.gps, W - 2 * M)[0]; doc.text(t, M, y); doc.link(M, y - 3.5, doc.getTextWidth(t), 5, { url: d.gps }); y += 4.5; }
    else { doc.setTextColor(180, 60, 40); doc.text("Sin ubicación de Maps", M, y); y += 4.5; }
    let x = M; doc.setFontSize(8); doc.setTextColor(...GRIS);
    cols.forEach(([t, w], k) => { doc.text(t, k >= 4 ? x + w - 1 : x, y + 2, k >= 4 ? { align: "right" } : undefined); x += w; });
    y += 4;
    doc.setFontSize(9.5); doc.setTextColor(...NEGRO);
    d.items.forEach((it) => {
      salto(6);
      x = M;
      const vals = ["", doc.splitTextToSize(it.producto, cols[1][1] - 2)[0], it.lote, it.ov, fmt(it.cantidad), it.kg ? fmt(it.kg) : "—"];
      vals.forEach((v, k) => { doc.text(String(v), k >= 4 ? x + cols[k][1] - 1 : x, y + 3, k >= 4 ? { align: "right" } : undefined); x += cols[k][1]; });
      y += 5;
    });
    y += 3;
  });
  doc.setDrawColor(205, 214, 207); doc.line(M, y, W - M, y);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
  doc.text(`Total: ${fmt(p.totU)} u. · ${fmt(p.totKg)} kg`, W - M, y + 6, { align: "right" });
  descargarBlob(doc.output("blob"), `pedido-unidad-${p.orden.numero}.pdf`);
}
