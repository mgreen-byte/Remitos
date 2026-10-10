"use client";

import { Fragment, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import RemitoSheet from "@/components/RemitoSheet";
import { supabase } from "@/lib/supabaseClient";
import { CALIBRACION_DEFAULT } from "@/lib/fieldCoords";
import { fmtNum, fmtFecha, friendlyError } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";

const ESTADO_TXT = { emitido: "emitido", anulado: "anulado", en_transito: "en tránsito", recibido: "recibido", rechazado: "rechazado" };
const ESTADO_CLS = {
  emitido: "bg-emerald-100 text-emerald-800",
  anulado: "bg-red-100 text-red-700",
  en_transito: "bg-amber-100 text-amber-800",
  recibido: "bg-sky-100 text-sky-800",
  rechazado: "bg-orange-100 text-orange-800",
};

export default function HistorialPage() {
  return <AuthGuard>{(profile) => <HistorialInner profile={profile} />}</AuthGuard>;
}

function HistorialInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const [plantas, setPlantas] = useState([]);
  const [f, setF] = useState({ texto: "", lote: "", precinto: "", estado: "", desde: "", hasta: "", planta: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const [anulando, setAnulando] = useState(null); // {id, motivo}
  const [msg, setMsg] = useState("");
  const [calibracion, setCalibracion] = useState(CALIBRACION_DEFAULT);
  const [reimp, setReimp] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: pl } = await supabase.from("plantas").select("*").order("nombre");
      setPlantas(pl || []);
      const { data: cfg } = await supabase.from("configuracion").select("*").eq("clave", "calibracion_default").maybeSingle();
      let calib = cfg?.valor || CALIBRACION_DEFAULT;
      try {
        const local = JSON.parse(localStorage.getItem("calibracion_local") || "null");
        if (local) calib = local;
      } catch {}
      setCalibracion(calib);
    })();
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = async () => {
    setLoading(true);
    setMsg("");
    let ids = null;
    if (f.lote.trim()) {
      const { data } = await supabase.from("v_remito_items_detalle").select("remito_id").ilike("lote", `%${f.lote.trim()}%`).limit(1000);
      ids = [...new Set((data || []).map((x) => x.remito_id))];
    }
    if (f.precinto.trim()) {
      const { data } = await supabase.from("v_remito_items_detalle").select("remito_id").ilike("precinto", `%${f.precinto.trim()}%`).limit(1000);
      const ids2 = [...new Set((data || []).map((x) => x.remito_id))];
      ids = ids ? ids.filter((x) => ids2.includes(x)) : ids2;
    }
    let q = supabase
      .from("remitos")
      .select("*, planta:plantas!planta_id(nombre), destino:plantas!planta_destino_id(nombre), remito_items(*)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (f.estado) q = q.eq("estado", f.estado);
    if (f.desde) q = q.gte("fecha", f.desde);
    if (f.hasta) q = q.lte("fecha", f.hasta);
    if (f.planta) q = q.eq("planta_id", f.planta);
    const t = f.texto.trim().replace(/[,()]/g, " ");
    if (t) q = q.or(`cliente_nombre.ilike.%${t}%,numero.ilike.%${t}%,chofer_nombre.ilike.%${t}%,transportista_nombre.ilike.%${t}%`);
    const { data, error } = await q;
    setLoading(false);
    if (error) return setMsg(friendlyError(error));
    setRows(data || []);
  };

  const anular = async () => {
    const { error } = await supabase.rpc("anular_remito", { p_remito_id: anulando.id, p_motivo: anulando.motivo });
    if (error) return setMsg(friendlyError(error));
    setAnulando(null);
    setMsg("Remito anulado. El stock fue devuelto a los lotes.");
    buscar();
  };

  const reimprimir = (r) => {
    const items = [...(r.remito_items || [])].sort((a, b) => a.orden - b.orden).map((i) => ({ cantidad: i.cantidad, descripcion: i.descripcion, kgUnidad: i.kg_unidad }));
    setReimp({
      fecha: r.fecha,
      destinatario: r.cliente_nombre,
      cuit: r.cliente_cuit,
      domicilio: r.cliente_domicilio,
      iva: r.cliente_iva,
      entregarEn: r.entregar_en,
      transportista: r.transportista_nombre,
      transpCuit: r.transportista_cuit,
      transpDomicilio: r.transportista_domicilio,
      chasis: r.chasis,
      acoplado: r.acoplado,
      chofer: r.chofer_nombre,
      choferDni: r.chofer_cuil,
      items,
      totalUnidades: r.total_unidades,
      totalKgs: r.total_kgs,
      observaciones: r.observaciones,
    });
    setTimeout(() => window.print(), 200);
  };

  const exportar = () => {
    const filas = [];
    rows.forEach((r) =>
      (r.remito_items || [])
        .sort((a, b) => a.orden - b.orden)
        .forEach((i) =>
          filas.push({
            Planta: r.planta?.nombre,
            "Punto de venta": r.punto_venta,
            Número: r.numero,
            Fecha: fmtFecha(r.fecha),
            Estado: r.estado,
            Modalidad: r.modalidad,
            Cliente: r.cliente_nombre,
            CUIT: r.cliente_cuit,
            "Entregar en": r.entregar_en,
            Transportista: r.transportista_nombre,
            Chofer: r.chofer_nombre,
            Chasis: r.chasis,
            Acoplado: r.acoplado,
            Descripción: i.descripcion,
            Lote: i.lote_texto,
            Precinto: i.precinto,
            Unidades: Number(i.cantidad),
            "Kg/u": i.kg_unidad ? Number(i.kg_unidad) : "",
            "Kg total": i.kg_total ? Number(i.kg_total) : "",
            Usuario: r.usuario_nombre,
            "Motivo anulación": r.motivo_anulacion || "",
          })
        )
    );
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Remitos");
    XLSX.writeFile(wb, `remitos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-6 space-y-4 no-print">
        <h1 className="text-lg font-semibold">Historial de remitos</h1>
        <div className="panel p-4 flex gap-2 flex-wrap items-end">
          <input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Cliente, número, chofer, transporte…" className={`${inputCls} flex-1 min-w-[200px]`} />
          <input value={f.lote} onChange={(e) => setF({ ...f, lote: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Lote" className={`${inputCls} w-32`} />
          <input value={f.precinto} onChange={(e) => setF({ ...f, precinto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Precinto" className={`${inputCls} w-32`} />
          <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} className={inputCls}>
            <option value="">Todos los estados</option>
            <option value="emitido">Emitidos</option>
            <option value="en_transito">En tránsito</option>
            <option value="recibido">Recibidos (traslados)</option>
            <option value="rechazado">Rechazados (traslados)</option>
            <option value="anulado">Anulados</option>
          </select>
          {esAdmin && (
            <select value={f.planta} onChange={(e) => setF({ ...f, planta: e.target.value })} className={inputCls}>
              <option value="">Todas las plantas</option>
              {plantas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          )}
          <label className="text-[10px] text-stone-400">
            Desde
            <input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={`${inputCls} block`} />
          </label>
          <label className="text-[10px] text-stone-400">
            Hasta
            <input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className={`${inputCls} block`} />
          </label>
          <button onClick={buscar} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded">
            Buscar
          </button>
          <button onClick={exportar} disabled={!rows.length} className="border border-emerald-700 text-emerald-800 text-sm px-3 py-1.5 rounded disabled:opacity-40">
            Exportar Excel
          </button>
        </div>

        {msg && <div className="text-sm bg-amber-50 border border-amber-300 text-amber-800 rounded p-3">{msg}</div>}

        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50">
              <tr>
                <th className="text-left p-2 pl-4">Remito</th>
                <th className="text-left p-2">Fecha</th>
                <th className="text-left p-2">Cliente</th>
                {esAdmin && <th className="text-left p-2">Planta</th>}
                <th className="text-right p-2">Unid.</th>
                <th className="text-right p-2">Kg</th>
                <th className="text-left p-2">Usuario</th>
                <th className="text-left p-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-stone-400">
                    Buscando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-stone-400">
                    No hay remitos con esos filtros.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="border-t border-stone-100 cursor-pointer hover:bg-stone-50">
                    <td className="p-2 pl-4 font-mono">
                      {r.punto_venta}-{r.numero}
                    </td>
                    <td className="p-2">{fmtFecha(r.fecha)}</td>
                    <td className="p-2">{r.tipo === "traslado" ? <><span className="text-[11px] font-medium text-sky-700 bg-sky-50 rounded px-1.5 py-0.5 mr-1.5">TRASLADO</span>{r.planta?.nombre} → {r.destino?.nombre}</> : r.cliente_nombre}</td>
                    {esAdmin && <td className="p-2">{r.planta?.nombre}</td>}
                    <td className="p-2 text-right">{fmtNum(r.total_unidades)}</td>
                    <td className="p-2 text-right">{fmtNum(r.total_kgs)}</td>
                    <td className="p-2 text-stone-500">{r.usuario_nombre}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${ESTADO_CLS[r.estado] || "bg-stone-100 text-stone-700"}`}>{ESTADO_TXT[r.estado] || r.estado}</span>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-stone-50">
                      <td colSpan={8} className="p-4 space-y-3">
                        <div className="text-xs text-stone-500 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                          <div>Modalidad: <b>{r.modalidad}</b></div>
                          <div>Registrado: {new Date(r.created_at).toLocaleString("es-AR")}</div>
                          <div>Transporte: {r.transportista_nombre || "—"}</div>
                          <div>Chofer: {r.chofer_nombre || "—"} {r.chofer_cuil ? `(${r.chofer_cuil})` : ""}</div>
                          <div>Chasis / Acoplado: {r.chasis || "—"} / {r.acoplado || "—"}</div>
                          <div>Entregar en: {r.entregar_en || "—"}</div>
                          {r.observaciones && <div className="sm:col-span-2">Obs.: {r.observaciones}</div>}
                        </div>
                        <table className="w-full text-xs">
                          <thead className="text-stone-400">
                            <tr>
                              <th className="text-right pr-3 w-16">Cant.</th>
                              <th className="text-left">Descripción</th>
                              <th className="text-left">Lote</th>
                              <th className="text-left">Precinto</th>
                              {r.tipo === "traslado" && <th className="text-right pr-3">Recibido</th>}
                              <th className="text-right">Kg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...(r.remito_items || [])]
                              .sort((a, b) => a.orden - b.orden)
                              .map((i) => (
                                <tr key={i.id} className="border-t border-stone-200">
                                  <td className="text-right pr-3">{fmtNum(i.cantidad)}</td>
                                  <td>{i.descripcion}</td>
                                  <td className="font-mono">{i.lote_texto || "—"}</td>
                                  <td className="font-mono">{i.precinto || "—"}</td>
                                  {r.tipo === "traslado" && <td className="text-right pr-3">{i.cantidad_recibida == null ? "—" : fmtNum(i.cantidad_recibida)}</td>}
                                  <td className="text-right">{fmtNum(i.kg_total)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {r.tipo === "traslado" && r.estado === "recibido" && (
                          <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">
                            Recibido por {r.recibido_por_nombre} ({r.destino?.nombre}) el {new Date(r.recibido_at).toLocaleString("es-AR")}.{r.obs_recepcion ? ` Obs.: ${r.obs_recepcion}` : ""}
                          </div>
                        )}
                        {r.tipo === "traslado" && r.estado === "rechazado" && (
                          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            Rechazado por {r.recibido_por_nombre} el {new Date(r.recibido_at).toLocaleString("es-AR")}. Motivo: {r.motivo_rechazo}. El stock volvió a {r.planta?.nombre}.
                          </div>
                        )}
                        {r.estado === "anulado" && (
                          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                            Anulado por {r.anulado_por_nombre} el {new Date(r.anulado_at).toLocaleString("es-AR")}. Motivo: {r.motivo_anulacion}
                          </div>
                        )}
                        <div className="flex gap-2 items-start flex-wrap">
                          <button onClick={() => reimprimir(r)} className="border border-emerald-700 text-emerald-800 text-sm px-3 py-1.5 rounded">
                            Reimprimir
                          </button>
                          {(r.estado === "emitido" || (r.estado === "en_transito" && (esAdmin || r.planta_id === profile.planta?.id))) && anulando?.id !== r.id && (
                            <button onClick={() => setAnulando({ id: r.id, motivo: "" })} className="border border-red-300 text-red-700 text-sm px-3 py-1.5 rounded">
                              Anular…
                            </button>
                          )}
                          {anulando?.id === r.id && (
                            <div className="flex-1 min-w-[260px] space-y-2">
                              <textarea
                                value={anulando.motivo}
                                onChange={(e) => setAnulando({ ...anulando, motivo: e.target.value })}
                                rows={2}
                                placeholder="Explicá por qué se anula el remito (obligatorio)"
                                className={`${inputCls} w-full`}
                              />
                              <div className="flex gap-2">
                                <button onClick={anular} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded">
                                  Confirmar anulación
                                </button>
                                <button onClick={() => setAnulando(null)} className="text-sm text-stone-500">
                                  Cancelar
                                </button>
                              </div>
                              <div className="text-xs text-stone-400">El stock de los lotes se devuelve y el número queda registrado como anulado.</div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length >= 300 && <div className="text-xs text-stone-400">Se muestran los últimos 300. Acotá con filtros para ver más.</div>}
      </div>
      {reimp && (
        <div className="print-reset hidden print:block">
          <RemitoSheet d={reimp} calibracion={calibracion} visible />
        </div>
      )}
    </NavBar>
  );
}
