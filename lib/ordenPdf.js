// PDF de una orden de carga (clientes) o de traslado entre plantas. A4 horizontal, tabla con saltos de página.
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";

const fmt = (n) => Number(n || 0).toLocaleString("es-AR");
const fmtF = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

export async function descargarOrdenPdf({ orden, lineas, remitosDe = {}, nombrePlanta = () => "—", estado = "", empresa = "" }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 12;
  const esT = orden.modalidad === "traslado";
  const VERDE = [0, 157, 87], GRIS = [110, 110, 110];

  // columnas: [titulo, ancho, alineación]
  const cols = esT
    ? [["Prior.", 16, "c"], ["Producto", 92, "l"], ["Lote", 40, "l"], ["Pedido", 22, "r"], ["Remitido", 24, "r"], ["Saldo", 22, "r"], ["Remitos", 69, "l"]]
    : [["N°", 9, "c"], ["Planta", 34, "l"], ["Cliente", 72, "l"], ["Material / Variedad", 62, "l"], ["Lote", 40, "l"], ["O/V", 20, "l"], ["Cantidad", 18, "r"], ["Kg", 18, "r"]];
  const escala = (W - 2 * M) / cols.reduce((a, c) => a + c[1], 0);
  const anchos = cols.map((c) => c[1] * escala);

  // Órdenes a clientes: si la orden guardó el orden del Excel (posicion), se respeta tal cual: es el orden de carga del camión.
  const hayOrden = !esT && lineas.length > 0 && lineas.every((l) => l.posicion != null);
  const filas = [...lineas]
    .sort((a, b) => hayOrden
      ? String(a.planta_nombre).localeCompare(String(b.planta_nombre)) || a.posicion - b.posicion
      : esT
      ? (a.prioridad ?? 9999) - (b.prioridad ?? 9999) || String(a.lote_texto).localeCompare(String(b.lote_texto))
      : String(a.planta_nombre).localeCompare(String(b.planta_nombre)) || String(a.cliente).localeCompare(String(b.cliente)) || String(a.domicilio || "").localeCompare(String(b.domicilio || "")))
    .map((l, idx) => {
      const rem = (remitosDe[l.id] || []).join(", ") || "—";
      const prod = `${l.producto_texto || ""}${l.presentacion ? " · " + l.presentacion : ""}`;
      return esT
        ? [String(l.prioridad ?? "—"), prod, l.lote_texto || "", fmt(l.cantidad), fmt(l.remitido), fmt(Math.max(0, l.saldo)), rem]
        : [hayOrden ? String(idx + 1) : "—", l.planta_nombre || "", [l.cliente, [l.domicilio, l.provincia].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), prod, l.lote_texto || "sin lote", l.ov || "", fmt(l.cantidad), Number(l.kilos) > 0 ? fmt(l.kilos) : "—"];
    });

  const ped = lineas.reduce((a, l) => a + Number(l.cantidad), 0);
  const remt = lineas.reduce((a, l) => a + Number(l.remitido), 0);
  // Totalizador (como en el Excel de la orden): unidades, kg y pallets aproximados.
  // Maíz: pallets leídos del Excel. Soja: 1 pallet = 1 big bag.
  const kgTot = lineas.reduce((a, l) => a + (Number(l.kilos) || 0), 0);
  const pallets = orden.modalidad === "maiz" ? (orden.pallets_aprox != null ? fmt(orden.pallets_aprox) : "—") : fmt(ped);

  let y = M;
  // Logo de la empresa de la planta, arriba a la izquierda
  const logoW = await dibujarLogo(doc, empresa, M, M - 2, 11);
  const cabecera = (primera) => {
    if (primera) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE);
      doc.text(`${esT ? "Orden de traslado" : "Orden de carga"} ${orden.numero}`, M + (logoW ? logoW + 6 : 0), y + 6);
      y += logoW ? 13 : 10;
      // Recuadro de datos: etiqueta chica arriba, valor debajo, en columnas parejas
      const datos = [
        ["Estado", estado || "—"],
        ["Carga prevista", orden.fecha_carga ? fmtF(orden.fecha_carga) : "—"],
        ...(esT
          ? [["Origen", nombrePlanta(orden.planta_origen_id)], ["Destino", nombrePlanta(orden.planta_destino_id)]]
          : [["Planta", [...new Set(lineas.map((l) => l.planta_nombre))].join(", ") || "—"]]),
        ...(esT
          ? [["Pedido", fmt(ped)], ["Remitido", fmt(remt)], ["Saldo (u.)", fmt(Math.max(0, ped - remt))]]
          : [["Total unidades", fmt(ped)], ["Total kg", kgTot ? fmt(kgTot) : "—"], ["Pallets aprox.", pallets]]),
      ];
      const pesos = esT ? [18, 24, 40, 40, 14, 14, 16] : [18, 22, 62, 20, 20, 18];
      const k = (W - 2 * M - 8) / pesos.reduce((a, b) => a + b, 0);
      doc.setFillColor(246, 248, 246); doc.setDrawColor(205, 214, 207); doc.setLineWidth(0.3);
      doc.roundedRect(M, y, W - 2 * M, 14, 1.5, 1.5, "FD");
      let x = M + 4;
      datos.forEach(([et, v], i) => {
        const w = pesos[i] * k;
        if (i > 0) { doc.setDrawColor(215, 222, 217); doc.line(x - 2, y + 2.5, x - 2, y + 11.5); }
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
        doc.text(et.toUpperCase(), x, y + 4.8);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...(i >= datos.length - (esT ? 1 : 3) ? VERDE : [25, 25, 25]));
        doc.text(doc.splitTextToSize(String(v), w - 3)[0], x, y + 10.6);
        x += w;
      });
      y += 18;
      // Camión asignado a la orden (transportista y chofer)
      if (orden.transportista || orden.chofer || orden.chasis) {
        const tr = [
          orden.transportista?.nombre && `Transporte: ${orden.transportista.nombre}${orden.transportista.cuit ? ` (CUIT ${orden.transportista.cuit})` : ""}`,
          orden.chofer?.nombre && `Chofer: ${orden.chofer.nombre}${orden.chofer.dni ? ` (CUIL ${orden.chofer.dni})` : ""}`,
          (orden.chasis || orden.acoplado) && `Chasis ${orden.chasis || "—"} / Acoplado ${orden.acoplado || "—"}`,
        ].filter(Boolean).join("     ");
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(25, 25, 25);
        doc.text(doc.splitTextToSize(tr, W - 2 * M)[0], M, y + 1.5);
        y += 6.5;
      }
      if (hayOrden) {
        // Recordatorio de cómo se carga el camión
        doc.setFillColor(255, 247, 224); doc.setDrawColor(230, 190, 90); doc.setLineWidth(0.3);
        doc.roundedRect(M, y - 1, W - 2 * M, 11, 1.5, 1.5, "FD");
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120, 80, 0);
        doc.text("CARGAR EL CAMIÓN EN EL ORDEN DE ESTA LISTA (de arriba hacia abajo).", M + 3, y + 3.4);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.text("El renglón 1 es el ÚLTIMO destino: se carga primero, contra el pecho del camión.  El último renglón es el PRIMER destino: se carga al final, atrás.", M + 3, y + 7.6);
        y += 13;
      }
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
        const bold = (!esT && i === 2 && k === 0) || (i === cols.length - 3 - (esT ? 0 : 0) && false);
        doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(bold ? 20 : 50);
        if (!esT && i === 2 && k > 0) doc.setTextColor(...GRIS);
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
