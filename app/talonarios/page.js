"use client";

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, friendlyError } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";
const n8 = (n) => String(n).padStart(8, "0");
const MOTIVOS = { danado: "Dañado", extraviado: "Extraviado", otro: "Anulado en papel / otro" };

export default function TalonariosPage() {
  return <AuthGuard>{(profile) => <Inner profile={profile} />}</AuthGuard>;
}

function Inner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const [rows, setRows] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [control, setControl] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState(null);
  const [panel, setPanel] = useState(null); // {id, modo:'baja'|'extravio'|'huecos', texto, nums:[], lista:[], motivo, detalle}

  const ok = (texto) => setMsg({ tipo: "ok", texto });
  const fail = (e) => setMsg({ tipo: "error", texto: friendlyError(e) });

  const cargar = useCallback(async () => {
    setLoading(true);
    const [t, p, c] = await Promise.all([
      supabase.from("v_talonarios").select("*").order("planta").order("desde"),
      supabase.from("plantas").select("id, nombre, punto_venta").eq("activa", true).order("nombre"),
      supabase.from("configuracion").select("valor").eq("clave", "control_talonarios").maybeSingle(),
    ]);
    setLoading(false);
    if (t.error) return fail(t.error);
    setRows(t.data || []);
    setPlantas(p.data || []);
    setControl(!!c.data?.valor?.activo);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const run = async (fn, texto) => {
    setMsg({ tipo: "", texto: "" });
    const { error } = await fn();
    if (error) return fail(error);
    ok(texto);
    setPanel(null);
    setNuevo(null);
    cargar();
  };

  const crear = (e) => {
    e.preventDefault();
    run(
      () => supabase.rpc("crear_talonario", { p_planta: nuevo.planta, p_desde: Number(nuevo.desde), p_hasta: Number(nuevo.hasta), p_cai: nuevo.cai, p_vencimiento: nuevo.venc }),
      "Talonario cargado."
    );
  };

  const abrirHuecos = async (t) => {
    const { data, error } = await supabase.rpc("numeros_sin_justificar", { p_talonario: t.id });
    if (error) return fail(error);
    setPanel({ id: t.id, modo: "huecos", lista: data || [], nums: [], motivo: "danado", detalle: "" });
  };

  const justificar = () =>
    run(
      () => supabase.rpc("justificar_numeros", { p_talonario: panel.id, p_numeros: panel.nums, p_motivo: panel.motivo, p_detalle: panel.detalle || null }),
      `Se justificaron ${panel.nums.length} número(s).`
    );

  const exportar = () => {
    const filas = rows.map((t) => ({
      Planta: t.planta,
      "Punto de venta": t.punto_venta,
      Desde: n8(t.desde),
      Hasta: n8(t.hasta),
      CAI: t.cai,
      "Vence": fmtFecha(t.cai_vencimiento),
      Estado: t.estado === "cerrado" ? "dado de baja" : t.estado,
      Usados: t.usados,
      Justificados: t.justificados,
      Disponibles: t.disponibles,
      "Sin justificar": t.huecos,
      "Recepción confirmada": t.recibido_at ? `${t.recibido_por_nombre} ${fmtFecha(t.recibido_at)}` : "pendiente",
      "Motivo de baja": t.motivo_cierre || "",
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Talonarios");
    XLSX.writeFile(wb, "talonarios.xlsx");
  };

  const visibles = rows.filter((t) => (!filtro || t.planta_id === filtro) && (verTodos || t.estado === "activo"));

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-stone-900">Talonarios</h1>
            <p className="text-stone-500 text-[13.5px]">Control de los formularios preimpresos: rango, CAI y números sin usar. Se usan primero los talonarios más antiguos.</p>
          </div>
          {esAdmin && (
            <div className="flex gap-2">
              <button onClick={exportar} className="btn-secundario">Exportar Excel</button>
              <button onClick={() => setNuevo({ planta: filtro || plantas[0]?.id || "", desde: "", hasta: "", cai: "", venc: "" })} className="btn-primario">Nuevo talonario</button>
            </div>
          )}
        </header>

        {esAdmin && (
          <div className={`panel p-4 flex items-center justify-between gap-4 flex-wrap ${control ? "border-emerald-200" : "border-amber-300 bg-amber-50/60"}`}>
            <div className="text-[13px]">
              <b>{control ? "Control activado" : "Control apagado"}</b>
              <div className="text-stone-500">
                {control
                  ? "Los remitos solo se emiten con un número dentro de un talonario activo, con CAI vigente y respetando el orden."
                  : "Todavía no se exige talonario al emitir. Cargá los talonarios de todas las plantas y después activá el control."}
              </div>
            </div>
            <button
              onClick={() => {
                if (!control && !window.confirm("Al activarlo, las plantas sin talonario activo no podrán emitir remitos. ¿Cargaste los talonarios de todas?")) return;
                run(() => supabase.rpc("set_control_talonarios", { p_activo: !control }), control ? "Control apagado." : "Control activado.");
              }}
              className={control ? "btn-secundario" : "btn-primario"}
            >
              {control ? "Apagar" : "Activar control"}
            </button>
          </div>
        )}

        {msg.texto && <div className={`text-sm rounded p-3 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>}

        {nuevo && (
          <form onSubmit={crear} className="panel p-5 space-y-3">
            <div className="font-semibold text-stone-800 text-[14px]">Nuevo talonario</div>
            <div className="grid gap-3 sm:grid-cols-5">
              <select required value={nuevo.planta} onChange={(e) => setNuevo({ ...nuevo, planta: e.target.value })} className={`${inputCls} sm:col-span-2`}>
                {plantas.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} (PV {p.punto_venta})</option>
                ))}
              </select>
              <input required value={nuevo.desde} onChange={(e) => setNuevo({ ...nuevo, desde: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="Desde" inputMode="numeric" className={inputCls} />
              <input required value={nuevo.hasta} onChange={(e) => setNuevo({ ...nuevo, hasta: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="Hasta" inputMode="numeric" className={inputCls} />
              <input required value={nuevo.cai} onChange={(e) => setNuevo({ ...nuevo, cai: e.target.value.toUpperCase() })} placeholder="CAI" className={inputCls} />
              <div className="sm:col-span-2">
                <label className="campo-etiqueta">Vencimiento del CAI</label>
                <input required type="date" value={nuevo.venc} onChange={(e) => setNuevo({ ...nuevo, venc: e.target.value })} className={`${inputCls} w-full`} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primario">Cargar</button>
              <button type="button" onClick={() => setNuevo(null)} className="text-sm text-stone-500">Cancelar</button>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          {esAdmin && (
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={inputCls}>
              <option value="">Todas las plantas</option>
              {plantas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-stone-600">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver también agotados y dados de baja
          </label>
        </div>

        {loading && <div className="text-sm text-stone-400">Cargando…</div>}
        {!loading && visibles.length === 0 && <div className="panel p-6 text-sm text-stone-400">No hay talonarios para mostrar.</div>}

        {visibles.map((t) => {
          const total = t.hasta - t.desde + 1;
          const pct = Math.round(((t.usados + t.justificados) / total) * 100);
          const dias = Math.ceil((new Date(t.cai_vencimiento + "T00:00:00") - new Date()) / 86400000);
          const activo = t.estado === "activo";
          const abierto = panel?.id === t.id;
          return (
            <section key={t.id} className={`panel p-5 space-y-3 ${!activo ? "opacity-75" : ""}`}>
              <div className="flex justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-stone-900">
                    <span className="font-mono">{t.punto_venta}</span> · {n8(t.desde)} a {n8(t.hasta)} <span className="text-stone-400 font-normal">· {t.planta}</span>
                  </div>
                  <div className="text-[12.5px] text-stone-500">
                    CAI <span className="font-mono">{t.cai}</span> · vence {fmtFecha(t.cai_vencimiento)}
                    {t.vencido ? <b className="text-red-600"> · VENCIDO</b> : dias <= 15 ? <b className="text-amber-700"> · vence en {dias} día(s)</b> : null}
                  </div>
                </div>
                <div className="flex gap-1.5 self-start">
                  {t.estado === "activo" && <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">activo</span>}
                  {t.estado === "agotado" && <span className="text-xs px-2 py-0.5 rounded bg-stone-200 text-stone-700">agotado</span>}
                  {t.estado === "cerrado" && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">dado de baja</span>}
                </div>
              </div>

              <div>
                <div className="h-2 rounded bg-stone-100 overflow-hidden">
                  <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[12.5px] text-stone-500 mt-1">
                  Usados {fmtNum(t.usados)} · justificados {fmtNum(t.justificados)} · <b className="text-stone-800">quedan {fmtNum(t.disponibles)}</b> de {fmtNum(total)}
                  {t.disponibles <= 5 && activo && <b className="text-amber-700"> · pedí el próximo talonario</b>}
                </div>
              </div>

              {t.huecos > 0 && (
                <div className="text-[13px] bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 flex items-center justify-between gap-2 flex-wrap">
                  <span>{t.huecos} número(s) quedaron sin usar antes del último emitido. Se pueden usar después o justificar.</span>
                  <button onClick={() => (abierto && panel.modo === "huecos" ? setPanel(null) : abrirHuecos(t))} className="underline">
                    {abierto && panel.modo === "huecos" ? "Cerrar" : "Ver y justificar"}
                  </button>
                </div>
              )}

              {t.extravio_reportado_at && t.estado === "activo" && (
                <div className="text-[13px] bg-red-50 border border-red-200 text-red-700 rounded p-2">
                  Pérdida reportada por {t.extravio_reportado_por_nombre} el {fmtFecha(t.extravio_reportado_at)}: {t.extravio_detalle}.
                  {esAdmin ? " Corresponde darlo de baja." : " Esperando que el administrador lo dé de baja."}
                </div>
              )}
              {t.estado === "cerrado" && <div className="text-[13px] text-red-700">Baja: {t.motivo_cierre} ({t.cerrado_por_nombre}, {fmtFecha(t.cerrado_at)})</div>}

              <div className="text-[12.5px] text-stone-500">
                {t.recibido_at ? `Recepción confirmada por ${t.recibido_por_nombre} el ${fmtFecha(t.recibido_at)}.` : "Recepción pendiente de confirmar por la planta."}
              </div>

              {abierto && panel.modo === "huecos" && (
                <div className="space-y-2 border-t border-stone-100 pt-3">
                  {panel.lista.length === 0 && <div className="text-sm text-stone-400">No quedan números sin justificar.</div>}
                  <div className="flex flex-wrap gap-2">
                    {panel.lista.map((n) => (
                      <label key={n} className={`px-2 py-1 rounded border text-[12.5px] cursor-pointer font-mono ${panel.nums.includes(n) ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-stone-300"}`}>
                        <input type="checkbox" className="hidden" checked={panel.nums.includes(n)} onChange={() => setPanel({ ...panel, nums: panel.nums.includes(n) ? panel.nums.filter((x) => x !== n) : [...panel.nums, n] })} />
                        {n8(n)}
                      </label>
                    ))}
                  </div>
                  {panel.lista.length > 0 && (
                    <div className="flex gap-2 flex-wrap items-center">
                      <select value={panel.motivo} onChange={(e) => setPanel({ ...panel, motivo: e.target.value })} className={inputCls}>
                        {Object.entries(MOTIVOS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <input value={panel.detalle} onChange={(e) => setPanel({ ...panel, detalle: e.target.value })} placeholder={panel.motivo === "otro" ? "Explicá el motivo (obligatorio)" : "Detalle (opcional)"} className={`${inputCls} flex-1 min-w-[180px]`} />
                      <button disabled={!panel.nums.length} onClick={justificar} className="btn-primario">Justificar {panel.nums.length || ""}</button>
                    </div>
                  )}
                  <div className="text-xs text-stone-400">Un número justificado ya no se puede usar. Los que no marques quedan disponibles para usar más adelante.</div>
                </div>
              )}

              {abierto && (panel.modo === "baja" || panel.modo === "extravio") && (
                <div className="space-y-2 border-t border-stone-100 pt-3">
                  <textarea value={panel.texto} onChange={(e) => setPanel({ ...panel, texto: e.target.value })} rows={2} className={`${inputCls} w-full`} placeholder={panel.modo === "baja" ? "Motivo de la baja (obligatorio)" : "Contá qué pasó con el talonario (obligatorio)"} />
                  <div className="flex gap-2">
                    {panel.modo === "baja" ? (
                      <button onClick={() => run(() => supabase.rpc("cerrar_talonario", { p_id: t.id, p_motivo: panel.texto }), "Talonario dado de baja.")} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded">Confirmar baja</button>
                    ) : (
                      <button onClick={() => run(() => supabase.rpc("reportar_extravio_talonario", { p_id: t.id, p_detalle: panel.texto }), "Pérdida reportada. El administrador va a dar de baja el talonario.")} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded">Enviar reporte</button>
                    )}
                    <button onClick={() => setPanel(null)} className="text-sm text-stone-500">Cancelar</button>
                  </div>
                  {panel.modo === "baja" && <div className="text-xs text-stone-400">Los números que no se usaron dejan de poder emitirse. Los remitos ya emitidos no se tocan.</div>}
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {!t.recibido_at && t.estado !== "cerrado" && (
                  <button onClick={() => run(() => supabase.rpc("confirmar_recepcion_talonario", { p_id: t.id }), "Recepción confirmada.")} className="btn-primario">Confirmar recepción</button>
                )}
                {activo && !t.extravio_reportado_at && !abierto && (
                  <button onClick={() => setPanel({ id: t.id, modo: "extravio", texto: "" })} className="border border-stone-300 text-stone-700 text-sm px-3 py-1.5 rounded">Reportar pérdida…</button>
                )}
                {esAdmin && t.estado !== "cerrado" && !abierto && (
                  <button onClick={() => setPanel({ id: t.id, modo: "baja", texto: t.extravio_detalle || "" })} className="border border-red-300 text-red-700 text-sm px-3 py-1.5 rounded">Dar de baja…</button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </NavBar>
  );
}
