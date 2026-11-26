// Pedidos de unidad (portal de transportes): reglas comunes a Logística y al portal.
import { fmtFecha, fmtNum } from "./util";

// Solo se gestionan en la plataforma las órdenes cargadas desde esta fecha (las anteriores se resolvieron por fuera).
export const PEDIDOS_DESDE = "2026-11-24T00:00:00-03:00";
export const entraEnPedidos = (o) => !!o && !o.retira_cliente && !o.pedido_desestimado_at && !!o.created_at && new Date(o.created_at) >= new Date(PEDIDOS_DESDE);

// ¿El transporte ya cargó la unidad? (chofer y patentes en la orden, del mismo transporte)
export const tieneUnidad = (p, o) => !!p && (!!p.unidad_at || (!!o?.chasis && o?.transportista_id === p.transportista_id));

// Estado para pestañas y contadores
export function estadoPedido(o, p) {
  if (o.retira_cliente) return "retira";
  if (o.pedido_desestimado_at && (!p || p.estado !== "aceptado")) return "desestimado";
  if (!p) return "sin";
  if (p.entrega_at) return "finalizado";
  if (p.salida_at) return "en_ejecucion";
  if (p.estado === "aceptado") return tieneUnidad(p, o) ? "aceptado" : "falta_unidad";
  return p.estado; // asignado | rechazado
}

// Traslados: los renglones no traen destino (es la planta de destino). Se completa con los datos de esa planta
// para que el recorrido, los km, el correo y el portal la traten como una descarga más.
export function lineasConDestino(orden, lineas = [], plantas = []) {
  if (orden?.modalidad !== "traslado") return lineas;
  const d = plantas.find((p) => p.id === orden.planta_destino_id);
  if (!d) return lineas;
  const partes = String(d.nombre || "").split("|").map((x) => x.trim());
  const localidad = partes.length > 1 ? partes[partes.length - 1] : "";
  return lineas.map((l) => ({
    ...l, cliente: d.nombre, domicilio: d.domicilio || l.domicilio || "", localidad: localidad || l.localidad || "", provincia: d.provincia || l.provincia || "",
    entregar_en: d.nombre, gps: d.gps || "", contacto: d.contacto_nombre || "", telefono: d.contacto_telefono || "",
  }));
}
export const textoRetira = (o) => (o?.modalidad === "traslado" ? "No hace falta pedir unidad (camión propio u otro)" : "Retira el cliente");

const lugar = (l) => [l.localidad, l.provincia].filter(Boolean).join(", ") || l.domicilio || "";
const corto = (n) => String(n || "").split("|")[0].replace(/^(DEP[OÓ]SITO|PLANTA|ESTANCIA)\s+/i, "").replace(/["“”]/g, "").trim();

// Resumen de la orden (pendiente de remitir si hay saldo; si no, lo pedido)
export function resumenOrden(lineasIn = [], orden = null, plantas = []) {
  const lineas = lineasConDestino(orden, lineasIn, plantas);
  const ls = lineas.filter((l) => Number(l.saldo) > 0);
  const base = ls.length ? ls : lineas;
  return {
    ls: base,
    u: base.reduce((a, l) => a + Number(ls.length ? l.saldo : l.cantidad || 0), 0),
    kg: base.reduce((a, l) => a + (Number(l.cantidad) > 0 ? (Number(l.kilos || 0) * Number(ls.length ? l.saldo : l.cantidad)) / Number(l.cantidad) : 0), 0),
    deps: [...new Set(base.map((l) => corto(l.planta_nombre)).filter(Boolean))],
    dest: [...new Set(base.map(lugar).filter(Boolean))],
    clientes: [...new Set(base.map((l) => l.cliente).filter(Boolean))],
  };
}

// Correo de aviso al transporte
export function correoPedido({ orden, lineas, plantas = [], transporte, cc, usuario, url }) {
  const r = resumenOrden(lineas, orden, plantas);
  const asunto = `Pedido de unidad ${orden.numero}${orden.fecha_carga ? ` – carga ${fmtFecha(orden.fecha_carga)}` : ""}`;
  const L = ["Hola,", "", `Les asignamos un pedido de unidad en la plataforma: ${orden.numero}${orden.modalidad === "traslado" ? " (traslado entre depósitos)" : ""}.`];
  if (orden.fecha_carga) L.push(`Fecha de carga: ${fmtFecha(orden.fecha_carga)}`);
  L.push(`Tipo de unidad: ${orden.tipo_unidad || "a definir"}`);
  L.push(`Carga en: ${r.deps.join(" / ") || "—"}`);
  L.push(`Destinos: ${r.dest.join(" / ") || "—"}`);
  L.push(`Total: ${fmtNum(r.u)} u.${r.kg ? ` · ${fmtNum(Math.round(r.kg))} kg` : ""}`);
  if (orden.observaciones_deposito) L.push(`Observaciones: ${orden.observaciones_deposito}`);
  L.push("", `Ingresá para ver el recorrido y aceptarlo. El chofer y las patentes los podés cargar después: ${url}`, "", "Saludos,", usuario);
  return { para: transporte?.correos_aviso || "", cc, asunto, cuerpo: L.join("\n"), nombre: transporte?.nombre };
}
