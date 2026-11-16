"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, friendlyError } from "@/lib/util";

// Exportación de despachos para el sistema contable (CSV) con control de lo ya exportado.
// FORMATO PROVISORIO: cuando IT confirme la plantilla, se ajustan COLUMNAS y SEPARADOR acá.
const SEPARADOR = ";";
const COLUMNAS = [
  ["DEPOSITO", (f) => f.deposito_sistema || ""],
  ["OV", (f) => f.ov || ""],
  ["ARTICULO", (f) => f.articulo_sistema || ""],
  ["LOTE", (f) => f.lote || ""],
  ["CANTIDAD", (f) => String(Number(f.unidades))],
  ["FECHA", (f) => fmtF(f.fecha)],
  ["REMITO", (f) => f.remito || ""],
];
const fmtF = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const celda = (v) => (/[";\n,]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function bajarCsv(filas, nombre) {
  const txt = [COLUMNAS.map((c) => c[0]).join(SEPARADOR), ...filas.map((f) => COLUMNAS.map((c) => celda(c[1](f))).join(SEPARADOR))].join("\r\n");
  const blob = new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function traer(params) {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await supabase.rpc("export_contable", params).range(d, d + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function ExportContable({ plantas }) {
  const [f, setF] = useState({ desde: "", hasta: "", planta: "", ver: "pendientes" });
  const [filas, setFilas] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ tipo: "", texto: "" });

  const cargarHistorial = async () => {
    const { data } = await supabase.from("exportaciones_contables").select("*").order("created_at", { ascending: false }).limit(15);
    setHistorial(data || []);
  };
  useEffect(() => { cargarHistorial(); }, []);

  const buscar = async () => {
    setBusy("buscar"); setMsg({ tipo: "", texto: "" });
    try {
      setFilas(await traer({ p_desde: f.desde || null, p_hasta: f.hasta || null, p_planta: f.planta || null, p_ver: f.ver, p_exportacion: null }));
    } catch (e) { setMsg({ tipo: "error", texto: friendlyError(e) }); }
    setBusy("");
  };

  const sinDeposito = [...new Set((filas || []).filter((x) => !x.deposito_sistema).map((x) => x.planta))];
  const sinArticulo = [...new Set((filas || []).filter((x) => !x.articulo_sistema).map((x) => x.producto))];
  const pendientes = (filas || []).filter((x) => !x.exportacion_id);
  const hayFaltantes = sinDeposito.length > 0 || sinArticulo.length > 0;
  const hoy = new Date().toISOString().slice(0, 10);

  const exportar = async () => {
    if (!pendientes.length || hayFaltantes) return;
    if (!window.confirm(`Se va a descargar el CSV con ${pendientes.length} renglón(es) y quedan marcados como exportados. ¿Seguimos?`)) return;
    setBusy("exportar"); setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("marcar_exportados", { p_items: pendientes.map((x) => x.item_id) });
    if (error) { setBusy(""); return setMsg({ tipo: "error", texto: friendlyError(error) }); }
    bajarCsv(pendientes, `despachos_sistema_${hoy}.csv`);
    setMsg({ tipo: "ok", texto: `Se exportaron ${pendientes.length} renglón(es) y quedaron marcados.` });
    setBusy("");
    await Promise.all([buscar(), cargarHistorial()]);
  };

  const rebajar = async (e) => {
    setBusy(e.id); setMsg({ tipo: "", texto: "" });
    try {
      const fs = await traer({ p_desde: null, p_hasta: null, p_planta: null, p_ver: "todos", p_exportacion: e.id });
      bajarCsv(fs, `despachos_sistema_${String(e.created_at).slice(0, 10)}_reexportado.csv`);
    } catch (err) { setMsg({ tipo: "error", texto: friendlyError(err) }); }
    setBusy("");
  };
  const deshacer = async (e) => {
    if (!window.confirm(`¿Deshacer esta exportación? Sus ${e.renglones} renglón(es) vuelven a quedar pendientes de exportar.`)) return;
    setBusy(e.id);
    const { error } = await supabase.rpc("deshacer_exportacion", { p_id: e.id });
    setBusy("");
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: "Exportación deshecha: los renglones volvieron a pendientes." });
    cargarHistorial();
    if (filas) buscar();
  };

  const inp = "border border-stone-300 rounded-md px-2.5 py-1.5 text-[13.5px] bg-white";
  const lab = "block text-[12px] text-stone-500 mb-1";
  return (
    <div className="panel p-4 space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold">Exportar despachos al sistema contable (CSV)</h2>
        <p className="text-[12.5px] text-stone-500">Despachos a clientes con O/V, un renglón por producto y lote, en unidades. Sin traslados, sin anulados y sin remitos que no tengan O/V. El depósito sale con el “Nombre en sistema contable” de la planta y el artículo con el primer alias del producto.</p>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className={lab}>Desde</label><input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={inp} /></div>
        <div><label className={lab}>Hasta</label><input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className={inp} /></div>
        <div>
          <label className={lab}>Planta</label>
          <select value={f.planta} onChange={(e) => setF({ ...f, planta: e.target.value })} className={inp}>
            <option value="">Todas</option>
            {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={lab}>Mostrar</label>
          <select value={f.ver} onChange={(e) => setF({ ...f, ver: e.target.value })} className={inp}>
            <option value="pendientes">Pendientes de exportar</option>
            <option value="exportados">Ya exportados</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <button onClick={buscar} disabled={busy === "buscar"} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50">{busy === "buscar" ? "Buscando…" : "Buscar"}</button>
      </div>

      {msg.texto && <div className={`text-sm rounded p-2 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-300 text-red-700"}`}>{msg.texto}</div>}

      {filas && (
        <>
          {hayFaltantes && (
            <div className="text-[13px] rounded p-3 border bg-amber-50 border-amber-300 text-amber-900 space-y-1">
              <b>Faltan datos para poder exportar:</b>
              {sinDeposito.length > 0 && <div>Plantas sin “Nombre en sistema contable” (Administración → Plantas): {sinDeposito.join(", ")}</div>}
              {sinArticulo.length > 0 && <div>Productos sin alias (Administración → Catálogo): {sinArticulo.join(", ")}</div>}
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-[13.5px] text-stone-700"><b>{filas.length}</b> renglón(es) · {fmtNum(filas.reduce((a, x) => a + Number(x.unidades), 0))} unidades · <b>{pendientes.length}</b> pendiente(s)</span>
            <button onClick={exportar} disabled={!pendientes.length || hayFaltantes || busy === "exportar"} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40">Descargar CSV y marcar como exportados</button>
            <button onClick={() => bajarCsv(filas, `despachos_sistema_borrador_${hoy}.csv`)} disabled={!filas.length} className="text-[13px] text-stone-600 underline disabled:opacity-40">Descargar borrador (sin marcar)</button>
          </div>
          <div className="overflow-x-auto max-h-[420px] border border-stone-200 rounded">
            <table className="w-full text-[13px]">
              <thead className="bg-stone-50 text-xs text-stone-500 sticky top-0">
                <tr>{["Fecha", "Remito", "Depósito (sistema)", "O/V", "Artículo (alias)", "Lote", "Unidades", "Estado"].map((t) => <th key={t} className={`p-2 ${t === "Unidades" ? "text-right" : "text-left"}`}>{t}</th>)}</tr>
              </thead>
              <tbody>
                {!filas.length && <tr><td colSpan={8} className="p-5 text-center text-stone-400">No hay renglones con esos filtros.</td></tr>}
                {filas.slice(0, 300).map((x) => (
                  <tr key={x.item_id} className="border-t border-stone-100">
                    <td className="p-2 whitespace-nowrap">{fmtF(x.fecha)}</td>
                    <td className="p-2 font-mono whitespace-nowrap">{x.remito}</td>
                    <td className="p-2">{x.deposito_sistema || <span className="text-red-600">falta ({x.planta})</span>}</td>
                    <td className="p-2">{x.ov}</td>
                    <td className="p-2">{x.articulo_sistema || <span className="text-red-600">falta ({x.producto})</span>}</td>
                    <td className="p-2 font-mono">{x.lote}</td>
                    <td className="p-2 text-right">{fmtNum(x.unidades)}</td>
                    <td className="p-2 text-[12px]">{x.exportacion_id ? <span className="text-stone-500">Exportado {fmtF(x.exportado_en)}</span> : <span className="text-amber-700">Pendiente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 300 && <div className="text-[12px] text-stone-500">Se muestran los primeros 300; el CSV los trae todos.</div>}
        </>
      )}

      {historial.length > 0 && (
        <div>
          <div className="text-[12px] uppercase tracking-wide text-stone-500 mb-1">Últimas exportaciones</div>
          <div className="divide-y divide-stone-100 text-[13px]">
            {historial.map((e) => (
              <div key={e.id} className="py-1.5 flex flex-wrap gap-x-4 gap-y-1 items-center">
                <span>{new Date(e.created_at).toLocaleString("es-AR")}</span>
                <span className="text-stone-500">{e.renglones} renglón(es) · {e.usuario_nombre || "—"}</span>
                <button onClick={() => rebajar(e)} disabled={busy === e.id} className="text-emerald-700 underline">Volver a descargar</button>
                <button onClick={() => deshacer(e)} disabled={busy === e.id} className="text-red-700 underline">Deshacer</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
