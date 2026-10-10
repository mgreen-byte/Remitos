"use client";

import { useState, useEffect, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, friendlyError } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";

export default function TrasladosPage() {
  return <AuthGuard>{(profile) => <TrasladosInner profile={profile} />}</AuthGuard>;
}

function TrasladosInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const miPlanta = profile.planta?.id || null;
  const [tab, setTab] = useState("entrantes");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [panel, setPanel] = useState(null); // {id, modo:'confirmar'|'rechazar', cant:{itemId:valor}, obs, motivo}
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("remitos")
      .select("*, origen:plantas!planta_id(nombre), destino:plantas!planta_destino_id(nombre), remito_items(*)")
      .eq("tipo", "traslado")
      .eq("estado", "en_transito")
      .order("created_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setRows(data || []);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const entrantes = rows.filter((r) => esAdmin || r.planta_destino_id === miPlanta);
  const salientes = rows.filter((r) => esAdmin ? true : r.planta_id === miPlanta);
  const lista = tab === "entrantes" ? entrantes : salientes;

  const abrir = (r, modo) =>
    setPanel({
      id: r.id,
      modo,
      cant: Object.fromEntries((r.remito_items || []).map((i) => [i.id, String(i.cantidad)])),
      obs: "",
      motivo: "",
    });

  const confirmar = async (r) => {
    setBusy(true);
    setMsg({ tipo: "", texto: "" });
    const items = (r.remito_items || []).map((i) => ({ item_id: i.id, cantidad_recibida: Number(panel.cant[i.id]) }));
    const { error } = await supabase.rpc("confirmar_traslado", { p_remito_id: r.id, p_items: items, p_obs: panel.obs || null });
    setBusy(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setPanel(null);
    setMsg({ tipo: "ok", texto: `Recepción del traslado ${r.punto_venta}-${r.numero} confirmada. El stock ya está disponible en ${r.destino?.nombre}.` });
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
    cargar();
  };

  const hayDif = (r) => (r.remito_items || []).some((i) => Number(panel?.cant?.[i.id]) !== Number(i.cantidad));

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        <header>
          <h1 className="text-[22px] font-semibold text-stone-900">Traslados entre plantas</h1>
          <p className="text-stone-500 text-[13.5px]">La mercadería en tránsito sigue siendo de la empresa. Pasa al stock de la planta de destino cuando confirma la recepción.</p>
        </header>

        <div className="flex gap-1">
          {[
            ["entrantes", `Por recibir (${entrantes.length})`],
            ["salientes", `Enviados en tránsito (${salientes.length})`],
          ].map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); setPanel(null); }} className={`px-4 py-2 rounded text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300"}`}>
              {label}
            </button>
          ))}
        </div>

        {msg.texto && (
          <div className={`text-sm rounded p-3 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>
        )}

        {loading && <div className="text-sm text-stone-400">Cargando…</div>}
        {!loading && lista.length === 0 && (
          <div className="panel p-6 text-sm text-stone-400">{tab === "entrantes" ? "No hay traslados pendientes de recepción." : "No hay traslados tuyos en tránsito."}</div>
        )}

        {lista.map((r) => {
          const items = [...(r.remito_items || [])].sort((a, b) => a.orden - b.orden);
          const abierto = panel?.id === r.id;
          const puedeRecibir = tab === "entrantes";
          return (
            <section key={r.id} className="panel p-5 space-y-3">
              <div className="flex justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-stone-900">
                    Remito <span className="font-mono">{r.punto_venta}-{r.numero}</span>
                  </div>
                  <div className="text-[13px] text-stone-500">
                    {r.origen?.nombre} → <b className="text-stone-700">{r.destino?.nombre}</b> · {fmtFecha(r.fecha)} · emitido por {r.usuario_nombre}
                  </div>
                  <div className="text-[12.5px] text-stone-400">
                    {[r.transportista_nombre, r.chofer_nombre, [r.chasis, r.acoplado].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || "Sin datos de transporte"}
                  </div>
                </div>
                <span className="self-start text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">en tránsito</span>
              </div>

              <table className="w-full text-[13px]">
                <thead className="text-stone-400 text-xs">
                  <tr>
                    <th className="text-left font-normal">Producto</th>
                    <th className="text-left font-normal">Lote</th>
                    <th className="text-right font-normal">Enviado</th>
                    {puedeRecibir && abierto && panel.modo === "confirmar" && <th className="text-right font-normal pl-3">Recibido</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-t border-stone-100">
                      <td className="py-1.5">{i.descripcion}</td>
                      <td className="font-mono">{i.lote_texto}</td>
                      <td className="text-right">{fmtNum(i.cantidad)}</td>
                      {puedeRecibir && abierto && panel.modo === "confirmar" && (
                        <td className="text-right pl-3">
                          <input
                            type="number" min="0" max={i.cantidad} step="any"
                            value={panel.cant[i.id]}
                            onChange={(e) => setPanel({ ...panel, cant: { ...panel.cant, [i.id]: e.target.value } })}
                            className={`${inputCls} w-24 text-right`}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {puedeRecibir && !abierto && (
                <div className="flex gap-2">
                  <button onClick={() => abrir(r, "confirmar")} className="btn-primario">Confirmar recepción</button>
                  <button onClick={() => abrir(r, "rechazar")} className="border border-red-300 text-red-700 text-sm px-3 py-1.5 rounded">Rechazar…</button>
                </div>
              )}

              {puedeRecibir && abierto && panel.modo === "confirmar" && (
                <div className="space-y-2">
                  {hayDif(r) && (
                    <>
                      <div className="text-xs text-amber-700">Hay diferencias: lo que no llegó vuelve al stock de {r.origen?.nombre} y queda registrado. Explicá el motivo.</div>
                      <textarea value={panel.obs} onChange={(e) => setPanel({ ...panel, obs: e.target.value })} rows={2} placeholder="Motivo de la diferencia (obligatorio)" className={`${inputCls} w-full`} />
                    </>
                  )}
                  {!hayDif(r) && (
                    <textarea value={panel.obs} onChange={(e) => setPanel({ ...panel, obs: e.target.value })} rows={1} placeholder="Observaciones (opcional)" className={`${inputCls} w-full`} />
                  )}
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => confirmar(r)} className="btn-primario">{busy ? "Confirmando…" : "Confirmar"}</button>
                    <button onClick={() => setPanel(null)} className="text-sm text-stone-500">Cancelar</button>
                  </div>
                </div>
              )}

              {puedeRecibir && abierto && panel.modo === "rechazar" && (
                <div className="space-y-2">
                  <textarea value={panel.motivo} onChange={(e) => setPanel({ ...panel, motivo: e.target.value })} rows={2} placeholder="Motivo del rechazo (obligatorio)" className={`${inputCls} w-full`} />
                  <div className="text-xs text-stone-400">Todo el traslado vuelve al stock de {r.origen?.nombre}.</div>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => rechazar(r)} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded">{busy ? "Rechazando…" : "Confirmar rechazo"}</button>
                    <button onClick={() => setPanel(null)} className="text-sm text-stone-500">Cancelar</button>
                  </div>
                </div>
              )}

              {!puedeRecibir && <div className="text-xs text-stone-400">Esperando confirmación de {r.destino?.nombre}. Si fue un error, podés anularlo desde Historial mientras siga en tránsito.</div>}
            </section>
          );
        })}
      </div>
    </NavBar>
  );
}
