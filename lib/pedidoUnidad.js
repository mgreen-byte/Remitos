// Pedido de unidad al transporte: depósitos de carga, paradas de descarga, km, PDF y texto para WhatsApp / mail.
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";
import { norm } from "./util";
import { urlMaps } from "./rutas";

export const domPlanta = (p) => { const d = String(p?.domicilio || "").trim(); const pr = String(p?.provincia || "").trim(); return d && pr && d.toUpperCase().includes(pr.toUpperCase()) ? d : [d, pr].filter(Boolean).join(", "); };
export const nombreCorto = (n) => String(n || "").split("|")[0].trim();
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
// Clave de parada: el link / coordenadas de Maps (normalizado); sin ubicación, cliente + domicilio.
const clavePunto = (l) => (l.gps ? `gps:${String(l.gps).trim().toLowerCase().replace(/\/+$/, "").replace(/\?.*$/, "")}` : `dir:${norm(l.cliente)}||${norm(l.domicilio)}`);

// Arma depósitos y paradas. Toma lo pendiente (saldo); si no queda saldo, lo pedido.
// Paradas en orden de descarga: el último renglón de la orden es la primera parada.
export function armarPedido(lineas, productos = []) {
  const hayPend = lineas.some((l) => Number(l.saldo) > 0);
  const ls = [...lineas]
    .filter((l) => !hayPend || Number(l.saldo) > 0)
    .map((l, i) => [l, i])
    .sort((a, b) => (a[0].posicion ?? 1e9) - (b[0].posicion ?? 1e9) || a[1] - b[1])
    .map((x) => x[0])
    .reverse();
  const deps = new Map();
  const paradas = new Map();
  for (const l of ls) {
    const cant = hayPend ? Number(l.saldo) : Number(l.cantidad);
    const kgu = Number(productos.find((p) => p.id === l.producto_id)?.kg_por_unidad) || 0;
    const kg = Number(l.kilos) > 0 && Number(l.cantidad) > 0 ? (Number(l.kilos) * cant) / Number(l.cantidad) : cant * kgu;
    if (!deps.has(l.planta_id)) deps.set(l.planta_id, { planta_id: l.planta_id, nombre: l.planta_nombre || "", unidades: 0, kg: 0 });
    const dp = deps.get(l.planta_id); dp.unidades += cant; dp.kg += kg;
    const k = clavePunto(l);
    if (!paradas.has(k)) paradas.set(k, { domicilio: l.domicilio || "", localidad: l.localidad || "", provincia: l.provincia || "", entregar_en: l.entregar_en || "", gps: l.gps || "", contactos: [], clientes: new Map() });
    const pa = paradas.get(k);
    const ct = [l.contacto, l.telefono].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
    if (ct && !pa.contactos.some((c) => norm(c) === norm(ct))) pa.contactos.push(ct);
    if (!pa.entregar_en && l.entregar_en) pa.entregar_en = l.entregar_en;
    const kc = norm(l.cliente);
    if (!pa.clientes.has(kc)) pa.clientes.set(kc, { cliente: l.cliente, items: [] });
    pa.clientes.get(kc).items.push({ producto: [l.producto_texto, l.presentacion].filter(Boolean).join(" · "), lote: l.lote_texto || "", ov: l.ov || "", cantidad: cant, kg, planta_id: l.planta_id, cargaEn: nombreCorto(l.planta_nombre) });
  }
  const lista = [...paradas.values()].map((p) => ({ ...p, clientes: [...p.clientes.values()], unidades: [...p.clientes.values()].reduce((a, c) => a + c.items.reduce((b, it) => b + it.cantidad, 0), 0), kg: [...p.clientes.values()].reduce((a, c) => a + c.items.reduce((b, it) => b + it.kg, 0), 0) }));
  return { depositos: [...deps.values()], paradas: lista, pendiente: hayPend };
}

export function textoPedido(p) {
  const L = [];
  L.push(`*PEDIDO DE UNIDAD${p.empresaNombre ? " · " + p.empresaNombre : ""}*`);
  L.push(`Orden de carga: ${p.orden.numero}`);
  if (p.orden.fecha_carga) L.push(`Fecha de carga: ${fmtF(p.orden.fecha_carga)}`);
  L.push(`Tipo de unidad: ${p.tipoUnidad || "a definir"}`);
  L.push(`Carga total: ${fmt(p.totU)} u. · ${fmt(p.totKg)} kg`);
  if (p.km.total != null) L.push(`Kms: ${fmt(p.km.total)} km${p.km.estimado ? " (estimado)" : ""}`);
  if (p.recorrido) L.push(`Recorrido: ${p.recorrido}`);
  L.push("");
  p.depositos.forEach((d, i) => {
    const pl = d.planta || {};
    L.push(`*Carga ${i + 1}: ${pl.nombre || d.nombre}*${i > 0 && p.km.dep[i] != null ? ` · ${fmt(p.km.dep[i])} km desde la carga ${i}` : ""}`);
    if (pl.domicilio) L.push(`Domicilio: ${domPlanta(pl)}`);
    if (pl.gps) L.push(`Ubicación: ${urlMaps(pl.gps)}`);
    const cont = [pl.contacto_nombre, pl.contacto_telefono].filter(Boolean).join(" · ");
    if (cont) L.push(`Contacto: ${cont}`);
    if (pl.horario_atencion) L.push(`Horario de atención: ${pl.horario_atencion}`);
    L.push(`Carga: ${fmt(d.unidades)} u. · ${fmt(d.kg)} kg`);
    L.push("");
  });
  p.paradas.forEach((pa, i) => {
    L.push(`*Descarga ${i + 1}: ${[pa.localidad, pa.provincia].filter(Boolean).join(", ") || pa.domicilio}*${p.km.par[i] != null ? ` · ${fmt(p.km.par[i])} km` : ""}`);
    if (pa.domicilio) L.push(`Dirección: ${pa.domicilio}`);
    if (pa.entregar_en) L.push(`Entregar en: ${pa.entregar_en}`);
    if (pa.contactos.length) L.push(`Contacto: ${pa.contactos.join(" / ")}`);
    if (pa.gps) L.push(`Ubicación: ${urlMaps(pa.gps)}`);
    pa.clientes.forEach((c) => {
      L.push(`- ${c.cliente}`);
      c.items.forEach((it) => L.push(`   ${fmt(it.cantidad)} u. ${it.producto}${it.lote ? " · lote " + it.lote : ""}${it.ov ? " · O/V " + it.ov : ""}${p.depositos.length > 1 ? " · carga en " + it.cargaEn : ""}`));
    });
    L.push("");
  });
  if (p.obs) L.push(`Observaciones: ${p.obs}`);
  return L.join("\n").trim();
}

export async function descargarPedidoPdf(p) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14;
  const VERDE = [0, 157, 87], GRIS = [110, 110, 110], NEGRO = [35, 31, 32], AZUL = [20, 90, 160];
  let y = M;
  const logoW = await dibujarLogo(doc, p.empresa, M, y - 2, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE);
  doc.text("Pedido de unidad", M + (logoW ? logoW + 6 : 0), y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...GRIS);
  doc.text(`Orden de carga ${p.orden.numero}`, M + (logoW ? logoW + 6 : 0), y + 11.5);
  y += 18;
  const salto = (h) => { if (y + h > H - 14) { doc.addPage(); y = M; } };
  const titulo = (t) => { salto(12); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE); doc.text(t, M, y + 3); y += 6; };
  const linkTxt = (u, x, yy, ancho) => { doc.setTextColor(...AZUL); const t = doc.splitTextToSize(u, ancho)[0]; doc.text(t, x, yy); doc.link(x, yy - 3.5, doc.getTextWidth(t), 5, { url: u }); };

  // Datos del viaje
  const filas = [
    ["Fecha de carga", fmtF(p.orden.fecha_carga)],
    ["Tipo de unidad", p.tipoUnidad || "a definir"],
    ["Carga total", `${fmt(p.totU)} unidades · ${fmt(p.totKg)} kg`],
    ["Kms", p.km.total != null ? `${fmt(p.km.total)} km${p.km.estimado ? " (estimado)" : ""}${p.km.faltan ? ` · faltan ubicaciones (${p.km.faltan})` : ""}` : "sin ubicaciones para calcular"],
    ...(p.recorrido ? [["Ver recorrido", p.recorrido, true]] : []),
    ...(p.obs ? [["Observaciones", p.obs]] : []),
  ];
  doc.setFontSize(10);
  const altoV = 8 + filas.reduce((a, f) => a + 5 * Math.max(1, f[2] ? 1 : doc.splitTextToSize(String(f[1]), W - 2 * M - 46).length), 0);
  doc.setFillColor(246, 248, 246); doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3);
  doc.roundedRect(M, y, W - 2 * M, altoV, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE); doc.text("DATOS DEL VIAJE", M + 4, y + 5.5);
  let yy = y + 11;
  for (const [et, v, link] of filas) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS); doc.text(et, M + 4, yy);
    doc.setFontSize(10);
    if (link) { linkTxt(String(v), M + 42, yy, W - 2 * M - 46); yy += 5; continue; }
    doc.setTextColor(...NEGRO);
    const t = doc.splitTextToSize(String(v), W - 2 * M - 46); doc.text(t, M + 42, yy); yy += 5 * Math.max(1, t.length);
  }
  y += altoV + 6;

  // Tarjeta con número en círculo y etiqueta de km
  const cabecera = (num, color, tituloTxt, kmTxt, y0) => {
    doc.setFillColor(...color); doc.circle(M + 7.2, y0 + 5.6, 3.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255); doc.text(String(num), M + 7.2, y0 + 6.9, { align: "center" });
    doc.setFontSize(10.5);
    const kmW = kmTxt ? doc.getTextWidth(kmTxt) + 7 : 0;
    if (kmTxt) { doc.setFillColor(230, 241, 233); doc.roundedRect(W - M - 4 - kmW, y0 + 2.4, kmW, 6.4, 3.2, 3.2, "F"); doc.setFontSize(9.5); doc.setTextColor(...VERDE); doc.text(kmTxt, W - M - 4 - kmW / 2, y0 + 6.9, { align: "center" }); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
    const nom = doc.splitTextToSize(tituloTxt, W - M - 4 - (M + 13) - (kmW ? kmW + 4 : 0)).slice(0, 2);
    doc.text(nom, M + 13, y0 + 6.9, { lineHeightFactor: 1.2 });
    return y0 + 4 + nom.length * 5 + 1.5;
  };

  // Depósitos de carga
  titulo(p.depositos.length > 1 ? "DEPÓSITOS DE CARGA (EN ESTE ORDEN)" : "DEPÓSITO DE CARGA");
  p.depositos.forEach((d, i) => {
    const pl = d.planta || {};
    const alto = 29;
    salto(alto + 4);
    const y0 = y;
    doc.setFillColor(250, 251, 250); doc.setDrawColor(214, 222, 216); doc.setLineWidth(0.3); doc.roundedRect(M, y0, W - 2 * M, alto, 2, 2, "FD");
    y = cabecera(i + 1, [0, 95, 174], pl.nombre || d.nombre, i > 0 && p.km.dep[i] != null ? `${fmt(p.km.dep[i])} km` : "", y0);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(doc.splitTextToSize(domPlanta(pl) || "Sin domicilio", W - 2 * M - 20)[0], M + 13, y); y += 4.6;
    doc.setTextColor(...NEGRO);
    doc.text(`Contacto: ${[pl.contacto_nombre, pl.contacto_telefono].filter(Boolean).join(" · ") || "—"}   ·   Horario: ${pl.horario_atencion || "—"}`, M + 13, y); y += 4.6;
    doc.setFont("helvetica", "bold"); doc.text(`Se carga: ${fmt(d.unidades)} u. · ${fmt(d.kg)} kg`, M + 13, y); doc.setFont("helvetica", "normal"); y += 4.6;
    if (pl.gps) linkTxt(urlMaps(pl.gps), M + 13, y, W - 2 * M - 20); else { doc.setTextColor(180, 60, 40); doc.text("Sin ubicación de Maps", M + 13, y); }
    y = y0 + alto + 3;
  });
  y += 3;

  // Paradas de descarga
  titulo("DESCARGAS EN ESTE ORDEN");
  const X0 = M + 4, ANCHO = W - 2 * M - 8;
  const multi = p.depositos.length > 1;
  const cols = (multi
    ? [["Cliente", 0.24, "l"], ["Material / Variedad", 0.22, "l"], ["Lote", 0.17, "l"], ["O/V", 0.08, "l"], ["Carga en", 0.12, "l"], ["Cant.", 0.07, "r"], ["Kg", 0.10, "r"]]
    : [["Cliente", 0.28, "l"], ["Material / Variedad", 0.27, "l"], ["Lote", 0.2, "l"], ["O/V", 0.09, "l"], ["Cant.", 0.07, "r"], ["Kg", 0.09, "r"]]
  ).map(([t, f, a]) => [t, f * ANCHO, a]);
  p.paradas.forEach((pa, i) => {
    const filasT = pa.clientes.flatMap((c) => c.items.map((it, k) => ({ c: k === 0 ? c.cliente : "", it })));
    doc.setFontSize(9);
    const lineasDir = (pa.entregar_en ? 1 : 0) + (pa.contactos.length ? 1 : 0) + 2;
    const alto = 6 + 5 + lineasDir * 4.6 + 6 + filasT.length * 5.2 + 4;
    salto(Math.min(alto, 120) + 4);
    const y0 = y;
    const altoReal = Math.min(alto, H - 14 - y0);
    doc.setFillColor(250, 251, 250); doc.setDrawColor(214, 222, 216); doc.setLineWidth(0.3); doc.roundedRect(M, y0, W - 2 * M, altoReal, 2, 2, "FD");
    y = cabecera(i + 1, VERDE, [pa.localidad, pa.provincia].filter(Boolean).join(", ") || pa.domicilio || "Sin dirección", p.km.par[i] != null ? `${fmt(p.km.par[i])} km` : "", y0);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRIS);
    if (pa.domicilio) { doc.text(doc.splitTextToSize(pa.domicilio, W - 2 * M - 20)[0], M + 13, y); y += 4.6; }
    if (pa.entregar_en) { doc.text(`Entregar en: ${pa.entregar_en}`, M + 13, y); y += 4.6; }
    if (pa.contactos.length) { doc.setTextColor(...NEGRO); doc.setFont("helvetica", "bold"); doc.text("Contacto:", M + 13, y); const cw = doc.getTextWidth("Contacto: "); doc.setFont("helvetica", "normal"); doc.text(doc.splitTextToSize(pa.contactos.join(" / "), W - 2 * M - 22 - cw)[0], M + 13 + cw, y); y += 4.6; }
    if (pa.gps) linkTxt(urlMaps(pa.gps), M + 13, y, W - 2 * M - 20); else { doc.setTextColor(180, 60, 40); doc.text("Sin ubicación de Maps", M + 13, y); }
    y += 4;
    doc.setDrawColor(226, 231, 227); doc.line(X0, y, X0 + ANCHO, y);
    let x = X0; doc.setFontSize(8); doc.setTextColor(...GRIS);
    cols.forEach(([t, w, a]) => { doc.text(t, a === "r" ? x + w : x, y + 4, a === "r" ? { align: "right" } : undefined); x += w; });
    y += 6;
    doc.setFontSize(8.5); doc.setTextColor(...NEGRO);
    filasT.forEach(({ c, it }) => {
      if (y + 5.2 > H - 14) { doc.addPage(); y = M; }
      x = X0;
      const vals = multi ? [c, it.producto, it.lote, it.ov, it.cargaEn, fmt(it.cantidad), it.kg ? fmt(it.kg) : "—"] : [c, it.producto, it.lote, it.ov, fmt(it.cantidad), it.kg ? fmt(it.kg) : "—"];
      vals.forEach((v, k) => { doc.setFont("helvetica", k === 0 ? "bold" : "normal"); const t = doc.splitTextToSize(String(v || ""), cols[k][1] - 1.5)[0] || ""; doc.text(t, cols[k][2] === "r" ? x + cols[k][1] : x, y + 3.6, cols[k][2] === "r" ? { align: "right" } : undefined); x += cols[k][1]; });
      y += 5.2;
    });
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(`${fmt(pa.unidades)} u. · ${fmt(pa.kg)} kg`, X0 + ANCHO, y + 3.4, { align: "right" });
    y = Math.max(y + 6, y0 + altoReal) + 4;
  });
  doc.setDrawColor(205, 214, 207); doc.line(M, y, W - M, y);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
  doc.text(`Total: ${fmt(p.totU)} u. · ${fmt(p.totKg)} kg`, W - M, y + 6, { align: "right" });
  descargarBlob(doc.output("blob"), `pedido-unidad-${p.orden.numero}.pdf`);
}
