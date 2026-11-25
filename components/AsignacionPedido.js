"use client";
// Pedido de unidad de una orden (Admin y Logística): asignar / reasignar el transporte del portal, avisarle por Outlook,
// marcar "Retira el cliente" y cargar la unidad en nombre del transporte. Se usa en Pedidos de unidad y dentro de la orden.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BuscadorSelect from "@/components/BuscadorSelect";
import { listasTransporte } from "@/components/TransporteOrden";
import { ccAvisos } from "@/components/AvisoOrden";
import { TIPOS_UNIDAD } from "@/lib/pedidoUnidad";
import { correoPedido, estadoPedido, tieneUnidad, textoRetira } from "@/lib/pedidosPortal";
import { urlOutlookApp, urlOutlookWeb } from "@/lib/avisoOrden";
import { friendlyError, fmtDocChofer, urlBase } from "@/lib/util";

let cacheT = null;
const transportesPortal = () => {
  if (!cacheT) cacheT = supabase.from("transportistas").select("id, nombre, cuit, portal, correos_aviso").order("nombre").then(({ data }) => data || []);
  return cacheT;
};
export const ESTADOS_PEDIDO = {
  sin: ["Sin asignar", "bg-amber-100 text-amber-800"],
  asignado: ["Esperando respuesta", "bg-sky-100 text-sky-800"],
  falta_unidad: ["Aceptado · falta la unidad", "bg-lime-100 text-lime-800"],
  aceptado: ["Aceptado con unidad", "bg-emerald-100 text-emerald-800"],
  rechazado: ["Rechazado · reasignar", "bg-red-100 text-red-700"],
  retira: ["Retira el cliente / sin pedido", "bg-stone-200 text-stone-700"],
  desestimado: ["Desestimados", "bg-stone-200 text-stone-600"],
};
const pat = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fh = (x) => (x ? new Date(x).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const inp = "w-full border border-stone-300 rounded px-2 py-1.5 text-[13px] bg-white";
const btn = "text-[12.5px] px-2.5 py-1 rounded-md border";

// pedido / transportes / cc: opcionales (si no vienen, los trae). conTitulo: encabezado propio (dentro de la orden).
export default function AsignacionPedido({ orden, lineas = [], plantas = [], profile, pedido: pedidoProp, transportes: transProp, cc: ccProp, onCambio, conTitulo = false }) {
  const [pedidoLocal, setPedidoLocal] = useState(null);
  const [transLocal, setTransLocal] = useState([]);
  const [ccLocal, setCcLocal] = useState("");
  const [elegido, setElegido] = useState("");
  const [unidad, setUnidad] = useState(null); // formulario de carga de la unidad
  const [choferes, setChoferes] = useState([]);
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const propio = pedidoProp === undefined;

  const traer = useCallback(async () => {
    if (!propio) return;
    const { data } = await supabase.from("pedidos_unidad").select("*").eq("orden_id", orden.id).maybeSingle();
    setPedidoLocal(data || null);
  }, [orden.id, propio]);
  useEffect(() => { traer(); }, [traer]);
  useEffect(() => { if (!transProp) transportesPortal().then(setTransLocal); if (ccProp === undefined) ccAvisos().then(setCcLocal); }, [transProp, ccProp]);

  const p = propio ? pedidoLocal : pedidoProp;
  const transportes = transProp || transLocal;
  const cc = ccProp === undefined ? ccLocal : ccProp;
  const delPortal = transportes.filter((t) => t.portal);
  const opciones = delPortal.length ? delPortal : transportes;
  const nomT = (id) => transportes.find((t) => t.id === id)?.nombre || "—";
  const est = estadoPedido(orden, p);
  const listo = async (texto) => {
    if (texto) setMsg({ tipo: "ok", texto });
    await traer();
    onCambio && onCambio();
  };
  const rpc = async (fn, args) => {
    setMsg(null);
    setGuardando(true);
    const { error } = await supabase.rpc(fn, args);
    setGuardando(false);
    if (error) { setMsg({ tipo: "error", texto: friendlyError(error) }); return false; }
    return true;
  };

  const asignar = async () => {
    const t = elegido || (p && p.estado !== "rechazado" ? p.transportista_id : "");
    if (!t) return setMsg({ tipo: "error", texto: "Elegí el transporte." });
    if (await rpc("asignar_pedido", { p_orden: orden.id, p_transportista: t })) { setElegido(""); listo(`Asignada a ${nomT(t)}. Avisale por Outlook.`); }
  };
  const quitar = async () => { if (await rpc("quitar_pedido", { p_orden: orden.id })) listo(); };
  const desestimar = async (v) => { if (await rpc("desestimar_pedidos", { p_ordenes: [orden.id], p_valor: v })) listo(); };
  const retira = async (v) => { if (await rpc("fijar_retira_cliente", { p_orden: orden.id, p_valor: v })) listo(); };
  const avisar = async (web) => {
    const t = transportes.find((x) => x.id === p?.transportista_id);
    const m = correoPedido({ orden, lineas, plantas, transporte: t, cc, usuario: profile.nombre, url: `${urlBase()}/mis-pedidos` });
    if (!m.para) return setMsg({ tipo: "error", texto: `${m.nombre || "El transporte"} no tiene correos cargados (Pedidos de unidad → “Transportes del portal”).` });
    if (web) window.open(urlOutlookWeb(m), "_blank"); else window.location.href = urlOutlookApp(m);
    await supabase.rpc("marcar_pedido_avisado", { p_orden: orden.id });
    listo();
  };

  const abrirUnidad = async () => {
    setMsg(null);
    const mismo = orden.transportista_id === p?.transportista_id;
    const doc = mismo ? orden.chofer?.dni || "" : "";
    setUnidad({ nombre: mismo ? orden.chofer?.nombre || "" : "", doc, soloDni: /^\d{7,8}$/.test(doc), chasis: mismo ? orden.chasis || "" : "", acoplado: mismo ? orden.acoplado || "" : "", tipo: p?.tipo_equipo || orden.tipo_unidad || "" });
    const l = await listasTransporte();
    setChoferes(l.choferes);
  };
  const elegirChofer = (id) => {
    const c = choferes.find((x) => x.id === id);
    if (c) setUnidad((u) => ({ ...u, nombre: c.nombre || "", doc: c.dni || "", soloDni: /^\d{7,8}$/.test(c.dni || ""), chasis: pat(c.chasis) || u.chasis, acoplado: pat(c.acoplado) || u.acoplado }));
  };
  const guardarUnidad = async () => {
    const u = unidad;
    if (await rpc("cargar_unidad_pedido", { p_orden: orden.id, p_chofer_nombre: u.nombre, p_chofer_doc: u.doc, p_chasis: u.chasis, p_acoplado: u.acoplado, p_tipo_equipo: u.tipo })) {
      setUnidad(null);
      listo("Unidad cargada: ya quedó como camión de la orden.");
    }
  };

  const [et, cls] = ESTADOS_PEDIDO[est];
  const activa = orden.estado === "activa";

  return (
    <div className={conTitulo ? "rounded-md border border-stone-200" : ""}>
      {conTitulo && (
        <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-[13px] flex flex-wrap items-center gap-2">
          <span className="font-semibold text-stone-800">🚛 Pedido de unidad al transporte</span>
          <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{et}</span>
        </div>
      )}
      <div className={conTitulo ? "px-3 py-2.5 space-y-2" : "space-y-2"}>
        {orden.pedido_desestimado_at && !orden.retira_cliente && est === "desestimado" ? (
          <div className="text-[12.5px] text-stone-600 flex flex-wrap items-center gap-2">
            <span>Desestimado: no se pide unidad por la plataforma{orden.pedido_desestimado_por ? ` (lo marcó ${orden.pedido_desestimado_por}, ${fh(orden.pedido_desestimado_at)})` : ""}.</span>
            {activa && <button disabled={guardando} onClick={() => desestimar(false)} className="text-[12px] text-sky-700 underline">Volver a pendientes</button>}
          </div>
        ) : orden.retira_cliente ? (
          <div className="text-[12.5px] text-stone-600">{orden.modalidad === "traslado" ? "No se pide unidad para este traslado." : "El cliente retira con su transporte: no se pide unidad."} La planta completa el transporte y el chofer en el remito.</div>
        ) : (
          <>
            {p && (
              <div className="text-[12.5px] text-stone-700">
                <b>{nomT(p.transportista_id)}</b> · asignado {fh(p.asignado_at)} por {p.asignado_por_nombre}
                {p.estado !== "rechazado" && (p.avisado_at ? <span className="text-stone-500"> · avisado {fh(p.avisado_at)}</span> : <span className="text-amber-700"> · sin avisar</span>)}
                {p.estado === "aceptado" && (
                  <span className="block text-emerald-800">
                    ✓ Aceptado {fh(p.respondido_at)}
                    {tieneUnidad(p, orden)
                      ? <> · {orden.chofer?.nombre || "—"}{orden.chofer?.dni ? ` (${fmtDocChofer(orden.chofer.dni)})` : ""} · {orden.chasis || "—"} / {orden.acoplado || "—"}{p.tipo_equipo ? ` · ${p.tipo_equipo}` : ""}{p.unidad_por_nombre ? <span className="text-stone-500"> · cargó {p.unidad_por_nombre}</span> : null}</>
                      : <span className="text-lime-800"> · la unidad (chofer y patentes) todavía no está cargada</span>}
                  </span>
                )}
                {p.estado === "rechazado" && <span className="block text-red-700">✕ Rechazado {fh(p.respondido_at)}: {p.motivo_rechazo}</span>}
              </div>
            )}
            {activa && !unidad && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(!p || p.estado !== "aceptado") && (
                  <>
                    <select value={elegido || (p && p.estado === "asignado" ? p.transportista_id : "")} onChange={(e) => setElegido(e.target.value)} className="border border-stone-300 rounded-md px-2 py-1 text-[13px] bg-white">
                      <option value="">Elegir transporte…</option>
                      {opciones.filter((t) => !(p?.estado === "rechazado" && t.id === p.transportista_id)).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select>
                    <button disabled={guardando} onClick={asignar} className={`${btn} bg-emerald-700 border-emerald-700 text-white disabled:opacity-60`}>{p ? "Reasignar" : "Asignar"}</button>
                  </>
                )}
                {p && p.estado !== "rechazado" && (
                  <>
                    <button onClick={() => avisar(false)} className={`${btn} ${p.avisado_at ? "bg-white border-stone-300 text-stone-700" : "bg-sky-700 border-sky-700 text-white"}`}>{p.avisado_at ? "Volver a avisar (Outlook)" : "Avisar por Outlook"}</button>
                    <button onClick={() => avisar(true)} className={`${btn} bg-white border-stone-300 text-stone-700`}>Outlook web</button>
                  </>
                )}
                {p && p.estado !== "rechazado" && (
                  <button onClick={abrirUnidad} className={`${btn} bg-white border-emerald-600 text-emerald-800`}>{tieneUnidad(p, orden) ? "Cambiar la unidad" : "Cargar la unidad"}</button>
                )}
                {p && <button disabled={guardando} onClick={quitar} className="text-[12px] text-stone-500 underline px-1">Quitar asignación</button>}
                {(!p || p.estado !== "aceptado") && <button disabled={guardando} onClick={() => desestimar(true)} className="text-[12px] text-stone-500 underline px-1" title="Ya se resolvió por fuera (no es Retira el cliente)">Desestimar</button>}
              </div>
            )}
            {unidad && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                <div className="text-[12.5px] text-stone-600">Cargás la unidad en nombre de <b>{nomT(p?.transportista_id)}</b>. Queda como camión de la orden (la planta igual puede cambiarlo al hacer el remito).</div>
                {choferes.length > 0 && (
                  <div>
                    <label className="campo-etiqueta">Chofer ya cargado (opcional)</label>
                    <BuscadorSelect value="" onChange={elegirChofer} options={choferes.map((c) => ({ value: c.id, label: c.nombre, sub: c.dni || "", buscar: `${c.chasis || ""} ${c.acoplado || ""}` }))} placeholder="Buscar por nombre, CUIL o patente…" />
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><label className="campo-etiqueta">Chofer (nombre y apellido)</label><input value={unidad.nombre} onChange={(e) => setUnidad({ ...unidad, nombre: e.target.value.toUpperCase() })} className={inp} /></div>
                  <div>
                    <label className="campo-etiqueta">{unidad.soloDni ? "DNI del chofer" : "CUIL del chofer"}</label>
                    <input value={unidad.doc} inputMode="numeric" onChange={(e) => setUnidad({ ...unidad, doc: e.target.value.replace(/\D/g, "").slice(0, unidad.soloDni ? 8 : 11) })} placeholder={unidad.soloDni ? "7 u 8 dígitos" : "11 dígitos"} className={inp} />
                    <label className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-600"><input type="checkbox" checked={unidad.soloDni} onChange={(e) => setUnidad({ ...unidad, soloDni: e.target.checked, doc: unidad.doc.slice(0, e.target.checked ? 8 : 11) })} /> Solo tengo el DNI</label>
                  </div>
                  <div><label className="campo-etiqueta">Patente chasis</label><input value={unidad.chasis} onChange={(e) => setUnidad({ ...unidad, chasis: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                  <div><label className="campo-etiqueta">Patente acoplado</label><input value={unidad.acoplado} onChange={(e) => setUnidad({ ...unidad, acoplado: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                  <div className="sm:col-span-2">
                    <label className="campo-etiqueta">Tipo de equipo</label>
                    <select value={unidad.tipo} onChange={(e) => setUnidad({ ...unidad, tipo: e.target.value })} className={inp}>
                      <option value="">Elegir…</option>
                      {unidad.tipo && !TIPOS_UNIDAD.includes(unidad.tipo) && <option value={unidad.tipo}>{unidad.tipo}</option>}
                      {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button disabled={guardando} onClick={guardarUnidad} className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-[13px] font-medium disabled:opacity-60">{guardando ? "Guardando…" : "Guardar unidad"}</button>
                  <button onClick={() => setUnidad(null)} className="px-3 py-1.5 text-[13px] text-stone-500">Cancelar</button>
                </div>
              </div>
            )}
          </>
        )}
        {activa && est !== "desestimado" && (
          <label className={`flex items-center gap-2 text-[12.5px] ${p ? "text-stone-400" : "text-stone-700"}`} title={p ? "Primero quitá la asignación al transporte" : ""}>
            <input type="checkbox" disabled={!!p || guardando} checked={!!orden.retira_cliente} onChange={(e) => retira(e.target.checked)} />
            {orden.modalidad === "traslado" ? textoRetira(orden) : "Retira el cliente (no hace falta pedir unidad)"}{p ? " · para tildarlo, primero quitá la asignación" : ""}
          </label>
        )}
        {msg && <div className={`text-[12.5px] ${msg.tipo === "error" ? "text-red-700" : "text-emerald-700"}`}>{msg.texto}</div>}
      </div>
    </div>
  );
}
