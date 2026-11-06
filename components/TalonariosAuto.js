"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtFecha, friendlyError } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";
const vacio = { planta: "", pv: "", cai: "", venc: "", leyenda: "" };

// Talonarios de autoimpresión: remito en PDF sin formulario preimpreso. Sin rango: solo CAI, vencimiento y leyenda.
export default function TalonariosAuto({ esAdmin, plantas }) {
  const [rows, setRows] = useState([]);
  const [nuevo, setNuevo] = useState(null);
  const [edit, setEdit] = useState(null); // {id, cai, venc, leyenda}
  const [baja, setBaja] = useState(null); // {id, motivo}
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [verBajas, setVerBajas] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("talonarios_autoimpresion").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const run = async (fn, texto, despues) => {
    setMsg({ tipo: "", texto: "" });
    const { error } = await fn();
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto });
    despues?.();
    cargar();
  };

  const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const dias = (v) => Math.round((new Date(v + "T00:00:00Z") - new Date(hoy + "T00:00:00Z")) / 86400000);
  const nomPlanta = (id) => plantas.find((p) => p.id === id)?.nombre || "—";
  const visibles = rows.filter((t) => verBajas || t.estado === "activo");
  if (!esAdmin && visibles.length === 0) return null;

  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-stone-800 text-[14.5px]">Autoimpresión (remito en PDF, sin formulario preimpreso)</div>
          <div className="text-[12.5px] text-stone-500">Sin rango numérico: el sistema numera solo, desde 00000001, por punto de venta. Se puede emitir sin límite hasta que venza el CAI. Si una planta tiene uno vigente, sus remitos salen en PDF; para volver al preimpreso, dalo de baja.</div>
        </div>
        {esAdmin && !nuevo && (
          <button onClick={() => setNuevo({ ...vacio, planta: plantas[0]?.id || "" })} className="btn-secundario">+ Cargar CAI de autoimpresión</button>
        )}
      </div>

      {msg.texto && <div className={`text-sm rounded p-2.5 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>}

      {nuevo && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => supabase.rpc("crear_talonario_auto", { p_planta: nuevo.planta, p_pv: nuevo.pv, p_cai: nuevo.cai, p_vencimiento: nuevo.venc, p_leyenda: nuevo.leyenda || null }), "Talonario de autoimpresión cargado.", () => setNuevo(null));
          }}
          className="border border-stone-200 rounded-lg p-4 space-y-3 bg-stone-50/50"
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-[12px] text-stone-500">Planta
              <select required value={nuevo.planta} onChange={(e) => setNuevo({ ...nuevo, planta: e.target.value })} className={`${inputCls} w-full mt-0.5`}>
                {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-stone-500">Punto de venta (nuevo)
              <input required value={nuevo.pv} onChange={(e) => setNuevo({ ...nuevo, pv: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="Ej: 0090" inputMode="numeric" className={`${inputCls} w-full mt-0.5 font-mono`} />
            </label>
            <label className="text-[12px] text-stone-500">CAI
              <input required value={nuevo.cai} onChange={(e) => setNuevo({ ...nuevo, cai: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${inputCls} w-full mt-0.5 font-mono`} />
            </label>
            <label className="text-[12px] text-stone-500">Vencimiento del CAI
              <input required type="date" value={nuevo.venc} onChange={(e) => setNuevo({ ...nuevo, venc: e.target.value })} className={`${inputCls} w-full mt-0.5`} />
            </label>
          </div>
          <label className="text-[12px] text-stone-500 block">Leyenda fiscal del pie (texto exacto que va impreso; hasta 4 renglones)
            <textarea rows={3} value={nuevo.leyenda} onChange={(e) => setNuevo({ ...nuevo, leyenda: e.target.value })} placeholder="Podés completarla después, pero no se podrá emitir hasta que esté cargada." className={`${inputCls} w-full mt-0.5`} />
          </label>
          <div className="text-[12px] text-stone-400">El punto de venta tiene que ser propio de la autoimpresión (no uno que ya tenga remitos preimpresos): arranca en 00000001.</div>
          <div className="flex gap-2">
            <button className="btn-primario">Guardar</button>
            <button type="button" onClick={() => setNuevo(null)} className="btn-secundario">Cancelar</button>
          </div>
        </form>
      )}

      {visibles.length === 0 && <div className="text-sm text-stone-400">No hay talonarios de autoimpresión cargados.</div>}
      {visibles.map((t) => {
        const d = dias(t.cai_vencimiento);
        const vencido = d < 0;
        const activo = t.estado === "activo";
        return (
          <div key={t.id} className={`border rounded-lg p-3 text-[13.5px] space-y-2 ${!activo ? "opacity-70 border-stone-200" : vencido ? "border-red-300 bg-red-50/50" : d <= 15 ? "border-amber-300 bg-amber-50/50" : "border-stone-200"}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <b>{nomPlanta(t.planta_id)}</b> · PV <span className="font-mono">{t.punto_venta}</span> · CAI <span className="font-mono">{t.cai}</span>
                <div className="text-[12.5px] text-stone-600">
                  Vence {fmtFecha(t.cai_vencimiento)}
                  {activo && (vencido ? <b className="text-red-700"> · VENCIDO: no se puede emitir</b> : d <= 15 ? <b className="text-amber-700"> · vence en {d} día(s): pedí el CAI nuevo</b> : ` · quedan ${d} días`)}
                  {!activo && ` · dado de baja${t.motivo_cierre ? `: ${t.motivo_cierre}` : ""}`}
                </div>
                {activo && !String(t.leyenda || "").trim() && <div className="text-[12.5px] text-red-700">Falta la leyenda fiscal: no se puede emitir hasta cargarla.</div>}
              </div>
              {esAdmin && activo && (
                <div className="flex gap-3 text-[13px]">
                  <button onClick={() => setEdit({ id: t.id, cai: t.cai, venc: t.cai_vencimiento, leyenda: t.leyenda || "" })} className="text-emerald-700 hover:underline">Editar</button>
                  <button onClick={() => setBaja({ id: t.id, motivo: "" })} className="text-red-700 hover:underline">Dar de baja</button>
                </div>
              )}
            </div>
            {String(t.leyenda || "").trim() && <div className="text-[12px] text-stone-500 whitespace-pre-line border-l-2 border-stone-200 pl-2">{t.leyenda}</div>}
            {edit?.id === t.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => supabase.rpc("editar_talonario_auto", { p_id: t.id, p_cai: edit.cai, p_vencimiento: edit.venc, p_leyenda: edit.leyenda }), "Cambios guardados.", () => setEdit(null));
                }}
                className="space-y-2"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <input required value={edit.cai} onChange={(e) => setEdit({ ...edit, cai: e.target.value.replace(/\D/g, "") })} className={`${inputCls} font-mono`} placeholder="CAI" />
                  <input required type="date" value={edit.venc} onChange={(e) => setEdit({ ...edit, venc: e.target.value })} className={inputCls} />
                </div>
                <textarea rows={3} value={edit.leyenda} onChange={(e) => setEdit({ ...edit, leyenda: e.target.value })} className={`${inputCls} w-full`} placeholder="Leyenda fiscal del pie" />
                <div className="text-[12px] text-stone-400">Los cambios valen para los remitos que se emitan o reimpriman desde ahora.</div>
                <div className="flex gap-2"><button className="btn-primario">Guardar</button><button type="button" onClick={() => setEdit(null)} className="btn-secundario">Cancelar</button></div>
              </form>
            )}
            {baja?.id === t.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => supabase.rpc("cerrar_talonario_auto", { p_id: t.id, p_motivo: baja.motivo }), "Talonario dado de baja.", () => setBaja(null));
                }}
                className="flex gap-2 flex-wrap items-center"
              >
                <input required value={baja.motivo} onChange={(e) => setBaja({ ...baja, motivo: e.target.value })} placeholder="Motivo (ej. CAI reemplazado)" className={`${inputCls} flex-1 min-w-[200px]`} />
                <button className="btn-primario">Confirmar baja</button>
                <button type="button" onClick={() => setBaja(null)} className="btn-secundario">Cancelar</button>
              </form>
            )}
          </div>
        );
      })}
      {rows.some((t) => t.estado !== "activo") && (
        <label className="flex items-center gap-2 text-[12.5px] text-stone-500 cursor-pointer">
          <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Ver dados de baja
        </label>
      )}
    </section>
  );
}
