// Armador de reportes (solo admin): arma tablas a partir de los datos de la plataforma y las baja a Excel / PDF.
import { cargarDespachos, traerTodo } from "@/lib/despachos";
import { nombreConPresentacion, norm } from "@/lib/util";
import { descargarBlob } from "@/lib/remitoPdf";

export const TIPOS = {
  remitos: { titulo: "Remitos y despachos", ayuda: "Un renglón por producto de cada remito emitido (no anulados ni rechazados). Incluye traslados entre plantas si los elegís." },
  ordenes: { titulo: "Órdenes de carga", ayuda: "Un renglón por línea de orden: pedido, remitido y saldo pendiente." },
  stock: { titulo: "Stock y lotes", ayuda: "Un renglón por lote: stock inicial, stock actual, comprometido y disponible." },
};

const fmtF = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const cuitFmt = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d; };
const contiene = (texto, q) => !q || norm(texto).includes(norm(q));
const num = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dest = (l) => [l.domicilio, l.provincia].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");

// columnas: k = clave, t = título, w = peso en el PDF, n = numérica (se suma en el total)
async function reporteRemitos(supabase, f) {
  let filas = await cargarDespachos(supabase, { desde: f.desde, hasta: f.hasta, plantaId: f.plantaId });
  if (f.tipoRemito === "cliente") filas = filas.filter((x) => x.tipo === "cliente");
  if (f.tipoRemito === "traslado") filas = filas.filter((x) => x.tipo === "traslado");
  if (f.cliente) filas = filas.filter((x) => contiene(`${x.cliente} ${x.cuit}`, f.cliente));
  if (f.producto) filas = filas.filter((x) => contiene(x.producto, f.producto));
  if (f.soloConOrden) filas = filas.filter((x) => x.orden);
  const ESTADO = { emitido: "Emitido", en_transito: "En tránsito", recibido: "Recibido" };
  return {
    columnas: [
      { k: "fecha", t: "Fecha", w: 9 }, { k: "remito", t: "Remito", w: 13 }, { k: "tipo", t: "Tipo", w: 9 }, { k: "estado", t: "Estado", w: 9 },
      { k: "planta", t: "Planta", w: 14 }, { k: "cliente", t: "Cliente / destino", w: 22 }, { k: "destino", t: "Domicilio entrega", w: 18 }, { k: "cuit", t: "CUIT", w: 12 },
      { k: "orden", t: "Orden", w: 13 }, { k: "ov", t: "O/V", w: 8 }, { k: "producto", t: "Producto", w: 26 }, { k: "lote", t: "Lote", w: 14 },
      { k: "unidades", t: "Unidades", w: 8, n: true }, { k: "kg", t: "Kg", w: 9, n: true }, { k: "transporte", t: "Transporte", w: 16 },
    ],
    filas: filas.map((x) => ({
      fecha: fmtF(x.fecha), remito: x.remito, tipo: x.tipo === "traslado" ? "Traslado" : "Cliente", estado: ESTADO[x.estado] || x.estado,
      planta: x.planta, cliente: x.cliente, destino: x.destino_entrega || "", cuit: cuitFmt(x.cuit),
      orden: x.orden + (x.salida ? ` · ${x.salida}` : ""), ov: x.ov, producto: x.producto, lote: x.lote,
      unidades: num(x.cantidad), kg: num(x.kg), transporte: x.transporte,
    })),
  };
}

async function reporteOrdenes(supabase, f) {
  const [ls, plantas] = await Promise.all([
    traerTodo(() => {
      let q = supabase.from("v_ordenes_lineas_saldo").select("*").order("orden_numero").order("id");
      if (f.estadoOrden !== "todas") q = q.eq("orden_estado", "activa");
      if (f.plantaId) q = q.eq("planta_id", f.plantaId);
      if (f.desde) q = q.gte("orden_fecha", f.desde);
      if (f.hasta) q = q.lte("orden_fecha", f.hasta);
      return q;
    }),
    supabase.from("plantas").select("id, nombre").then(({ data }) => data || []),
  ]);
  const pl = Object.fromEntries(plantas.map((p) => [p.id, p.nombre]));
  let filas = ls;
  if (f.tipoOrden === "cliente") filas = filas.filter((l) => l.orden_modalidad !== "traslado");
  if (f.tipoOrden === "traslado") filas = filas.filter((l) => l.orden_modalidad === "traslado");
  if (f.cliente) filas = filas.filter((l) => contiene(`${l.cliente} ${l.cuit}`, f.cliente));
  if (f.producto) filas = filas.filter((l) => contiene(`${l.producto_texto} ${l.presentacion}`, f.producto));
  if (f.soloPendientes) filas = filas.filter((l) => Number(l.saldo) > 0);
  return {
    columnas: [
      { k: "orden", t: "Orden", w: 12 }, { k: "fecha", t: "Fecha orden", w: 10 }, { k: "estado", t: "Estado", w: 9 }, { k: "tipo", t: "Tipo", w: 9 },
      { k: "planta", t: "Planta", w: 15 }, { k: "cliente", t: "Cliente / destino", w: 24 }, { k: "domicilio", t: "Domicilio entrega", w: 20 }, { k: "ov", t: "O/V", w: 8 },
      { k: "producto", t: "Producto", w: 26 }, { k: "lote", t: "Lote", w: 14 },
      { k: "pedido", t: "Pedido", w: 8, n: true }, { k: "remitido", t: "Remitido", w: 8, n: true }, { k: "saldo", t: "Saldo", w: 8, n: true },
    ],
    filas: filas.map((l) => {
      const tr = l.orden_modalidad === "traslado";
      return {
        orden: l.orden_numero, fecha: fmtF(l.orden_fecha), estado: l.orden_estado, tipo: tr ? "Traslado" : "Cliente",
        planta: l.planta_nombre, cliente: tr ? pl[l.orden_planta_destino_id] || "—" : l.cliente, domicilio: tr ? "" : dest(l), ov: l.ov || "",
        producto: l.producto_texto + (l.presentacion ? ` · ${l.presentacion}` : ""), lote: l.lote_texto || "",
        pedido: num(l.cantidad), remitido: num(l.remitido), saldo: Math.max(0, num(l.saldo)),
      };
    }),
  };
}

async function reporteStock(supabase, f) {
  const [lotes, ls, movs, plantas] = await Promise.all([
    traerTodo(() => {
      let q = supabase.from("lotes").select("id, lote, stock, producto_id, planta_id, producto:productos(nombre, presentacion, categoria, grupo, kg_por_unidad)").order("id");
      if (f.plantaId) q = q.eq("planta_id", f.plantaId);
      return q;
    }),
    traerTodo(() => {
      let q = supabase.from("v_ordenes_lineas_saldo").select("id, producto_id, lote_texto, planta_id, saldo").eq("orden_estado", "activa").neq("orden_modalidad", "traslado").gt("saldo", 0).order("id");
      if (f.plantaId) q = q.eq("planta_id", f.plantaId);
      return q;
    }),
    traerTodo(() => {
      let q = supabase.from("movimientos_stock").select("id, lote_id, cantidad, lote:lotes!inner(planta_id)").in("tipo", ["ingreso", "ajuste", "traslado_ingreso"]).gt("cantidad", 0).order("id");
      if (f.plantaId) q = q.eq("lote.planta_id", f.plantaId);
      return q;
    }),
    supabase.from("plantas").select("id, nombre").then(({ data }) => data || []),
  ]);
  const pl = Object.fromEntries(plantas.map((p) => [p.id, p.nombre]));
  const ini = {};
  for (const m of movs) ini[m.lote_id] = (ini[m.lote_id] || 0) + Number(m.cantidad);
  const key = (pid, prod, lote) => `${pid}|${prod}|${norm(lote)}`;
  const comp = {};
  for (const l of ls) if (l.producto_id && l.lote_texto) comp[key(l.planta_id, l.producto_id, l.lote_texto)] = (comp[key(l.planta_id, l.producto_id, l.lote_texto)] || 0) + Number(l.saldo);
  let filas = lotes;
  if (f.producto) filas = filas.filter((l) => contiene(`${l.producto?.nombre} ${l.producto?.presentacion} ${l.lote}`, f.producto));
  if (f.soloConStock) filas = filas.filter((l) => Number(l.stock) > 0);
  const out = filas.map((l) => {
    const c = comp[key(l.planta_id, l.producto_id, l.lote)] || 0;
    const kgu = Number(l.producto?.kg_por_unidad) || 0;
    return {
      planta: pl[l.planta_id] || "—", producto: nombreConPresentacion(l.producto?.nombre, l.producto?.presentacion), lote: l.lote,
      inicial: num(ini[l.id] || 0), stock: num(l.stock), comprometido: num(c), disponible: num(Number(l.stock) - c), kg: num(Number(l.stock) * kgu),
    };
  }).sort((a, b) => a.planta.localeCompare(b.planta, "es") || a.producto.localeCompare(b.producto, "es") || a.lote.localeCompare(b.lote, "es"));
  return {
    columnas: [
      { k: "planta", t: "Planta", w: 18 }, { k: "producto", t: "Producto", w: 38 }, { k: "lote", t: "Lote", w: 18 },
      { k: "inicial", t: "Inicial", w: 9, n: true }, { k: "stock", t: "Stock (u.)", w: 9, n: true }, { k: "comprometido", t: "Comprometido", w: 11, n: true },
      { k: "disponible", t: "Disponible", w: 10, n: true }, { k: "kg", t: "Stock (kg)", w: 11, n: true },
    ],
    filas: out,
  };
}

export async function generarReporte(supabase, tipo, f) {
  const r = tipo === "ordenes" ? await reporteOrdenes(supabase, f) : tipo === "stock" ? await reporteStock(supabase, f) : await reporteRemitos(supabase, f);
  const totales = {};
  for (const c of r.columnas) if (c.n) totales[c.k] = r.filas.reduce((a, x) => a + (Number(x[c.k]) || 0), 0);
  return { ...r, totales, titulo: TIPOS[tipo].titulo };
}

const fmt = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });

export async function reporteExcel(rep, filtrosTxt) {
  const XLSX = await import("xlsx");
  const filas = rep.filas.map((x) => Object.fromEntries(rep.columnas.map((c) => [c.t, x[c.k]])));
  filas.push(Object.fromEntries(rep.columnas.map((c, i) => [c.t, c.n ? rep.totales[c.k] : i === 0 ? "TOTAL" : ""])));
  const ws = XLSX.utils.json_to_sheet(filas);
  ws["!cols"] = rep.columnas.map((c) => ({ wch: Math.max(c.t.length + 2, Math.round(c.w * 1.2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, rep.titulo.slice(0, 30));
  const wf = XLSX.utils.aoa_to_sheet([["Reporte", rep.titulo], ["Generado", new Date().toLocaleString("es-AR")], ["Filtros", filtrosTxt], ["Filas", rep.filas.length]]);
  wf["!cols"] = [{ wch: 12 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wf, "Filtros");
  XLSX.writeFile(wb, `reporte_${rep.titulo.toLowerCase().replace(/[^a-z]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function reportePdf(rep, filtrosTxt) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 10, VERDE = [22, 101, 52], GRIS = [110, 110, 110];
  const esc = (W - 2 * M) / rep.columnas.reduce((a, c) => a + c.w, 0);
  const an = rep.columnas.map((c) => c.w * esc);
  let y = M;
  const encabezado = () => {
    doc.setFillColor(238, 242, 239); doc.rect(M, y, W - 2 * M, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(60);
    let x = M;
    rep.columnas.forEach((c, i) => { doc.text(c.t, c.n ? x + an[i] - 1.2 : x + 1.2, y + 4.2, { align: c.n ? "right" : "left" }); x += an[i]; });
    y += 6;
  };
  const fila = (vals, { bold = false, fondo = null, color = 40 } = {}) => {
    const h = 5;
    if (y + h > H - 14) { doc.addPage(); y = M; encabezado(); }
    if (fondo) { doc.setFillColor(...fondo); doc.rect(M, y, W - 2 * M, h, "F"); }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(7.2); doc.setTextColor(color);
    let x = M;
    rep.columnas.forEach((c, i) => {
      const v = vals[i];
      const t = c.n ? (v === "" ? "" : fmt(v)) : String(v ?? "");
      const txt = doc.splitTextToSize(t, an[i] - 2.4)[0] || "";
      doc.text(txt, c.n ? x + an[i] - 1.2 : x + 1.2, y + 3.6, { align: c.n ? "right" : "left" });
      x += an[i];
    });
    doc.setDrawColor(232); doc.setLineWidth(0.1); doc.line(M, y + h, W - M, y + h);
    y += h;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...VERDE);
  doc.text(rep.titulo, M, y + 5); y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
  const lineas = doc.splitTextToSize(`${filtrosTxt}   ·   ${rep.filas.length} fila${rep.filas.length === 1 ? "" : "s"}`, W - 2 * M);
  doc.text(lineas, M, y + 3); y += 4 + lineas.length * 4;
  encabezado();
  for (const x of rep.filas) fila(rep.columnas.map((c) => x[c.k]));
  fila(rep.columnas.map((c, i) => (c.n ? rep.totales[c.k] : i === 0 ? "TOTAL" : "")), { bold: true, color: 255, fondo: VERDE });
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, H - 6);
    doc.text(`Página ${p} de ${n}`, W - M, H - 6, { align: "right" });
  }
  descargarBlob(doc.output("blob"), `reporte_${rep.titulo.toLowerCase().replace(/[^a-z]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
