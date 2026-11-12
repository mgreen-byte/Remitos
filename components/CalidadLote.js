"use client";
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ESTADOS_CALIDAD, calidadInfo } from "../lib/calidad";

// Etiqueta de calidad + unidades dañadas de un lote, con panel de gestión (solo admin / logística).
export default function CalidadLote({ lote, estado, puede, onCambio, compacto }) {
  const [abierto, setAbierto] = useState(false);
  const [cant, setCant] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const info = calidadInfo(estado);
  const danado = Number(lote.danado || 0);

  const cambiar = async (nuevo) => {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("cambiar_calidad_lote", { p_producto: lote.producto_id, p_lote: lote.lote, p_estado: nuevo });
    setBusy(false);
    if (error) return setMsg(error.message);
    onCambio && onCambio();
  };
  const danio = async (accion) => {
    const n = Number(String(cant).replace(",", "."));
    if (!n || n <= 0) return setMsg("Ingresá una cantidad mayor a cero");
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("gestionar_danado", { p_lote_id: lote.id, p_accion: accion, p_cantidad: n, p_motivo: motivo });
    setBusy(false);
    if (error) return setMsg(error.message);
    setCant(""); setMotivo("");
    onCambio && onCambio();
  };

  return (
    <div className={compacto ? "inline-flex flex-wrap items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${info.cls}`}>{info.t}</span>
      {danado > 0 && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">{danado} dañado{danado === 1 ? "" : "s"}</span>}
      {puede && <button type="button" onClick={() => setAbierto(!abierto)} className="text-[12px] text-emerald-700 underline decoration-dotted">{abierto ? "Cerrar" : "Calidad"}</button>}
      {abierto && (
        <div className="basis-full bg-stone-50 border border-stone-200 rounded p-3 space-y-3 text-sm">
          <div>
            <div className="text-xs text-stone-500 mb-1">Estado de calidad del lote {lote.lote} (vale para todas las plantas)</div>
            <select disabled={busy} value={estado} onChange={(e) => cambiar(e.target.value)} className="border border-stone-300 rounded px-2 py-1.5 bg-white">
              {ESTADOS_CALIDAD.map((e) => <option key={e.v} value={e.v}>{e.t}</option>)}
            </select>
            <div className="text-[11px] text-stone-500 mt-1">Solo los lotes aprobados quedan disponibles para remitos de venta. Los traslados se permiten igual.</div>
          </div>
          <div>
            <div className="text-xs text-stone-500 mb-1">Bolsas rotas / dañadas (siguen en el stock físico, pero no se pueden despachar)</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input value={cant} onChange={(e) => setCant(e.target.value)} inputMode="decimal" placeholder="Unidades" className="border border-stone-300 rounded px-2 py-1.5 w-24 bg-white" />
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className="border border-stone-300 rounded px-2 py-1.5 flex-1 min-w-[140px] bg-white" />
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              <button disabled={busy} onClick={() => danio("registrar")} className="bg-orange-700 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">Marcar dañadas</button>
              {danado > 0 && <button disabled={busy} onClick={() => danio("recuperar")} className="text-xs text-emerald-700 underline">Recuperar (están bien)</button>}
              {danado > 0 && <button disabled={busy} onClick={() => danio("descartar")} className="text-xs text-red-700 underline">Descartar (dar de baja del stock)</button>}
            </div>
          </div>
          {msg && <div className="text-xs text-red-700">{msg}</div>}
        </div>
      )}
    </div>
  );
}
