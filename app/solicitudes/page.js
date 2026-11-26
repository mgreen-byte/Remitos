"use client";
// Solicitante: pedidos de unidad de su área (movimientos internos) con su estado y la unidad asignada.
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import RecorridoInterno from "@/components/RecorridoInterno";
import { supabase } from "@/lib/supabaseClient";
import { fmtFecha, fmtDocChofer, friendlyError } from "@/lib/util";
import { estadoInterno, ESTADOS_INTERNO, nombrePunto, lugarTexto, cargaTexto, horaTexto, ultimoCambioInterno } from "@/lib/pedidosInternos";

export default function SolicitudesPage() {
  return <AuthGuard roles={["solicitante", "admin"]}>{(profile) => <Solicitudes profile={profile} />}</AuthGuard>;
}

const GRUPOS = [
  ["curso", "En curso", (e) => !["finalizado", "cancelado"].includes(e)],
  ["finalizado", "Finalizados", (e) => e === "finalizado"],
  ["cancelado", "Cancelados", (e) => e === "cancelado"],
];

function Solicitudes({ profile }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState(null);
  const [grupo, setGrupo] = useState("curso");
  const [ver, setVer] = useState(null);
  const [cancelar, setCancelar] = useState(null); // { id, motivo }
  const [visto] = useState(() => { try { return localStorage.getItem("solicitudesVisto") || ""; } catch { return ""; } });

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("pedidos_internos_lista");
    setCargando(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setLista(data || []);
    try { localStorage.setItem("solicitudesVisto", new Date().toISOString()); } catch {}
  }, []);
  useEffect(() => {
    cargar();
    const ok = new URLSearchParams(window.location.search).get("ok");
    if (ok) setMsg({ tipo: "ok", texto: `Pedido guardado: ${ok}. Logística lo va a confirmar y asignar.` });
  }, [cargar]);

  const conEstado = useMemo(() => lista.map((x) => ({ x, e: estadoInterno(x) })), [lista]);
  const visibles = conEstado.filter(({ e }) => GRUPOS.find((g) => g[0] === grupo)[2](e)).sort((a, b) => String(a.x.fecha_carga).localeCompare(String(b.x.fecha_carga)) * (grupo === "curso" ? 1 : -1));
  const cuenta = (k) => conEstado.filter(({ e }) => e === k).length;

  const confirmarCancelacion = async () => {
    const { error } = await supabase.rpc("cancelar_pedido_interno", { p_id: cancelar.id, p_motivo: cancelar.motivo || "" });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setCancelar(null);
    setMsg({ tipo: "ok", texto: "Pedido cancelado." });
    cargar();
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Mis pedidos de unidad</h1>
            <p className="text-stone-500 text-[13px]">Los pedidos de tu área. Los podés modificar o cancelar hasta que Logística los asigna a un transporte.</p>
          </div>
          <a href="/pedido-interno" className="ml-auto px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium">+ Nuevo pedido</a>
        </header>
        {msg && <div className={`text-sm rounded p-3 border ${msg.tipo === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>{msg.texto}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[["pendiente", "Por confirmar"], ["confirmado", "Buscando transporte"], ["programado", "Programados"], ["en_ejecucion", "En viaje"]].map(([k, t]) => (
            <div key={k} className="rounded-lg border border-stone-200 bg-white px-3 py-2.5">
              <div className="text-[24px] leading-none font-semibold text-stone-800">{k === "confirmado" ? cuenta("confirmado") + cuenta("asignado") + cuenta("rechazado") + cuenta("falta_unidad") : cuenta(k)}</div>
              <div className="text-[12.5px] text-stone-600 mt-1">{t}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-1 flex-wrap">
          {GRUPOS.map(([k, t, f]) => (
            <button key={k} onClick={() => setGrupo(k)} className={`px-3 py-1.5 rounded text-[13px] border ${grupo === k ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300"}`}>
              {t} ({conEstado.filter(({ e }) => f(e)).length})
            </button>
          ))}
        </div>

        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !visibles.length && <div className="panel p-5 text-sm text-stone-500">No hay pedidos acá.</div>}
        <div className="space-y-3">
          {visibles.map(({ x, e }) => {
            const [et, cls] = ESTADOS_INTERNO[e];
            const nuevo = visto && ultimoCambioInterno(x) > visto;
            return (
              <div key={x.id} className="panel p-3 sm:p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-[15px]">{x.numero}</span>
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{et}</span>
                  {nuevo && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-sky-600 text-white">cambió</span>}
                  {x.grupo_total > 1 && <span className="text-[12px] text-stone-500">camión {x.grupo_n} de {x.grupo_total}</span>}
                  <span className="text-[13px] text-stone-700">Carga: <b>{fmtFecha(x.fecha_carga)}{horaTexto(x)}</b></span>
                </div>
                <div className="text-[13.5px]"><b>{nombrePunto(x.carga)}</b> <span className="text-stone-500">({lugarTexto(x.carga)})</span>{(x.paradas || []).length > 0 && <span className="text-stone-500"> → {x.paradas.length} parada(s)</span>} <span className="text-stone-400">→</span> <b>{nombrePunto(x.descarga)}</b> <span className="text-stone-500">({lugarTexto(x.descarga)})</span></div>
                <div className="text-[12.5px] text-stone-600">{cargaTexto(x)}{x.solicitante_nombre ? ` · pidió ${x.solicitante_nombre}` : ""}</div>
                {(x.pedido_transporte || x.chasis) && e !== "cancelado" && (
                  <div className="text-[13px] text-emerald-800">Transporte: <b>{x.pedido_transporte || x.transporte}</b>{x.chasis ? ` · ${x.chofer?.nombre || "—"}${x.chofer?.dni ? ` (${fmtDocChofer(x.chofer.dni)})` : ""} · ${x.chasis}${x.acoplado ? " / " + x.acoplado : ""}` : " · unidad a confirmar"}</div>
                )}
                {e === "finalizado" && (x.remito || x.cpe || x.kg_descargados) && <div className="text-[12.5px] text-stone-600">{[x.remito && `Remito ${x.remito}`, x.cpe && `CPE ${x.cpe}`, x.kg_descargados && `${x.kg_descargados} kg descargados`].filter(Boolean).join(" · ")}</div>}
                {e === "cancelado" && <div className="text-[12.5px] text-stone-500">Cancelado por {x.cancelado_por_nombre}: {x.motivo_cancelacion}</div>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {x.editable && <a href={`/pedido-interno?id=${x.id}`} className="px-3 py-1.5 rounded-md border border-stone-300 bg-white text-[13px]">Modificar</a>}
                  {x.editable && <button onClick={() => setCancelar({ id: x.id, motivo: "" })} className="px-3 py-1.5 rounded-md border border-stone-300 bg-white text-[13px] text-red-700">Cancelar pedido</button>}
                  <button onClick={() => setVer(ver === x.id ? null : x.id)} className="px-2 py-1.5 text-[13px] text-sky-700 underline">{ver === x.id ? "Ocultar recorrido" : "Ver recorrido"}</button>
                </div>
                {cancelar?.id === x.id && (
                  <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2">
                    <label className="block text-[12px] font-medium text-stone-600">Motivo de la cancelación</label>
                    <input value={cancelar.motivo} onChange={(ev) => setCancelar({ ...cancelar, motivo: ev.target.value })} className="w-full border border-stone-300 rounded-md px-3 py-2 text-sm bg-white" />
                    <div className="flex gap-2">
                      <button onClick={confirmarCancelacion} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-[13px]">Cancelar el pedido</button>
                      <button onClick={() => setCancelar(null)} className="px-3 py-1.5 text-[13px] text-stone-500">Volver</button>
                    </div>
                  </div>
                )}
                {ver === x.id && <RecorridoInterno pi={x} onCerrar={() => setVer(null)} />}
              </div>
            );
          })}
        </div>
      </div>
    </NavBar>
  );
}
