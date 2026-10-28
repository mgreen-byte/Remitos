// Datos de despachos (remitos no anulados ni rechazados) para el tablero y las descargas de órdenes entregadas.
import { nombreConPresentacion } from "@/lib/util";
import { descargarBlob } from "@/lib/remitoPdf";

const PAG = 1000;

// Trae todas las páginas de una consulta (PostgREST limita a 1000 filas por pedido).
export async function traerTodo(armar) {
  const out = [];
  for (let desde = 0; desde < 100000; desde += PAG) {
    const { data, error } = await armar().range(desde, desde + PAG - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAG) break;
  }
  return out;
}

// Una fila por renglón de remito despachado. tipo: "cliente" | "traslado".
export async function cargarDespachos(supabase, { desde, hasta, plantaId }) {
  const remitos = await traerTodo(() => {
    let q = supabase
      .from("remitos")
      .select("id, punto_venta, numero, fecha, estado, tipo, planta_id, planta_destino_id, cliente_nombre, cliente_cuit, orden_carga, orden_salida, transportista_nombre, planta:plantas!planta_id(nombre), destino:plantas!planta_destino_id(nombre), remito_items(cantidad, kg_total, descripcion, lote_texto, linea:ordenes_carga_lineas(ov), producto:productos(nombre, presentacion))")
      .not("estado", "in", "(anulado,rechazado)")
      .order("fecha", { ascending: true })
      .order("id", { ascending: true });
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    if (plantaId) q = q.eq("planta_id", plantaId);
    return q;
  });
  const filas = [];
  for (const r of remitos) {
    const traslado = r.tipo === "traslado";
    for (const it of r.remito_items || []) {
      const prod = it.producto ? nombreConPresentacion(it.producto.nombre, it.producto.presentacion) : String(it.descripcion || "").split(" · ")[0];
      filas.push({
        remitoId: r.id,
        remito: `${r.punto_venta}-${r.numero}`,
        fecha: r.fecha,
        estado: r.estado,
        tipo: traslado ? "traslado" : "cliente",
        planta: r.planta?.nombre || "—",
        destino: traslado ? r.destino?.nombre || "—" : "",
        cliente: traslado ? r.destino?.nombre || "—" : r.cliente_nombre || "—",
        cuit: traslado ? "" : String(r.cliente_cuit || "").replace(/\D/g, ""),
        orden: String(r.orden_carga || "").trim(),
        salida: r.orden_salida || null,
        transporte: r.transportista_nombre || "",
        producto: prod || "—",
        lote: it.lote_texto || "",
        ov: String(it.linea?.ov || "").trim(),
        cantidad: Number(it.cantidad) || 0,
        kg: Number(it.kg_total) || 0,
      });
    }
  }
  return filas;
}

const fmt = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const fmtF = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const cuitFmt = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d; };

// Entregas = renglones de remitos con orden de carga.
export function filasDeEntregas(filas, { incluirTraslados = false } = {}) {
  return filas.filter((f) => f.orden && (incluirTraslados || f.tipo === "cliente"));
}

function agrupar(filas, clave, init) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!m.has(k)) m.set(k, init(f));
    const g = m.get(k);
    g.cantidad += f.cantidad; g.kg += f.kg; g.remitos.add(f.remitoId);
  }
  return [...m.values()];
}

export async function descargarEntregasExcel(filas, { desde, hasta, plantaNombre }) {
  const XLSX = await import("xlsx");
  const detalle = filas.map((f) => ({
    Fecha: fmtF(f.fecha), "Orden de carga": f.orden + (f.salida ? ` · ${f.salida}` : ""), "O/V": f.ov, Remito: f.remito, Tipo: f.tipo === "traslado" ? "Traslado entre plantas" : "Cliente",
    Planta: f.planta, Cliente: f.cliente, CUIT: cuitFmt(f.cuit), Producto: f.producto, Lote: f.lote, Unidades: f.cantidad, Kg: Math.round(f.kg * 100) / 100, Transporte: f.transporte,
  }));
  const porCliente = agrupar(filas, (f) => `${f.cliente}|${f.cuit}`, (f) => ({ cliente: f.cliente, cuit: f.cuit, cantidad: 0, kg: 0, remitos: new Set() }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, "es"))
    .map((g) => ({ Cliente: g.cliente, CUIT: cuitFmt(g.cuit), Remitos: g.remitos.size, Unidades: g.cantidad, Kg: Math.round(g.kg) }));
  const porProducto = agrupar(filas, (f) => f.producto, (f) => ({ producto: f.producto, cantidad: 0, kg: 0, remitos: new Set() }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .map((g) => ({ Producto: g.producto, Remitos: g.remitos.size, Unidades: g.cantidad, Kg: Math.round(g.kg) }));
  const wb = XLSX.utils.book_new();
  const hoja = (rows, anchos, nombre) => { const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = anchos.map((wch) => ({ wch })); XLSX.utils.book_append_sheet(wb, ws, nombre); };
  hoja(detalle, [11, 18, 12, 16, 20, 22, 34, 15, 44, 18, 10, 12, 28], "Detalle");
  hoja(porCliente, [40, 15, 9, 10, 12], "Por cliente");
  hoja(porProducto, [48, 9, 10, 12], "Por producto");
  XLSX.writeFile(wb, `entregas_${desde || "inicio"}_a_${hasta || "hoy"}${plantaNombre ? "_" + plantaNombre.replace(/\W+/g, "") : ""}.xlsx`);
}

export async function descargarEntregasPdf(filas, { desde, hasta, plantaNombre, incluirTraslados }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 12, VERDE = [22, 101, 52], GRIS = [110, 110, 110];
  const cols = [["Fecha", 19, "l"], ["Orden", 28, "l"], ["O/V", 20, "l"], ["Remito", 28, "l"], ["Producto", 92, "l"], ["Lote", 34, "l"], ["Unidades", 20, "r"], ["Kg", 24, "r"]];
  const esc = (W - 2 * M) / cols.reduce((a, c) => a + c[1], 0);
  const an = cols.map((c) => c[1] * esc);
  let y = M;
  const totU = filas.reduce((a, f) => a + f.cantidad, 0), totK = filas.reduce((a, f) => a + f.kg, 0);
  const nuevaPagina = () => { doc.addPage(); y = M; };
  const necesita = (h) => { if (y + h > H - 14) nuevaPagina(); };
  const fila = (vals, { bold = false, color = 40, fondo = null, h = 5.4 } = {}) => {
    necesita(h);
    if (fondo) { doc.setFillColor(...fondo); doc.rect(M, y, W - 2 * M, h, "F"); }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.3); doc.setTextColor(color);
    let x = M;
    vals.forEach((v, i) => {
      const al = cols[i][2];
      const txt = doc.splitTextToSize(String(v ?? ""), an[i] - 3)[0] || "";
      doc.text(txt, al === "r" ? x + an[i] - 1.5 : x + 1.5, y + h - 1.6, { align: al === "r" ? "right" : "left" });
      x += an[i];
    });
    y += h;
  };

  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE);
  doc.text("Órdenes de carga entregadas", M, y + 6); y += 10;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(70);
  doc.text(`Período: ${desde ? fmtF(desde) : "inicio"} al ${hasta ? fmtF(hasta) : "hoy"}   ·   ${plantaNombre || "Todas las plantas"}   ·   ${incluirTraslados ? "Incluye traslados entre plantas" : "Solo despachos a clientes"}`, M, y + 3); y += 8;
  doc.setFillColor(246, 248, 246); doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3);
  doc.roundedRect(M, y, W - 2 * M, 12, 1.5, 1.5, "FD");
  const nRem = new Set(filas.map((f) => f.remitoId)).size, nCli = new Set(filas.filter((f) => f.tipo === "cliente").map((f) => f.cliente + f.cuit)).size;
  [["Remitos", fmt(nRem)], ["Clientes", fmt(nCli)], ["Unidades", fmt(totU)], ["Kg", fmt(totK)]].forEach(([et, v], i) => {
    const x = M + 5 + i * 60;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS); doc.text(et.toUpperCase(), x, y + 4.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(25); doc.text(v, x, y + 9.6);
  });
  y += 16;

  const cuadro = (titulo, sub) => {
    necesita(18);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(25); doc.text(titulo, M, y + 4);
    if (sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS); doc.text(sub, W - M, y + 4, { align: "right" }); }
    y += 6;
    fila(cols.map((c) => c[0]), { bold: true, color: 60, fondo: [238, 242, 239] });
  };

  const clientes = agrupar(filas, (f) => `${f.cliente}|${f.cuit}|${f.tipo}`, (f) => ({ cliente: f.cliente, cuit: f.cuit, tipo: f.tipo, cantidad: 0, kg: 0, remitos: new Set(), filas: [] }));
  clientes.forEach((g) => { g.filas = filas.filter((f) => f.cliente === g.cliente && f.cuit === g.cuit && f.tipo === g.tipo); });
  clientes.sort((a, b) => (a.tipo === b.tipo ? a.cliente.localeCompare(b.cliente, "es") : a.tipo === "cliente" ? -1 : 1));
  for (const g of clientes) {
    cuadro(g.tipo === "traslado" ? `Traslado a ${g.cliente}` : g.cliente, g.tipo === "traslado" ? "Traslado entre plantas" : g.cuit ? `CUIT ${cuitFmt(g.cuit)}` : "");
    for (const f of g.filas) fila([fmtF(f.fecha), f.orden + (f.salida ? ` · ${f.salida}` : ""), f.ov, f.remito, f.producto, f.lote, fmt(f.cantidad), fmt(f.kg)]);
    fila(["", "", "", "", `Subtotal ${g.remitos.size} remito${g.remitos.size === 1 ? "" : "s"}`, "", fmt(g.cantidad), fmt(g.kg)], { bold: true, fondo: [246, 248, 246] });
    y += 3;
  }
  fila(["", "", "", "", "TOTAL GENERAL", "", fmt(totU), fmt(totK)], { bold: true, color: 255, fondo: VERDE, h: 6.5 });
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, H - 7);
    doc.text(`Página ${p} de ${n}`, W - M, H - 7, { align: "right" });
  }
  descargarBlob(doc.output("blob"), `entregas_${desde || "inicio"}_a_${hasta || "hoy"}.pdf`);
}
