// Pedidos internos (etapa 3): movimientos que no son entregas a clientes. Reglas y textos comunes.
import { descargarBlob } from "@/lib/remitoPdf";
import { dibujarLogo } from "./pdfLogo";
import { fmtFecha, fmtNum, fmtDocChofer } from "./util";

export const TIPOS_LUGAR = [
  { value: "campo", label: "Campo / lote" },
  { value: "deposito_terceros", label: "Depósito de terceros" },
  { value: "oficina", label: "Oficina" },
  { value: "proveedor", label: "Proveedor" },
  { value: "otro", label: "Otro" },
];
export const tipoLugarLabel = (t) => (t === "planta" ? "Planta" : TIPOS_LUGAR.find((x) => x.value === t)?.label || "");
export const LISTAS_CONTABLES = [
  { value: "departamento", label: "Departamento" },
  { value: "clase", label: "Clase" },
  { value: "subsidiaria", label: "Subsidiaria" },
  { value: "cuenta", label: "Cuenta" },
  { value: "categoria", label: "Categoría" },
];

// Estado del pedido interno, combinando la confirmación y el pedido de unidad al transporte
//  pendiente · confirmado (sin asignar) · asignado · rechazado · falta_unidad · programado · en_ejecucion · finalizado · cancelado
export function estadoInterno(pi, pu = pi?.pedido) {
  if (pi.estado === "cancelado") return "cancelado";
  if (pi.estado === "pendiente") return "pendiente";
  if (!pu) return "confirmado";
  if (pu.entrega_at) return "finalizado";
  if (pu.salida_at) return "en_ejecucion";
  if (pu.estado === "aceptado") return pu.unidad_at || pi.chasis ? "programado" : "falta_unidad";
  return pu.estado; // asignado | rechazado
}
export const ESTADOS_INTERNO = {
  pendiente: ["Por confirmar", "bg-amber-100 text-amber-800"],
  confirmado: ["Confirmado · sin transporte", "bg-orange-100 text-orange-800"],
  asignado: ["Esperando al transporte", "bg-sky-100 text-sky-800"],
  rechazado: ["Rechazado por el transporte", "bg-red-100 text-red-700"],
  falta_unidad: ["Aceptado · falta la unidad", "bg-lime-100 text-lime-800"],
  programado: ["Programado", "bg-emerald-100 text-emerald-800"],
  en_ejecucion: ["En ejecución", "bg-indigo-100 text-indigo-800"],
  finalizado: ["Finalizado", "bg-stone-200 text-stone-700"],
  cancelado: ["Cancelado", "bg-stone-200 text-stone-500 line-through"],
};

// Seguimiento del viaje para cualquier pedido de unidad (órdenes e internos)
export const etapaViaje = (pu) => (!pu ? null : pu.entrega_at ? "finalizado" : pu.salida_at ? "en_ejecucion" : null);

export const lugarTexto = (pt) => (pt ? [pt.localidad, pt.provincia].filter(Boolean).join(", ") || pt.domicilio || "" : "");
export const nombrePunto = (pt) => String(pt?.nombre || "").split("|")[0].trim();
export const puntosDe = (pi) => [
  { ...pi.carga, paso: "CARGA" },
  ...(pi.paradas || []).map((p) => ({ ...p, paso: "PARADA" })),
  { ...pi.descarga, paso: "DESCARGA" },
].filter((p) => p && p.nombre);
export const cargaTexto = (pi) => [pi.tipo_carga, pi.kg ? `${fmtNum(pi.kg)} kg` : "", pi.bolsas ? `${fmtNum(pi.bolsas)} bolsas` : "", pi.pallets ? `${fmtNum(pi.pallets)} pallets` : ""].filter(Boolean).join(" · ");
export const horaTexto = (pi) => (pi.hora ? ` ${String(pi.hora).slice(0, 5)} h` : "");

// Correo al solicitante (Logística lo abre en Outlook)
export function correoSolicitante({ pi, usuario, url }) {
  const e = estadoInterno(pi);
  const [et] = ESTADOS_INTERNO[e];
  const asunto = `Pedido de unidad ${pi.numero} – ${et}`;
  const L = ["Hola,", "", `Tu pedido ${pi.numero} (${nombrePunto(pi.carga)} → ${nombrePunto(pi.descarga)}, carga ${fmtFecha(pi.fecha_carga)}${horaTexto(pi)}) está: ${et}.`];
  if (pi.pedido_transporte || pi.transporte) L.push(`Transporte: ${pi.pedido_transporte || pi.transporte}`);
  if (pi.chofer?.nombre || pi.chasis) L.push(`Unidad: ${pi.chofer?.nombre || "—"}${pi.chofer?.dni ? ` (${fmtDocChofer(pi.chofer.dni)})` : ""} · ${pi.chasis || "—"}${pi.acoplado ? " / " + pi.acoplado : ""}`);
  if (e === "cancelado" && pi.motivo_cancelacion) L.push(`Motivo: ${pi.motivo_cancelacion}`);
  L.push("", `Lo podés seguir en la plataforma: ${url}`, "", "Saludos,", usuario);
  return { para: pi.solicitante_email || "", cc: "", asunto, cuerpo: L.join("\n") };
}

// Correo al transporte para un interno
export function correoTransporteInterno({ pi, transporte, cc, usuario, url }) {
  const asunto = `Pedido de unidad ${pi.numero} – carga ${fmtFecha(pi.fecha_carga)}${horaTexto(pi)}`;
  const L = ["Hola,", "", `Les asignamos un pedido de unidad en la plataforma: ${pi.numero} (movimiento interno).`,
    `Fecha de carga: ${fmtFecha(pi.fecha_carga)}${horaTexto(pi)}`,
    `Carga en: ${nombrePunto(pi.carga)} (${lugarTexto(pi.carga)})`,
    ...(pi.paradas || []).map((p, i) => `Parada ${i + 1}: ${nombrePunto(p)} (${lugarTexto(p)})`),
    `Descarga en: ${nombrePunto(pi.descarga)} (${lugarTexto(pi.descarga)})`,
    `Carga: ${cargaTexto(pi) || "—"}`];
  if (pi.comentarios) L.push(`Comentarios: ${pi.comentarios}`);
  L.push("", `Ingresá para verlo y aceptarlo. El chofer y las patentes los podés cargar después: ${url}`, "", "Saludos,", usuario);
  return { para: transporte?.correos_aviso || "", cc, asunto, cuerpo: L.join("\n"), nombre: transporte?.nombre };
}

// Texto para WhatsApp / mail
export function textoInterno(pi, km, link) {
  const L = [`PEDIDO DE UNIDAD ${pi.numero} (interno)`, `Carga: ${fmtFecha(pi.fecha_carga)}${horaTexto(pi)}`, `Carga: ${cargaTexto(pi) || "—"}`];
  if (km?.total != null) L.push(`Kms: ${fmtNum(Math.round(km.total))}${km.estimado ? " (estimado)" : ""}`);
  if (link) L.push(`Recorrido: ${link}`);
  L.push("");
  puntosDe(pi).forEach((p, i) => {
    L.push(`${i + 1}. ${p.paso} · ${nombrePunto(p)}`);
    if (p.domicilio || p.localidad) L.push(`   ${[p.domicilio, lugarTexto(p)].filter(Boolean).join(" - ")}`);
    if (p.contacto || p.telefono) L.push(`   Contacto: ${[p.contacto, p.telefono].filter(Boolean).join(" · ")}`);
    if (p.horario) L.push(`   Horario: ${p.horario}`);
    if (p.gps) L.push(`   Ubicación: ${/^https?:/i.test(p.gps) ? p.gps : "https://www.google.com/maps?q=" + encodeURIComponent(p.gps)}`);
  });
  if (pi.comentarios) L.push("", `Comentarios: ${pi.comentarios}`);
  return L.join("\n");
}

export async function descargarInternoPdf(pi, km, link) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14;
  const VERDE = [0, 157, 87], GRIS = [110, 110, 110], NEGRO = [35, 31, 32], AZUL = [20, 90, 160];
  let y = M;
  const logoW = await dibujarLogo(doc, "stine", M, y - 2, 12);
  const x0 = M + (logoW ? logoW + 6 : 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...VERDE); doc.text("Pedido de unidad", x0, y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...GRIS);
  doc.text(`${pi.numero} · movimiento interno${pi.area ? " · " + pi.area : ""}`, x0, y + 11.5);
  y += 18;
  const salto = (h) => { if (y + h > H - 14) { doc.addPage(); y = M; } };
  const fila = (et, v, url) => {
    doc.setFontSize(10);
    const t = doc.splitTextToSize(String(v), W - 2 * M - 46);
    salto(5 * t.length + 1);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRIS); doc.text(et, M + 4, y);
    doc.setFontSize(10);
    if (url) { doc.setTextColor(...AZUL); doc.text(t[0], M + 42, y); doc.link(M + 42, y - 3.5, doc.getTextWidth(t[0]), 5, { url }); y += 5; return; }
    doc.setTextColor(...NEGRO); doc.text(t, M + 42, y); y += 5 * t.length;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE); doc.text("DATOS DEL VIAJE", M, y); y += 6;
  fila("Fecha de carga", `${fmtFecha(pi.fecha_carga)}${horaTexto(pi)}`);
  fila("Carga", cargaTexto(pi) || "—");
  fila("Kms", km?.total != null ? `${fmtNum(Math.round(km.total))} km${km.estimado ? " (estimado)" : ""}` : "sin ubicaciones para calcular");
  if (link) fila("Ver recorrido", link, link);
  if (pi.comentarios) fila("Comentarios", pi.comentarios);
  if (pi.transporte || pi.chasis) fila("Unidad", `${pi.transporte || ""}${pi.chofer?.nombre ? " · " + pi.chofer.nombre : ""}${pi.chasis ? " · " + pi.chasis : ""}${pi.acoplado ? " / " + pi.acoplado : ""}`);
  y += 4;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...VERDE); doc.text("RECORRIDO, EN ESTE ORDEN", M, y); y += 6;
  puntosDe(pi).forEach((p, i) => {
    salto(26);
    const color = p.paso === "CARGA" ? [20, 90, 160] : p.paso === "DESCARGA" ? VERDE : [120, 120, 120];
    doc.setFillColor(...color); doc.circle(M + 3.2, y - 1.2, 3, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), M + 3.2, y + 0.1, { align: "center" });
    doc.setFontSize(10.5); doc.setTextColor(...color); doc.text(p.paso, M + 9, y);
    doc.setTextColor(...NEGRO); doc.text(` · ${nombrePunto(p)}`, M + 9 + doc.getTextWidth(p.paso), y);
    y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    const det = [[p.domicilio, lugarTexto(p)].filter(Boolean).join(" - "), (p.contacto || p.telefono) ? `Contacto: ${[p.contacto, p.telefono].filter(Boolean).join(" · ")}` : "", p.horario ? `Horario: ${p.horario}` : ""].filter(Boolean);
    det.forEach((d) => { const t = doc.splitTextToSize(d, W - 2 * M - 10); doc.setTextColor(...GRIS); doc.text(t, M + 9, y); y += 4.5 * t.length; });
    if (p.gps) {
      const u = /^https?:/i.test(p.gps) ? p.gps : "https://www.google.com/maps?q=" + encodeURIComponent(p.gps);
      doc.setTextColor(...AZUL); doc.text("Ver ubicación en Google Maps", M + 9, y); doc.link(M + 9, y - 3.5, doc.getTextWidth("Ver ubicación en Google Maps"), 5, { url: u }); y += 4.5;
    }
    y += 3;
  });
  descargarBlob(doc.output("blob"), `Pedido-unidad-${pi.numero}.pdf`);
}

// Último cambio visible para el solicitante (para el contador del menú)
export const ultimoCambioInterno = (x) => [x.updated_at, x.confirmado_at, x.cancelado_at, x.pedido?.asignado_at, x.pedido?.respondido_at, x.pedido?.unidad_at, x.pedido?.salida_at, x.pedido?.entrega_at]
  .filter(Boolean).map((t) => new Date(t).toISOString()).sort().pop() || "";
