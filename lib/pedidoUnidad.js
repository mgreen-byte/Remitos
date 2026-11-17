// Pedido de unidad al transporte: datos, PDF y texto para WhatsApp / mail.
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";
import { norm } from "./util";

const domPlanta = (p) => { const d = String(p?.domicilio || "").trim(); const pr = String(p?.provincia || "").trim(); return d && pr && d.toUpperCase().includes(pr.toUpperCase()) ? d : [d, pr].filter(Boolean).join(", "); };
export const TIPOS_UNIDAD = [
  "Batea",
  "Batea escalable",
  "Bitren T1 - 60 Tn",
  "Bitren T2 - 75 Tn",
  "Camilla",
  "Camioneta 1-500 kg",
  "Carreton",
  "Chasis",
  "Chasis balancin",
  "Chasis/Acop",
  "Chasis/Acop escalable",
  "Chasis/Acop tolva autodescargable",
  "Chasis/Acop tolva autodescargable escalable",
  "Equipo",
  "Equipo 20 posiciones",
  "Equipo escalable",
  "Liviano 1,5 Tn - 3 Tn",
  "Mediano 3 - 5 Tn",
  "Pickup 501-1500 kg",
  "Sider",
  "Sider escalable",
  "Semi baranda volcable",
  "Semi baranda volcable escalable",
  "Utilitario 1500 Kgs.",
  "Utilitario 2000 Kgs.",
  "Utilitario 3000 Kgs.",
  "Utilitario 500 Kgs.",
  "Utilitario 5000 Kgs.",
  "Utilitario 850 Kgs.",
  "Vulcano",
  "Vulcano escalable",
  "Walking Floor",
  "Walking Floor escalable",
];
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
    if (!m.has(k)) m.set(k, { cliente: l.cliente, domicilio: l.domicilio || "", localidad: l.localidad || "", provincia: l.provincia || "", entregar_en: l.entregar_en || "", gps: "", contacto: "", telefono: "", items: [] });
    const d = m.get(k);
    if (!d.gps && l.gps) d.gps = l.gps;
    if (!d.contacto && l.contacto) d.contacto = l.contacto;
    if (!d.telefono && l.telefono) d.telefono = l.telefono;
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
    if (d.contacto || d.telefono) L.push(`Contacto: ${[d.contacto, d.telefono].filter(Boolean).join(" · ")}`);
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
  const VERDE = [0, 157, 87], GRIS = [110, 110, 110], NEGRO = [35, 31, 32];
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
  // Columnas del detalle (dentro de la tarjeta de cada destino)
  const X0 = M + 4, ANCHO = W - 2 * M - 8;
  const cols = [["Producto", 0.42, "l"], ["Lote", 0.24, "l"], ["O/V", 0.12, "l"], ["Cant.", 0.09, "r"], ["Kg", 0.13, "r"]].map(([t, f, a]) => [t, f * ANCHO, a]);
  p.destinos.forEach((d, i) => {
    // Medidas del encabezado: número, nombre (hasta 2 renglones) y etiqueta de km a la derecha
    const kmTxt = p.km.tramos[i] != null ? `${fmt(p.km.tramos[i])} km` : "";
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
    const kmW = kmTxt ? doc.getTextWidth(kmTxt) + 7 : 0;
    const nomX = X0 + 9;
    const nom = doc.splitTextToSize(d.cliente || "—", W - M - 4 - nomX - (kmW ? kmW + 4 : 0)).slice(0, 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const dir = [d.domicilio, d.localidad && !String(d.domicilio).toUpperCase().includes(String(d.localidad).toUpperCase()) ? d.localidad : "", d.provincia].filter(Boolean).join(" · ");
    const dl = doc.splitTextToSize(dir || "—", ANCHO - 9).slice(0, 2);
    const extras = (d.entregar_en ? 1 : 0) + (d.contacto || d.telefono ? 1 : 0) + 1;
    const altoCab = 4 + nom.length * 5 + dl.length * 4.3 + extras * 4.6 + 2;
    const altoTab = 6 + d.items.length * 5.5;
    salto(altoCab + altoTab + 6);
    const y0 = y;
    // Tarjeta
    doc.setFillColor(250, 251, 250); doc.setDrawColor(214, 222, 216); doc.setLineWidth(0.3);
    doc.roundedRect(M, y0, W - 2 * M, altoCab + altoTab + 2, 2, 2, "FD");
    // Número en círculo
    doc.setFillColor(...VERDE); doc.circle(X0 + 3.2, y0 + 5.6, 3.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), X0 + 3.2, y0 + 6.9, { align: "center" });
    // Km (etiqueta)
    if (kmTxt) {
      doc.setFillColor(230, 241, 233); doc.roundedRect(W - M - 4 - kmW, y0 + 2.4, kmW, 6.4, 3.2, 3.2, "F");
      doc.setFontSize(9.5); doc.setTextColor(...VERDE);
      doc.text(kmTxt, W - M - 4 - kmW / 2, y0 + 6.9, { align: "center" });
    }
    // Cliente
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
    doc.text(nom, nomX, y0 + 6.9, { lineHeightFactor: 1.2 });
    y = y0 + 4 + nom.length * 5 + 1.5;
    // Dirección, entregar en, contacto, ubicación
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(dl, nomX, y); y += dl.length * 4.3;
    if (d.entregar_en) { doc.text(`Entregar en: ${d.entregar_en}`, nomX, y); y += 4.6; }
    if (d.contacto || d.telefono) {
      doc.setTextColor(...NEGRO); doc.setFont("helvetica", "bold"); doc.text("Contacto:", nomX, y);
      const cw = doc.getTextWidth("Contacto: ");
      doc.setFont("helvetica", "normal"); doc.text([d.contacto, d.telefono].filter(Boolean).join(" · "), nomX + cw, y); y += 4.6;
    }
    if (d.gps) { doc.setTextColor(20, 90, 160); const t = doc.splitTextToSize(d.gps, ANCHO - 9)[0]; doc.text(t, nomX, y); doc.link(nomX, y - 3.5, doc.getTextWidth(t), 5, { url: d.gps }); }
    else { doc.setTextColor(180, 60, 40); doc.text("Sin ubicación de Maps", nomX, y); }
    y += 4;
    // Detalle
    doc.setDrawColor(226, 231, 227); doc.line(X0, y, X0 + ANCHO, y);
    let x = X0; doc.setFontSize(8); doc.setTextColor(...GRIS);
    cols.forEach(([t, w, a]) => { doc.text(t, a === "r" ? x + w : x, y + 4, a === "r" ? { align: "right" } : undefined); x += w; });
    y += 6;
    doc.setFontSize(9.5); doc.setTextColor(...NEGRO);
    d.items.forEach((it) => {
      x = X0;
      const vals = [doc.splitTextToSize(it.producto, cols[0][1] - 2)[0], doc.splitTextToSize(it.lote, cols[1][1] - 2)[0] || "", it.ov, fmt(it.cantidad), it.kg ? fmt(it.kg) : "—"];
      vals.forEach((v, k) => { doc.text(String(v), cols[k][2] === "r" ? x + cols[k][1] : x, y + 3.6, cols[k][2] === "r" ? { align: "right" } : undefined); x += cols[k][1]; });
      y += 5.5;
    });
    y = y0 + altoCab + altoTab + 2 + 4;
  });
  doc.setDrawColor(205, 214, 207); doc.line(M, y, W - M, y);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
  doc.text(`Total: ${fmt(p.totU)} u. · ${fmt(p.totKg)} kg`, W - M, y + 6, { align: "right" });
  descargarBlob(doc.output("blob"), `pedido-unidad-${p.orden.numero}.pdf`);
}
