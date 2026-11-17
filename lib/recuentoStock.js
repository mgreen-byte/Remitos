// Planilla de recuento físico del stock de una planta (PDF o Excel).
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";
import { nombreConPresentacion } from "./util";

const EMPRESA = { ms: "MS Technologies", stine: "Stine Seed" };
const fmt = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
const ahora = () => new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const nomArchivo = (planta) => `recuento-stock-${String(planta?.nombre || "planta").replace(/[^A-Za-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}`;

// Grupos por producto (con stock) y, al final, los lotes en cero.
function armar(lotes, incluirPallets) {
  const nombre = (l) => nombreConPresentacion(l.producto?.nombre, l.producto?.presentacion) || "—";
  const ls = lotes
    .filter((l) => incluirPallets || !(l.lote === "PALLETS" && l.producto?.por_pallets))
    .sort((a, b) => nombre(a).localeCompare(nombre(b), "es") || String(a.lote).localeCompare(String(b.lote), "es", { numeric: true }));
  const conStock = ls.filter((l) => Number(l.stock) > 0);
  const enCero = ls.filter((l) => !(Number(l.stock) > 0));
  const grupos = [];
  for (const l of conStock) {
    const n = nombre(l);
    let g = grupos[grupos.length - 1];
    if (!g || g.producto !== n) { g = { producto: n, lotes: [] }; grupos.push(g); }
    g.lotes.push(l);
  }
  return { grupos, enCero, nombre, total: conStock.reduce((a, l) => a + Number(l.stock), 0), totalDan: conStock.reduce((a, l) => a + Number(l.danado || 0), 0) };
}

export async function recuentoExcel({ planta, lotes, incluirPallets }) {
  const XLSX = await import("xlsx");
  const { grupos, enCero, nombre, total, totalDan } = armar(lotes, incluirPallets);
  const aoa = [
    [`Planilla de recuento de stock — ${planta?.nombre || ""}${EMPRESA[planta?.empresa] ? ` (${EMPRESA[planta.empresa]})` : ""}`],
    [`Emitida: ${ahora()}`, "", "", "", "Contó:", ""],
    ["Stock = lo que dice el sistema (incluye las dañadas). Completá Stock físico con lo contado: la diferencia se calcula sola (físico − stock)."],
    [],
    ["Producto / variedad", "Lote", "Stock (sistema)", "Dañadas", "Stock físico", "Diferencia"],
  ];
  const fDif = [];
  const filaLote = (l) => { aoa.push([nombre(l), l.lote, Number(l.stock), Number(l.danado || 0) || null, null, null]); fDif.push(aoa.length); };
  const subt = [];
  for (const g of grupos) {
    const desde = aoa.length + 1;
    g.lotes.forEach(filaLote);
    const hasta = aoa.length;
    aoa.push([`Subtotal ${g.producto}`, "", { f: `SUM(C${desde}:C${hasta})` }, { f: `SUM(D${desde}:D${hasta})` }, { f: `IF(COUNT(E${desde}:E${hasta})=0,"",SUM(E${desde}:E${hasta}))` }, { f: `IF(E${aoa.length + 1}="","",E${aoa.length + 1}-C${aoa.length + 1})` }]);
    subt.push(aoa.length);
  }
  aoa.push(["TOTAL", "", { f: subt.map((r) => `C${r}`).join("+") || "0" }, { f: subt.map((r) => `D${r}`).join("+") || "0" }, { f: subt.length ? `IF(COUNT(${subt.map((r) => `E${r}`).join(",")})=0,"",SUM(${subt.map((r) => `E${r}`).join(",")}))` : '""' }, null]);
  const filaTot = aoa.length;
  aoa[filaTot - 1][5] = { f: `IF(E${filaTot}="","",E${filaTot}-C${filaTot})` };
  if (enCero.length) {
    aoa.push([]);
    aoa.push(["LOTES EN CERO (el sistema no tiene stock: anotá si aparece mercadería)"]);
    enCero.forEach(filaLote);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r.map((c) => (c && typeof c === "object" && c.f ? null : c))));
  // fórmulas
  aoa.forEach((r, i) => r.forEach((c, j) => { if (c && typeof c === "object" && c.f) ws[XLSX.utils.encode_cell({ r: i, c: j })] = { t: "n", f: c.f }; }));
  fDif.forEach((r) => { ws[`F${r}`] = { t: "n", f: `IF(E${r}="","",E${r}-C${r})` }; });
  ws["!cols"] = [{ wch: 44 }, { wch: 24 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recuento");
  XLSX.writeFile(wb, `${nomArchivo(planta)}.xlsx`);
  return { total, totalDan };
}

export async function recuentoPdf({ planta, lotes, incluirPallets }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 12;
  const VERDE = [22, 101, 52], GRIS = [110, 110, 110], NEGRO = [30, 30, 30];
  const { grupos, enCero, nombre, total, totalDan } = armar(lotes, incluirPallets);
  const cols = [["Producto / variedad", 70, "l"], ["Lote", 42, "l"], ["Stock", 18, "r"], ["Dañadas", 16, "r"], ["Stock físico", 20, "c"], ["Diferencia", 20, "c"]];
  let y = M, pag = 1;
  const encabezado = async (primera) => {
    if (primera) {
      const lw = await dibujarLogo(doc, planta?.empresa, M, y - 1, 10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...VERDE);
      doc.text("Planilla de recuento de stock", M + (lw ? lw + 5 : 0), y + 5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
      doc.text(`${planta?.nombre || ""}${EMPRESA[planta?.empresa] ? " · " + EMPRESA[planta.empresa] : ""} · emitida ${ahora()}`, M + (lw ? lw + 5 : 0), y + 10);
      y += 16;
      doc.setFontSize(8.5);
      doc.text("Stock = lo que dice el sistema (incluye las dañadas). Completar Stock físico con lo contado y Diferencia = físico - stock.", M, y);
      y += 5;
    }
    let x = M;
    doc.setFillColor(240, 244, 241); doc.rect(M, y, W - 2 * M, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...NEGRO);
    cols.forEach(([t, w, a]) => { doc.text(t, a === "r" ? x + w - 1.5 : a === "c" ? x + w / 2 : x + 1.5, y + 4.8, a === "l" ? undefined : { align: a === "r" ? "right" : "center" }); x += w; });
    y += 7;
  };
  const salto = async (h) => { if (y + h > H - 30) { doc.addPage(); pag++; y = M; await encabezado(false); } };
  const fila = async (vals, { negrita = false, fondo = null, casillas = true } = {}) => {
    const prod = doc.splitTextToSize(String(vals[0]), cols[0][1] - 3);
    const h = Math.max(7, 3 + prod.length * 4);
    await salto(h);
    if (fondo) { doc.setFillColor(...fondo); doc.rect(M, y, W - 2 * M, h, "F"); }
    doc.setFont("helvetica", negrita ? "bold" : "normal"); doc.setFontSize(9); doc.setTextColor(...NEGRO);
    let x = M;
    cols.forEach(([, w, a], k) => {
      const v = k === 0 ? prod : String(vals[k] ?? "");
      if (k === 0) doc.text(v, x + 1.5, y + 4.6);
      else if (v) doc.text(v, a === "r" ? x + w - 1.5 : x + 1.5, y + 4.6, a === "r" ? { align: "right" } : undefined);
      if (casillas && k >= 4) { doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.25); doc.rect(x + 1.5, y + 1, w - 3, h - 2); }
      x += w;
    });
    doc.setDrawColor(225, 228, 226); doc.setLineWidth(0.2); doc.line(M, y + h, W - M, y + h);
    y += h;
  };
  await encabezado(true);
  for (const g of grupos) {
    for (const l of g.lotes) await fila([nombre(l), l.lote, fmt(l.stock), Number(l.danado) > 0 ? fmt(l.danado) : ""]);
    if (g.lotes.length > 1) await fila([`Subtotal`, "", fmt(g.lotes.reduce((a, l) => a + Number(l.stock), 0)), fmt(g.lotes.reduce((a, l) => a + Number(l.danado || 0), 0)) || ""], { negrita: true, fondo: [248, 250, 248] });
  }
  await fila(["TOTAL", "", fmt(total), totalDan ? fmt(totalDan) : ""], { negrita: true, fondo: [232, 240, 234] });
  if (enCero.length) {
    await salto(14);
    y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE);
    doc.text("LOTES EN CERO (el sistema no tiene stock: anotar si aparece mercadería)", M, y); y += 2;
    for (const l of enCero) await fila([nombre(l), l.lote, "0", ""]);
  }
  // Firmas
  await salto(26);
  y += 12;
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
  [["Contó (nombre y firma)", M], ["Controló (nombre y firma)", W / 2 + 6]].forEach(([t, x]) => {
    doc.line(x, y, x + 78, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(t, x, y + 4.5);
  });
  doc.text("Fecha del recuento: ____/____/______", M, y + 13);
  for (let i = 1; i <= pag; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...GRIS); doc.text(`Página ${i} de ${pag}`, W - M, H - 8, { align: "right" }); }
  descargarBlob(doc.output("blob"), `${nomArchivo(planta)}.pdf`);
  return { total, totalDan };
}
