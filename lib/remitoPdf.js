// Remito digital en PDF (copia del formulario preimpreso de MS Technologies).
// Se arma en el navegador con jsPDF (carga diferida: solo se descarga al usarlo).
// Todas las posiciones están medidas sobre el escaneo del preimpreso (1414 x 2000 px = A4); no dependen de la calibración de impresión.

const K = 210 / 1414; // px del escaneo -> mm
const px = (v) => v * K;

// Datos fijos por empresa. Por ahora solo MS Technologies.
export const EMPRESA_FISCAL = {
  ms: {
    razon: "M.S. TECHNOLOGIES ARGENTINA S.R.L.",
    cuit: "30-71546829-4",
    iibb: "30-71546829-4",
    inicio: "10/2016",
    iva: "I.V.A. RESPONSABLE INSCRIPTO",
    logo: "/logo-mst.png",
    logoRatio: 1626 / 384,
  },
};

export const COPIAS = ["ORIGINAL", "DUPLICADO", "TRIPLICADO", "CUADRUPLICADO"];

const soloDigitos = (v) => String(v ?? "").replace(/\D/g, "");
const fmtNum = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 }));
const fmtFechaCorta = (iso) => {
  const [y, m, d] = String(iso || "").slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : "";
};

// Dígito verificador del código de barras de comprobantes con CAI (ARCA): sobre los 39 dígitos anteriores.
export function digitoVerificador(base) {
  let impares = 0;
  let pares = 0;
  [...base].forEach((c, i) => (i % 2 === 0 ? (impares += Number(c)) : (pares += Number(c))));
  return (10 - ((impares * 3 + pares) % 10)) % 10;
}

// CUIT(11) + tipo comprobante(2) + punto de venta(4) + CAI(14) + vencimiento(8, AAAAMMDD) + dígito verificador.
export function codigoBarras({ cuit, tipo = "91", pv, cai, vencimiento }) {
  const v = String(vencimiento || "").slice(0, 10).replace(/-/g, "");
  const base = `${soloDigitos(cuit)}${tipo}${String(pv).padStart(4, "0")}${soloDigitos(cai)}${v}`;
  return base + digitoVerificador(base);
}

// Intercalado 2 de 5 (el de estos formularios). `digitos` debe tener cantidad par.
const ITF = ["00110", "10001", "01001", "11000", "00101", "10100", "01100", "00011", "10010", "01010"];
function barrasITF(digitos) {
  const d = digitos.length % 2 ? "0" + digitos : digitos;
  const out = [];
  const add = (anchos) => anchos.forEach((a, i) => out.push({ barra: i % 2 === 0, ancho: a }));
  add([1, 1, 1, 1]); // inicio
  for (let i = 0; i < d.length; i += 2) {
    const a = ITF[Number(d[i])];
    const b = ITF[Number(d[i + 1])];
    const seq = [];
    for (let j = 0; j < 5; j++) seq.push(a[j] === "1" ? 3 : 1, b[j] === "1" ? 3 : 1);
    add(seq);
  }
  add([3, 1, 1]); // fin
  return out;
}

async function cargarImagen(url) {
  const r = await fetch(url);
  const blob = await r.blob();
  return await new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = mal;
    fr.readAsDataURL(blob);
  });
}

// Partes de una línea con negrita para el texto vertical del costado.
const TEXTO_LATERAL = [
  ["ORIGINAL: ", false], ["CLIENTE", true], [" - DUPLICADO: ", false], ["TRIPLICADO ", false], ["TRANSPORTISTA", true],
  [" - CUADRUPLICADO: ", false], ["DEPOSITO", true], [" (Color)", false],
];

// d: datos del remito (mismo formato que RemitoSheet). Devuelve el Blob del PDF.
// opciones: { pv, numero, empresa: 'ms', domicilioFiscal, cai, caiVencimiento, imprenta: {...}, desde, hasta, leyenda }
export async function generarRemitoPdf(d, o) {
  const { jsPDF } = await import("jspdf");
  const emp = EMPRESA_FISCAL[o.empresa];
  if (!emp) throw new Error("El PDF digital todavía está disponible solo para MS Technologies.");
  const logo = await cargarImagen(emp.logo);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `Remito ${o.pv}-${o.numero}`, author: emp.razon });

  const pv4 = String(o.pv).padStart(4, "0");
  const num8 = String(o.numero).padStart(8, "0");
  const barras = codigoBarras({ cuit: emp.cuit, pv: pv4, cai: o.cai, vencimiento: o.caiVencimiento });
  const [yy, mm, dd] = String(d.fecha || "").slice(0, 10).split("-");
  const items = (d.items || []).slice(0, 15);
  const rowH = (1425 - 702) / 15; // 15 renglones iguales (px del escaneo), de arriba hacia abajo
  const conUnidad = items.some((it) => String(it.unidad || "").trim());
  const conKg = items.some((it) => Number(it.kgTotal) > 0);
  const lineasDomicilio = (o.domicilioFiscal || "").includes("|")
    ? o.domicilioFiscal.split("|").map((s) => s.trim()).filter(Boolean)
    : (o.domicilioFiscal || "").split(",").map((s) => s.trim()).filter(Boolean);
  const im = o.imprenta || {};

  const T = (txt, x, y, { size = 9, bold = false, align = "left", color = 0, maxW } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    let s = size;
    doc.setFontSize(s);
    if (maxW) {
      const w = doc.getTextWidth(String(txt));
      if (w > maxW) { s = Math.max(size * 0.6, (size * maxW) / w); doc.setFontSize(s); }
    }
    doc.setTextColor(color);
    doc.text(String(txt), x, y, { align, baseline: "alphabetic" });
  };
  const L = (x1, y1, x2, y2, w = 0.25) => { doc.setLineWidth(w); doc.setDrawColor(0); doc.line(x1, y1, x2, y2); };
  const R = (x, y, w, h, lw = 0.25) => { doc.setLineWidth(lw); doc.setDrawColor(0); doc.rect(x, y, w, h); };
  // Texto variable, ubicado sobre el renglón correspondiente (x, y en px del escaneo; y = línea de base).
  const V = (valor, x, y, ancho, { align = "left", size = 8.5, upper = true } = {}) => {
    if (valor === undefined || valor === null || valor === "") return;
    const txt = upper ? String(valor).toUpperCase() : String(valor);
    T(txt, px(x), px(y), { size, align, maxW: px(ancho) });
  };

  COPIAS.forEach((copia, idx) => {
    if (idx > 0) doc.addPage();

    // --- Encabezado ---
    const lw = px(472);
    doc.addImage(logo, "PNG", px(128), px(40), lw, lw / emp.logoRatio, undefined, "FAST");
    T(emp.razon, px(305), px(156), { size: 5.8, bold: true });
    lineasDomicilio.forEach((ln, i) => T(ln, px(365), px(200 + i * 27), { size: 10.5, align: "center" }));
    T(emp.iva, px(366), px(285), { size: 6.6, align: "center" });

    T(copia, px(702), px(62), { size: 7, bold: true, align: "center" });
    R(px(668), px(85), px(68), px(66), 0.5);
    T("R", px(702), px(138), { size: 26, bold: true, align: "center" });
    T("Código N° 91", px(702), px(170), { size: 6.5, bold: true, align: "center" });
    L(px(703), px(180), px(703), px(300), 0.35);

    T("DOCUMENTO NO VÁLIDO COMO FACTURA", px(1047), px(65), { size: 6.3, align: "center" });
    T("REMITO", px(1047), px(108), { size: 15, bold: true, align: "center" });
    T(`N° ${pv4} -`, px(830), px(153), { size: 12.5, bold: true });
    T(` ${num8}`, px(830) + doc.getTextWidth(`N° ${pv4} -`), px(153), { size: 12.5 });
    T("FECHA:", px(833), px(218), { size: 10.5 });
    R(px(947), px(180), px(305), px(57), 0.3);
    L(px(1028), px(180), px(1028), px(237), 0.25);
    L(px(1122), px(180), px(1122), px(237), 0.25);
    T(`C.U.I.T.: ${emp.cuit} - I. BRUTOS: ${emp.iibb}`, px(1047), px(270), { size: 6.2, align: "center" });
    T(`INICIO DE ACTIV..: ${emp.inicio}`, px(1047), px(288), { size: 6.2, align: "center" });

    // --- Marco y secciones ---
    R(px(110), px(300), px(1220), px(1145), 0.5);
    L(px(110), px(437), px(1330), px(437), 0.5);
    L(px(110), px(511), px(1330), px(511), 0.5);
    L(px(110), px(640), px(1330), px(640), 0.5);
    L(px(110), px(692), px(1330), px(692), 0.5);
    L(px(338), px(645), px(338), px(1445), 0.35);
    L(px(106), px(1443), px(1328), px(1443), 0.8);

    // Rótulos: la letra se ajusta para que no pise el casillero que sigue (x2 = donde empieza lo escrito).
    const lab = (t, x, y, x2) => T(t, px(x), px(y), { size: 8.6, maxW: px(x2 - x - 6) });
    lab("DESTINATARIO:", 130, 356, 275); L(px(275), px(358), px(812), px(358));
    lab("C.U.I.T.:", 843, 360, 925); L(px(925), px(362), px(1312), px(362));
    lab("DOMICILIO:", 130, 412, 243); L(px(243), px(414), px(815), px(414));
    lab("I.V.A.:", 850, 416, 907); L(px(907), px(416), px(1315), px(416));
    lab("ENTREGAR EN:", 130, 484, 255);
    lab("TRANSPORTISTA:", 130, 547, 298); L(px(298), px(550), px(915), px(550));
    lab("C.U.I.T.:", 933, 553, 1010); L(px(1010), px(554), px(1315), px(554));
    lab("DOMICILIO:", 130, 587, 237); L(px(237), px(589), px(620), px(589));
    lab("CHASIS:", 628, 590, 705); L(px(705), px(591), px(955), px(591));
    lab("ACOPLADO:", 972, 593, 1092); L(px(1092), px(594), px(1317), px(594));
    lab("NOMBRE DEL CHOFER:", 130, 628, 348); L(px(348), px(630), px(817), px(630));
    lab("C.U.I.L. / D.N.I.:", 836, 632, 972); L(px(972), px(634), px(1317), px(634));
    T("CANTIDAD", px(213), px(672), { size: 8.6, bold: true, align: "center" });
    T("DESCRIPCION", px(770), px(676), { size: 8.6, bold: true, align: "center" });

    // --- Texto vertical del costado (de abajo hacia arriba) ---
    let yy0 = px(1440);
    TEXTO_LATERAL.forEach(([t, b]) => {
      doc.setFont("helvetica", b ? "bold" : "normal");
      doc.setFontSize(7.4);
      doc.setTextColor(0);
      doc.text(t, px(95), yy0, { angle: 90 });
      yy0 -= doc.getTextWidth(t);
    });

    // --- Pie del cuadro ---
    T("TOTAL UNIDADES", px(118), px(1497), { size: 9.4, bold: true, maxW: px(205) });
    R(px(330), px(1460), px(315), px(67), 0.5);
    T("TOTAL KGS./LTS.", px(825), px(1501), { size: 9.4, bold: true, maxW: px(180) });
    R(px(1010), px(1462), px(315), px(68), 0.5);
    L(px(106), px(1532), px(1328), px(1532), 0.8);
    R(px(106), px(1548), px(1222), px(82), 0.6);
    T("OBSERVACIONES", px(118), px(1572), { size: 9.4, bold: true, maxW: px(190) });
    T("RECIBIMOS DE CONFORMIDAD LAS MERCADERIAS DETALLADAS EN EL PRESENTE DOCUMENTO.", px(708), px(1654), { size: 7.2, bold: true, align: "center" });
    [[355, "FIRMA DEPOSITO"], [715, "FIRMA TRANSPORTISTA"], [1070, "FIRMA DEL CLIENTE"]].forEach(([cx, t]) => {
      L(px(cx - 95), px(1727), px(cx + 95), px(1727), 0.2);
      T(t, px(cx), px(1743), { size: 6.4, align: "center" });
      L(px(cx - 95), px(1785), px(cx + 95), px(1785), 0.2);
      T("ACLARACION DE FIRMA", px(cx), px(1801), { size: 6.4, align: "center" });
      L(px(cx - 95), px(1838), px(cx + 95), px(1838), 0.2);
      T("DOCUMENTO IDENTIDAD", px(cx), px(1853), { size: 6.4, align: "center" });
    });

    // --- Imprenta, código de barras y CAI ---
    const [calle, ...resto] = String(im.domicilio || "").split(",").map((s) => s.trim());
    const l1 = [im.nombre, calle].filter(Boolean).join(" - ");
    const l2 = [resto.join(", "), im.cuit ? `CUIT ${im.cuit}` : "", im.habilitacion ? `HAB. MUNIC. N° ${im.habilitacion}` : ""].filter(Boolean).join(" - ");
    const l3 = `DEL ${pv4}-${String(o.desde).padStart(8, "0")} AL ${pv4}-${String(o.hasta).padStart(8, "0")}${im.fechaImpresion ? ` - IMPRESION: ${fmtFechaCorta(im.fechaImpresion)}` : ""}`;
    T(l1.toUpperCase(), px(85), px(1905), { size: 5.7, maxW: px(500) });
    T(l2.toUpperCase(), px(85), px(1921), { size: 5.7, maxW: px(500) });
    T(l3.toUpperCase(), px(85), px(1937), { size: 5.7, maxW: px(500) });

    // código de barras (ITF) entre x=612 y x=1025 px
    const seq = barrasITF(barras);
    const totalU = seq.reduce((a, s) => a + s.ancho, 0);
    const u = px(413) / totalU;
    let cx = px(612);
    doc.setFillColor(0);
    seq.forEach((s) => { if (s.barra) doc.rect(cx, px(1893), s.ancho * u, px(36), "F"); cx += s.ancho * u; });
    T(barras, px(818), px(1949), { size: 6.4, align: "center" });
    T(`C.A.I. N° ${o.cai}`, px(1052), px(1913), { size: 10.5, bold: true });
    T(`VENCIMIENTO: ${fmtFechaCorta(o.caiVencimiento)}`, px(1052), px(1940), { size: 10.5, bold: true });
    if (o.leyenda) T(o.leyenda, px(707), px(1975), { size: 6, align: "center", color: 90 });

    // --- Datos variables ---
    V(dd, 987, 218, 70, { align: "center", upper: false, size: 9.5 });
    V(mm, 1075, 218, 70, { align: "center", upper: false, size: 9.5 });
    V(yy, 1187, 218, 120, { align: "center", upper: false, size: 9.5 });
    V(d.destinatario, 285, 354, 525);
    V(soloDigitos(d.cuit), 935, 358, 375);
    V(d.domicilio, 250, 410, 560);
    V(d.iva, 915, 414, 395);
    V(d.entregarEn, 285, 484, 1030);
    V(d.transportista, 305, 548, 605);
    V(soloDigitos(d.transpCuit), 1020, 552, 290);
    V(d.transpDomicilio, 245, 587, 370);
    V(d.chasis, 712, 589, 240);
    V(d.acoplado, 1100, 592, 215);
    V(d.chofer, 355, 628, 455);
    V(soloDigitos(d.choferDni), 980, 632, 330);
    if (conUnidad) T("UNIDAD", px(352), px(676), { size: 7.4, bold: true });
    if (conKg) T("KGS", px(1318), px(676), { size: 7.4, bold: true, align: "right" });
    items.forEach((it, i) => {
      const base = 702 + i * rowH + 22;
      V(fmtNum(it.cantidad), 213, base, 110, { align: "center", upper: false });
      if (conUnidad) V(it.unidad, 352, base, 140);
      V(it.descripcion, 352 + (conUnidad ? 148 : 0), base, (conKg ? 800 : 960) - (conUnidad ? 148 : 0));
      if (Number(it.kgTotal) > 0) V(fmtNum(it.kgTotal), 1318, base, 150, { align: "right", upper: false });
    });
    V(d.ordenCarga, 352, 1432, 600, { upper: false, size: 8 });
    V(fmtNum(d.totalUnidades), 487, 1503, 300, { align: "center", upper: false, size: 9.5 });
    V(fmtNum(d.totalKgs), 1167, 1506, 300, { align: "center", upper: false, size: 9.5 });
    String(d.observaciones || "").toUpperCase().split("\n").slice(0, 3).forEach((ln, i) => V(ln, 330, 1572 + i * 26, 980, { size: 8.5 }));
  });

  return doc.output("blob");
}

export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
