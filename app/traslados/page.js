"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, friendlyError, norm } from "@/lib/util";

const inputCls = "border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";
const SEL = "*, origen:plantas!planta_id(nombre), destino:plantas!planta_destino_id(nombre), remito_items(*)";

export default function TrasladosPage() {
  return <AuthGuard>{(profile) => <TrasladosInner profile={profile} />}</AuthGuard>;
}

// "OC-CLA-001 · 2" si salió de una orden de traslado.
const ordenTxt = (r) => (r.orden_carga ? (r.orden_salida ? `${r.orden_carga} · ${r.orden_salida}` : r.orden_carga) : "");

function TrasladosInner({ profile }) {
  const esAdmin = profile.rol === "admin" || profile.rol === "consulta" || profile.rol === "logistica"; // ve todas las plantas
  const soloLectura = profile.rol === "consulta" || profile.rol === "logistica";
  const miPlanta = profile.planta?.id || null;
  const [tab, setTab] = useState("entrantes");
  const [rows, setRows] = useState([]); // en tránsito
  const [hist, setHist] = useState(null); // recibidos / rechazados (se cargan al abrir la pestaña)
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [panel, setPanel] = useState(null); // {id, modo:'confirmar'|'rechazar', cant:{itemId:valor}, obs, motivo}
  const [busy, setBusy] = useState(false);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [busca, setBusca] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("remitos").select(SEL).eq("tipo", "traslado").eq("estado", "en_transito").order("created_at", { ascending: false }).limit(200);
    setLoading(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setRows(data || []);
  }, []);
  const cargarHist = useCallback(async () => {
    const { data, error } = await supabase.from("remitos").select(SEL).eq("tipo", "traslado").in("estado", ["recibido", "rechazado"]).order("recibido_at", { ascending: false, nullsFirst: false }).limit(150);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setHist(data || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (tab === "recibidos" && hist === null) cargarHist(); }, [tab, hist, cargarHist]);

  const entrantes = rows.filter((r) => esAdmin || r.planta_destino_id === miPlanta);
  const salientes = rows.filter((r) => (esAdmin ? true : r.planta_id === miPlanta));
  const histMio = (hist || []).filter((r) => esAdmin || r.planta_destino_id === miPlanta || r.planta_id === miPlanta);
  const base = tab === "entrantes" ? entrantes : tab === "salientes" ? salientes : histMio;

  const lista = useMemo(() => {
    const q = norm(busca);
    if (!q) return base;
    return base.filter((r) =>
      [r.punto_venta + "-" + r.numero, r.numero, r.origen?.nombre, r.destino?.nombre, ordenTxt(r), r.transportista_nombre, r.chofer_nombre, r.chasis, r.acoplado, r.usuario_nombre,
        ...(r.remito_items || []).flatMap((i) => [i.descripcion, i.lote_texto, i.precinto])]
        .some((x) => norm(x).includes(q))
    );
  }, [base, busca]);

  const totUnid = lista.reduce((a, r) => a + Number(r.total_unidades || 0), 0);
  const totKg = lista.reduce((a, r) => a + Number(r.total_kgs || 0), 0);

  const alternar = (id) => setAbiertos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const abrirTodo = () => setAbiertos(new Set(lista.map((r) => r.id)));
  const cerrarTodo = () => { setAbiertos(new Set()); setPanel(null); };

  const abrirPanel = (r, modo) =>
    setPanel({ id: r.id, modo, cant: Object.fromEntries((r.remito_items || []).map((i) => [i.id, String(i.cantidad)])), obs: "", motivo: "" });

  const confirmar = async (r) => {
    setBusy(true);
    setMsg({ tipo: "", texto: "" });
    const items = (r.remito_items || []).map((i) => ({ item_id: i.id, cantidad_recibida: Number(panel.cant[i.id]) }));
    const { error } = await supabase.rpc("confirmar_traslado", { p_remito_id: r.id, p_items: items, p_obs: panel.obs || null });
    setBusy(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setPanel(null);
    setMsg({ tipo: "ok", texto: `Recepción del traslado ${r.punto_venta}-${r.numero} confirmada. El stock ya está disponible en ${r.destino?.nombre}.` });
    setHist(null);
    cargar();
  };

  const rechazar = async (r) => {
    setBusy(true);
    setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("rechazar_traslado", { p_remito_id: r.id, p_motivo: panel.motivo });
    setBusy(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setPanel(null);
    setMsg({ tipo: "ok", texto: `Traslado ${r.punto_venta}-${r.numero} rechazado. El stock volvió a ${r.origen?.nombre}.` });
    setHist(null);
    cargar();
  };

  const hayDif = (r) => (r.remito_items || []).some((i) => Number(panel?.cant?.[i.id]) !== Number(i.cantidad));

  const tabs = [
    ["entrantes", `Por recibir (${entrantes.length})`],
    ["salientes", `En tránsito (${salientes.length})`],
    ["recibidos", "Recibidos"],
  ];
  const enCamino = tab !== "recibidos";
  const vacio = tab === "entrantes" ? "No hay traslados pendientes de recepción." : tab === "salientes" ? "No hay traslados tuyos en tránsito." : "Todavía no hay traslados recibidos o rechazados.";

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Traslados entre plantas</h1>
          <p className="text-stone-500 text-[13px] sm:text-[13.5px]">La mercadería en tránsito sigue siendo de la empresa. Pasa al stock de la planta de destino cuando confirma la recepción.</p>
        </header>

        <div className="grid grid-cols-3 gap-1 sm:flex">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); setPanel(null); setAbiertos(new Set()); }} className={`px-2 sm:px-4 py-2.5 sm:py-2 rounded text-[13px] sm:text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-700 border-stone-300"}`}>
              {label}
            </button>
          ))}
        </div>

        {msg.texto && (
          <div className={`text-sm rounded p-3 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar remito, planta, producto, lote, orden, transporte…" className={`${inputCls} w-full sm:flex-1`} />
          <button onClick={abrirTodo} className="text-[13px] text-emerald-800 px-2 py-1.5">Abrir todo</button>
          <button onClick={cerrarTodo} className="text-[13px] text-stone-600 px-2 py-1.5">Cerrar todo</button>
        </div>

        {!loading && lista.length > 0 && (
          <div className="rounded-lg bg-stone-100 border border-stone-200 px-4 py-2.5 text-[13.5px] text-stone-700">
            {enCamino ? (
              <><b>{fmtNum(lista.length)}</b> traslado{lista.length === 1 ? "" : "s"} · <b>{fmtNum(totUnid)}</b> u. · <b>{fmtNum(totKg)}</b> kg {tab === "entrantes" ? "por recibir" : "en camino"}</>
            ) : (
              <><b>{fmtNum(lista.length)}</b> traslado{lista.length === 1 ? "" : "s"} · {lista.filter((r) => r.estado === "recibido").length} recibido{lista.filter((r) => r.estado === "recibido").length === 1 ? "" : "s"} · {lista.filter((r) => r.estado === "rechazado").length} rechazado{lista.filter((r) => r.estado === "rechazado").length === 1 ? "" : "s"} · {fmtNum(totUnid)} u. enviadas</>
            )}
          </div>
        )}

        {(loading || (tab === "recibidos" && hist === null)) && <div className="text-sm text-stone-400">Cargando…</div>}
        {!loading && !(tab === "recibidos" && hist === null) && lista.length === 0 && <div className="panel p-6 text-sm text-stone-400">{busca ? "No hay resultados para esa búsqueda." : vacio}</div>}

        {lista.map((r) => {
          const items = [...(r.remito_items || [])].sort((a, b) => a.orden - b.orden);
          const abierto = abiertos.has(r.id);
          const puedeRecibir = tab === "entrantes" && !soloLectura;
          const enPanel = panel?.id === r.id;
          const oc = ordenTxt(r);
          const badge =
            r.estado === "recibido" ? ["recibido", "bg-emerald-100 text-emerald-800"] : r.estado === "rechazado" ? ["rechazado", "bg-red-100 text-red-700"] : ["en tránsito", "bg-amber-100 text-amber-800"];
          return (
            <section key={r.id} className="panel overflow-hidden">
              <button onClick={() => alternar(r.id)} className="w-full text-left px-4 py-3 hover:bg-stone-50 flex items-start gap-3" aria-expanded={abierto}>
                <span className={`mt-1 text-stone-400 transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono font-semibold text-stone-900 text-[14px]">{r.punto_venta}-{r.numero}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded ${badge[1]}`}>{badge[0]}</span>
                    {oc && <span className="text-[11.5px] px-1.5 py-0.5 rounded border border-stone-300 text-stone-600 font-mono">{oc}</span>}
                  </span>
                  <span className="block text-[13px] text-stone-600 mt-0.5">{r.origen?.nombre} → <b className="text-stone-800">{r.destino?.nombre}</b></span>
                  <span className="block text-[12.5px] text-stone-400">{fmtFecha(r.fecha)} · {fmtNum(r.total_unidades)} u.{r.total_kgs ? ` · ${fmtNum(r.total_kgs)} kg` : ""}</span>
                </span>
              </button>

              {abierto && (
                <div className="border-t border-stone-200 px-4 py-3 space-y-3">
                  <div className="text-[12.5px] text-stone-500 space-y-0.5">
                    <div>Emitido por {r.usuario_nombre}{r.created_at ? ` · ${new Date(r.created_at).toLocaleString("es-AR")}` : ""}</div>
                    <div>{[r.transportista_nombre, r.chofer_nombre, [r.chasis, r.acoplado].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || "Sin datos de transporte"}</div>
                    {r.estado === "recibido" && <div className="text-emerald-800">Recibido por {r.recibido_por_nombre} el {r.recibido_at ? new Date(r.recibido_at).toLocaleString("es-AR") : ""}.{r.obs_recepcion ? ` Obs.: ${r.obs_recepcion}` : ""}</div>}
                    {r.estado === "rechazado" && <div className="text-red-700">Rechazado por {r.recibido_por_nombre} el {r.recibido_at ? new Date(r.recibido_at).toLocaleString("es-AR") : ""}. Motivo: {r.motivo_rechazo}. El stock volvió a {r.origen?.nombre}.</div>}
                  </div>

                  <ul className="divide-y divide-stone-100 text-[13.5px]">
                    {items.map((i) => {
                      const dif = r.estado === "recibido" && i.cantidad_recibida != null && Number(i.cantidad_recibida) !== Number(i.cantidad);
                      return (
                        <li key={i.id} className="py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0 flex-1 basis-[220px]">
                            <div className="text-stone-800">{i.descripcion}</div>
                            <div className="text-[12.5px] text-stone-500 font-mono">Lote {i.lote_texto || "—"} · Precinto {i.precinto || "—"}</div>
                          </div>
                          <div className="w-full sm:w-auto sm:text-right text-[13px] flex flex-wrap items-center justify-between sm:block gap-x-4 gap-y-1">
                            <div>Enviado <b>{fmtNum(i.cantidad)}</b></div>
                            {r.estado === "recibido" && <div className={dif ? "text-amber-700 font-medium" : "text-emerald-700"}>Recibido <b>{i.cantidad_recibida == null ? "—" : fmtNum(i.cantidad_recibida)}</b></div>}
                            {puedeRecibir && enPanel && panel.modo === "confirmar" && (
                              <label className="flex items-center justify-end gap-2 mt-1 text-stone-600">
                                Recibido
                                <input type="number" inputMode="decimal" min="0" max={i.cantidad} step="any" value={panel.cant[i.id]}
                                  onChange={(e) => setPanel({ ...panel, cant: { ...panel.cant, [i.id]: e.target.value } })} className={`${inputCls} w-24 text-right`} />
                              </label>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {puedeRecibir && !enPanel && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button onClick={() => abrirPanel(r, "confirmar")} className="btn-primario py-3 sm:py-1.5">Confirmar recepción</button>
                      <button onClick={() => abrirPanel(r, "rechazar")} className="border border-red-300 text-red-700 text-sm px-3 py-3 sm:py-1.5 rounded">Rechazar…</button>
                    </div>
                  )}

                  {puedeRecibir && enPanel && panel.modo === "confirmar" && (
                    <div className="space-y-2">
                      {hayDif(r) ? (
                        <>
                          <div className="text-xs text-amber-700">Hay diferencias: lo que no llegó vuelve al stock de {r.origen?.nombre} y queda registrado. Explicá el motivo.</div>
                          <textarea value={panel.obs} onChange={(e) => setPanel({ ...panel, obs: e.target.value })} rows={2} placeholder="Motivo de la diferencia (obligatorio)" className={`${inputCls} w-full`} />
                        </>
                      ) : (
                        <textarea value={panel.obs} onChange={(e) => setPanel({ ...panel, obs: e.target.value })} rows={1} placeholder="Observaciones (opcional)" className={`${inputCls} w-full`} />
                      )}
                      <div className="flex gap-2">
                        <button disabled={busy} onClick={() => confirmar(r)} className="btn-primario flex-1 sm:flex-none py-3 sm:py-1.5">{busy ? "Confirmando…" : "Confirmar"}</button>
                        <button onClick={() => setPanel(null)} className="text-sm text-stone-500 px-3">Cancelar</button>
                      </div>
                    </div>
                  )}

                  {puedeRecibir && enPanel && panel.modo === "rechazar" && (
                    <div className="space-y-2">
                      <textarea value={panel.motivo} onChange={(e) => setPanel({ ...panel, motivo: e.target.value })} rows={2} placeholder="Motivo del rechazo (obligatorio)" className={`${inputCls} w-full`} />
                      <div className="text-xs text-stone-400">Todo el traslado vuelve al stock de {r.origen?.nombre}.</div>
                      <div className="flex gap-2">
                        <button disabled={busy} onClick={() => rechazar(r)} className="bg-red-600 text-white text-sm px-3 py-3 sm:py-1.5 rounded flex-1 sm:flex-none">{busy ? "Rechazando…" : "Confirmar rechazo"}</button>
                        <button onClick={() => setPanel(null)} className="text-sm text-stone-500 px-3">Cancelar</button>
                      </div>
                    </div>
                  )}

                  {!puedeRecibir && r.estado === "en_transito" && (
                    <div className="text-xs text-stone-400">{soloLectura ? `Pendiente de confirmación de ${r.destino?.nombre}.` : `Esperando confirmación de ${r.destino?.nombre}. Si fue un error, podés anularlo desde Historial.`}</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </NavBar>
  );
}
