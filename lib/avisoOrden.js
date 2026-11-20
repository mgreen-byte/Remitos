"use client";
// Aviso por correo al depósito de una orden de carga: arma el mail (Para / CC / Asunto / Texto) y lo abre en Outlook.
// Guarda una "foto" del contenido para saber si la orden cambió desde el último aviso y qué cambió.
import { fmtNum, fmtFecha, fmtDocChofer, esConsignacion } from "@/lib/util";

const nf = (n) => fmtNum(Math.round(Number(n || 0) * 100) / 100);
const destino = (l) => [l.localidad, l.provincia].filter(Boolean).join(" (") + (l.localidad && l.provincia ? ")" : "") || l.domicilio || "";

// Foto del contenido que le importa al depósito (lo que, si cambia, hay que volver a avisar)
export function fotoAviso(orden, lineas) {
  return {
    fecha: orden.fecha_carga || "",
    camion: [orden.transportista?.nombre, orden.chofer?.nombre, orden.chasis, orden.acoplado].filter(Boolean).join(" · "),
    estado: orden.estado,
    lineas: [...lineas]
      .sort((a, b) => (a.posicion ?? 9e9) - (b.posicion ?? 9e9))
      .map((l) => ({ id: l.id, cli: l.cliente || "", dest: destino(l), prod: [l.producto_texto, l.presentacion].filter(Boolean).join(" "), lote: l.lote_texto || "", cant: Number(l.cantidad) || 0, ov: l.ov || "" })),
  };
}
export const firmaAviso = (orden, lineas) => JSON.stringify(fotoAviso(orden, lineas));

// Diferencias entre el último aviso y ahora (texto corto, una por renglón)
export function cambiosAviso(anterior, actual) {
  let a;
  try { a = JSON.parse(anterior); } catch { return []; }
  if (!a?.lineas) return [];
  const out = [];
  if ((a.fecha || "") !== (actual.fecha || "")) out.push(`Fecha de carga: ${a.fecha ? fmtFecha(a.fecha) : "sin fecha"} → ${actual.fecha ? fmtFecha(actual.fecha) : "sin fecha"}`);
  if ((a.camion || "") !== (actual.camion || "")) out.push(`Camión: ${actual.camion || "sin asignar"}`);
  if (a.estado !== actual.estado && actual.estado !== "activa") out.push(`La orden quedó ${actual.estado.toUpperCase()}`);
  const prev = new Map(a.lineas.map((l) => [l.id, l]));
  for (const l of actual.lineas) {
    const p = prev.get(l.id);
    const nom = `${l.cli} · ${l.prod}`;
    if (!p) { out.push(`NUEVO: ${nom} · lote ${l.lote || "sin lote"} · ${nf(l.cant)} u.`); continue; }
    const d = [];
    if (p.cant !== l.cant) d.push(`cantidad ${nf(p.cant)} → ${nf(l.cant)}`);
    if (p.lote !== l.lote) d.push(`lote ${p.lote || "sin lote"} → ${l.lote || "sin lote"}`);
    if (p.prod !== l.prod) d.push(`producto ${p.prod} → ${l.prod}`);
    if (p.dest !== l.dest) d.push(`destino ${l.dest}`);
    if (p.cli !== l.cli) d.push(`cliente ${p.cli} → ${l.cli}`);
    if (p.ov !== l.ov) d.push(`O/V ${l.ov || "—"}`);
    if (d.length) out.push(`CAMBIA: ${nom}: ${d.join(", ")}`);
  }
  const ids = new Set(actual.lineas.map((l) => l.id));
  for (const p of a.lineas) if (!ids.has(p.id)) out.push(`SE QUITA: ${p.cli} · ${p.prod} · lote ${p.lote || "sin lote"} · ${nf(p.cant)} u.`);
  return out;
}

export function armarAviso({ orden, lineas, planta, cc, url, usuario, anterior }) {
  const foto = fotoAviso(orden, lineas);
  const cambios = anterior ? cambiosAviso(anterior.firma, foto) : [];
  const esCambio = !!anterior;
  const esT = orden.modalidad === "traslado";
  const u = lineas.reduce((a, l) => a + Number(l.cantidad || 0), 0);
  const kg = lineas.reduce((a, l) => a + Number(l.kilos || 0), 0);
  const asunto = `${esCambio ? "MODIFICACIÓN – " : ""}${esT ? "Orden de traslado" : "Orden de carga"} ${orden.numero}${orden.fecha_carga ? ` – carga ${fmtFecha(orden.fecha_carga)}` : ""} – ${planta.nombre}`;
  const L = [];
  L.push("Hola,");
  L.push("");
  if (esCambio) {
    L.push(`Se MODIFICÓ la ${esT ? "orden de traslado" : "orden de carga"} ${orden.numero} (reemplaza el aviso del ${fmtFecha(String(anterior.created_at).slice(0, 10))}).`);
    if (cambios.length) {
      L.push("");
      L.push("Cambios:");
      cambios.forEach((c) => L.push(`  • ${c}`));
    }
  } else {
    L.push(`Les enviamos la ${esT ? "orden de traslado" : "orden de carga"} ${orden.numero} para ${planta.nombre}.`);
  }
  L.push("");
  if (orden.fecha_carga) L.push(`Fecha prevista de carga: ${fmtFecha(orden.fecha_carga)}`);
  L.push(`Total: ${nf(u)} unidades${kg ? ` · ${nf(kg)} kg` : ""}${orden.pallets_aprox ? ` · ${nf(orden.pallets_aprox)} pallets aprox.` : ""}`);
  if (orden.transportista || orden.chofer || orden.chasis) {
    L.push(`Camión: ${orden.transportista?.nombre || "—"} · Chofer: ${orden.chofer?.nombre || "—"}${orden.chofer?.dni ? ` (${fmtDocChofer(orden.chofer.dni)})` : ""} · ${orden.chasis || "—"} / ${orden.acoplado || "—"}`);
  } else {
    L.push("Camión: a confirmar.");
  }
  L.push("");
  L.push(esT ? "Detalle:" : "Orden de carga del camión (el 1 se carga primero, contra el pecho del camión):");
  foto.lineas.forEach((l, i) => {
    const kgL = lineas.find((x) => x.id === l.id)?.kilos;
    L.push(`${i + 1}. ${l.cli}${l.dest ? ` – ${l.dest}` : ""}`);
    L.push(`    ${l.prod} · Lote ${l.lote || "A ASIGNAR"} · ${nf(l.cant)} u.${Number(kgL) ? ` · ${nf(kgL)} kg` : ""}${l.ov ? ` · O/V ${l.ov}` : ""}${esConsignacion(l.ov) ? " · *** EN CONSIGNACIÓN ***" : ""}`);
  });
  L.push("");
  if (url) L.push(`Ver la orden en la plataforma: ${url}`);
  L.push("");
  L.push("Saludos,");
  if (usuario) L.push(usuario);
  return { para: planta.correos_aviso || "", cc: cc || "", asunto, cuerpo: L.join("\n"), firma: JSON.stringify(foto), cambios };
}

const lista = (s) => String(s || "").split(/[;,\s]+/).filter((x) => x.includes("@")).join(";");

// Outlook de escritorio (mailto). Si el texto es muy largo, va el resumen y el detalle se pega desde el portapapeles.
export function urlOutlookApp({ para, cc, asunto, cuerpo }, corto) {
  const q = `subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(corto ?? cuerpo)}${cc ? `&cc=${encodeURIComponent(lista(cc))}` : ""}`;
  return `mailto:${lista(para)}?${q}`;
}
// Outlook en el navegador (Microsoft 365)
export function urlOutlookWeb({ para, cc, asunto, cuerpo }) {
  const p = new URLSearchParams({ to: lista(para), subject: asunto, body: cuerpo });
  if (cc) p.set("cc", lista(cc));
  return `https://outlook.office.com/mail/deeplink/compose?${p.toString().replace(/\+/g, "%20")}`;
}
export const MAILTO_MAX = 1900;
