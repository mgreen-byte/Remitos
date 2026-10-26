// PDF de una orden de carga (clientes) o de traslado entre plantas. A4 horizontal, tabla con saltos de página.
import { descargarBlob } from "@/lib/remitoPdf";

const fmt = (n) => Number(n || 0).toLocaleString("es-AR");
const fmtF = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

export async function descargarOrdenPdf({ orden, lineas, remitosDe = {}, nombrePlanta = () => "—", estado = "" }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 12;
  const esT = orden.modalidad === "traslado";
  const VERDE = [22, 101, 52], GRIS = [110, 110, 110];

  // columnas: [titulo, ancho, alineación]
  const cols = esT
    ? [["Prior.", 16, "c"], ["Producto", 92, "l"], ["Lote", 40, "l"], ["Pedido", 22, "r"], ["Remitido", 24, "r"], ["Saldo", 22, "r"], ["Remitos", 69, "l"]]
    : [["Planta", 30, "l"], ["Cliente", 54, "l"], ["Producto", 52, "l"], ["Lote", 32, "l"], ["O/V", 18, "l"], ["Pedido", 17, "r"], ["Remit.", 17, "r"], ["Saldo", 17, "r"], ["Remitos", 36, "l"]];
  const escala = (W - 2 * M) / cols.reduce((a, c) => a + c[1], 0);
  const anchos = cols.map((c) => c[1] * escala);

  const filas = [...lineas]
    .sort((a, b) => esT
      ? (a.prioridad ?? 9999) - (b.prioridad ?? 9999) || String(a.lote_texto).localeCompare(String(b.lote_texto))
      : String(a.planta_nombre).localeCompare(String(b.planta_nombre)) || String(a.cliente).localeCompare(String(b.cliente)))
    .map((l) => {
      const rem = (remitosDe[l.id] || []).join(", ") || "—";
      const prod = `${l.producto_texto || ""}${l.presentacion ? " · " + l.presentacion : ""}`;
      return esT
        ? [String(l.prioridad ?? "—"), prod, l.lote_texto || "", fmt(l.cantidad), fmt(l.remitido), fmt(Math.max(0, l.saldo)), rem]
        : [l.planta_nombre || "", [l.cliente, [l.domicilio, l.provincia].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), prod, l.lote_texto || "sin lote", l.ov || "", fmt(l.cantidad), fmt(l.remitido), fmt(Math.max(0, l.saldo)), rem];
    });

  const ped = lineas.reduce((a, l) => a + Number(l.cantidad), 0);
  const remt = lineas.reduce((a, l) => a + Number(l.remitido), 0);

  let y = M;
  const cabecera = (primera) => {
    if (primera) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE);
      doc.text(`${esT ? "Orden de traslado" : "Orden de carga"} ${orden.numero}`, M, y + 6);
      y += 10;
      // Recuadro de datos: etiqueta chica arriba, valor debajo, en columnas parejas
      const datos = [
        ["Estado", estado || "—"],
        ["Creada", fmtF(orden.fecha)],
        ["Carga prevista", orden.fecha_carga ? fmtF(orden.fecha_carga) : "—"],
        esT ? ["Origen → Destino", `${nombrePlanta(orden.planta_origen_id)} → ${nombrePlanta(orden.planta_destino_id)}`] : ["Planta", [...new Set(lineas.map((l) => l.planta_nombre))].join(", ") || "—"],
        ["Pedido", fmt(ped)],
        ["Remitido", fmt(remt)],
        ["Saldo (u.)", fmt(Math.max(0, ped - remt))],
      ];
      const pesos = [18, 16, 26, 52, 14, 14, 16];
      const k = (W - 2 * M - 8) / pesos.reduce((a, b) => a + b, 0);
      doc.setFillColor(246, 248, 246); doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3);
      doc.roundedRect(M, y, W - 2 * M, 14, 1.5, 1.5, "FD");
      let x = M + 4;
      datos.forEach(([et, v], i) => {
        const w = pesos[i] * k;
        if (i > 0) { doc.setDrawColor(215, 222, 217); doc.line(x - 2, y + 2.5, x - 2, y + 11.5); }
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
        doc.text(et.toUpperCase(), x, y + 4.8);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(i === 6 ? 22 : 25, i === 6 ? 101 : 25, i === 6 ? 52 : 25);
        doc.text(doc.splitTextToSize(String(v), w - 3)[0], x, y + 10.6);
        x += w;
      });
      y += 18;
    }
    doc.setFillColor(238, 242, 239); doc.rect(M, y, W - 2 * M, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(60);
    let x = M;
    cols.forEach((c, i) => {
      const tx = c[2] === "r" ? x + anchos[i] - 2 : c[2] === "c" ? x + anchos[i] / 2 : x + 2;
      doc.text(c[0], tx, y + 4.8, { align: c[2] === "r" ? "right" : c[2] === "c" ? "center" : "left" });
      x += anchos[i];
    });
    y += 7;
  };
  cabecera(true);

  doc.setFontSize(8.5);
  for (const f of filas) {
    const celdas = f.map((t, i) => doc.splitTextToSize(String(t), anchos[i] - 4));
    const n = Math.max(...celdas.map((c) => c.length));
    const h = n * 3.9 + 3;
    if (y + h > H - 14) { doc.addPage(); y = M; cabecera(false); }
    let x = M;
    celdas.forEach((c, i) => {
      const al = cols[i][2];
      c.forEach((ln, k) => {
        const bold = (!esT && i === 1 && k === 0) || (i === cols.length - 3 - (esT ? 0 : 0) && false);
        doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(bold ? 20 : 50);
        if (!esT && i === 1 && k > 0) doc.setTextColor(...GRIS);
        const tx = al === "r" ? x + anchos[i] - 2 : al === "c" ? x + anchos[i] / 2 : x + 2;
        doc.text(ln, tx, y + 4.2 + k * 3.9, { align: al === "r" ? "right" : al === "c" ? "center" : "left" });
      });
      x += anchos[i];
    });
    doc.setDrawColor(222); doc.setLineWidth(0.2); doc.line(M, y + h, W - M, y + h);
    y += h;
  }
  if (!filas.length) { doc.setTextColor(...GRIS); doc.text("La orden todavía no tiene líneas.", M + 2, y + 6); }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, M, H - 7);
    doc.text(`Página ${p} de ${n}`, W - M, H - 7, { align: "right" });
  }
  descargarBlob(doc.output("blob"), `${orden.numero}.pdf`);
}
