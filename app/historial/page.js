"use client";

import { descargarPdfDeRemito } from "@/lib/remitoPdfDatos";
import { Fragment, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import RemitoConCopias, { SelectorCopias, useCopias } from "@/components/CopiasImpresion";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { CALIBRACION_DEFAULT } from "@/lib/fieldCoords";
import { fmtNum, fmtFecha, friendlyError, observacionesImpresas, ordenCargaImpresa, cotAtrasado } from "@/lib/util";

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
  const esAdmin = profile.rol === "admin" || profile.rol === "consulta" || profile.rol === "logistica"; // ve todas las plantas
  const soloLectura = profile.rol === "consulta"; // no reimprime ni anula
  const puedeAnular = !soloLectura && profile.rol !== "logistica"; // Logística reimprime pero no anula
  const [plantas, setPlantas] = useState([]);
  const [f, setF] = useState({ texto: "", lote: "", precinto: "", estado: "", desde: "", hasta: "", planta: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const [anulando, setAnulando] = useState(null); // {id, motivo}
  const [reabriendo, setReabriendo] = useState(null); // {id, motivo}  (solo administrador)
  const [msg, setMsg] = useState("");
  const [calibracion, setCalibracion] = useState(CALIBRACION_DEFAULT);
  const [reimp, setReimp] = useState(null);
  const [editL, setEditL] = useState(null); // corrección de lote de un renglón (solo administrador)
  const [editN, setEditN] = useState(null); // corrección del número de remito (solo administrador): {id, numero, motivo}
  const [editT, setEditT] = useState(null); // edición de transporte/chofer (solo administrador)
  const [transportistas, setTransportistas] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [copias, setCopias] = useCopias();
  const [pend, setPend] = useState({}); // remito_id -> fecha de alta (COT pendiente)

  useEffect(() => {
    (async () => {
      const { data: pl } = await supabase.from("plantas").select("*").order("nombre");
      setPlantas(pl || []);
      const { data: cfg } = await supabase.from("configuracion").select("*").eq("clave", "calibracion_default").maybeSingle();
      let calib = cfg?.valor?.v === CALIBRACION_DEFAULT.v ? cfg.valor : CALIBRACION_DEFAULT;
      try {
        const local = JSON.parse(localStorage.getItem("calibracion_local") || "null");
        if (local && local.v === CALIBRACION_DEFAULT.v) calib = local;
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
    // Remitos con COT pendiente (soja, destino o planta en Buenos Aires, sin COT cargado).
    const { data: pv } = await supabase.from("v_cot_pendientes").select("remito_id, created_at").limit(5000);
    const mapa = {};
    (pv || []).forEach((x) => (mapa[x.remito_id] = x.created_at));
    setPend(mapa);
    if (f.estado === "cot_pendiente") {
      const idsPend = Object.keys(mapa);
      ids = ids ? ids.filter((x) => idsPend.includes(x)) : idsPend;
    }
    let q = supabase
      .from("remitos")
      .select("*, planta:plantas!planta_id(nombre), destino:plantas!planta_destino_id(nombre), remito_items(*)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (f.estado && f.estado !== "cot_pendiente") q = q.eq("estado", f.estado);
    if (f.desde) q = q.gte("fecha", f.desde);
    if (f.hasta) q = q.lte("fecha", f.hasta);
    if (f.planta) q = q.eq("planta_id", f.planta);
    const t = f.texto.trim().replace(/[,()]/g, " ");
    if (t) q = q.or(`cliente_nombre.ilike.%${t}%,numero.ilike.%${t}%,chofer_nombre.ilike.%${t}%,transportista_nombre.ilike.%${t}%,cot.ilike.%${t}%,orden_carga.ilike.%${t}%`);
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

  const reabrir = async () => {
    const { error } = await supabase.rpc("reabrir_traslado", { p_remito_id: reabriendo.id, p_motivo: reabriendo.motivo });
    if (error) return setMsg(friendlyError(error));
    setReabriendo(null);
    setMsg("Traslado reabierto: quedó EN TRÁNSITO y el stock volvió a su estado anterior. Andá a Traslados para confirmarlo de nuevo con los datos correctos.");
    buscar();
  };

  const bajarPdf = async (r) => {
    setMsg("");
    try {
      await descargarPdfDeRemito(supabase, r, { leyenda: "REIMPRESIÓN DIGITAL" });
    } catch (e) {
      setMsg(e.message || friendlyError(e));
    }
  };

  const abrirEditT = async (r) => {
    if (!transportistas.length) {
      const [t, c] = await Promise.all([supabase.from("transportistas").select("*").order("nombre"), supabase.from("choferes").select("*").order("nombre")]);
      setTransportistas(t.data || []);
      setChoferes(c.data || []);
    }
    setEditT({
      id: r.id,
      transportista_id: r.transportista_id || "",
      transportista_nombre: r.transportista_nombre || "",
      transportista_cuit: r.transportista_cuit || "",
      transportista_domicilio: r.transportista_domicilio || "",
      chofer_id: r.chofer_id || "",
      chofer_nombre: r.chofer_nombre || "",
      chofer_cuil: r.chofer_cuil || "",
      chasis: r.chasis || "",
      acoplado: r.acoplado || "",
    });
  };
  const pad4 = (v) => (String(v ?? "").trim() ? String(v).trim().padStart(4, "0") : "");
  const parsePrec = (t) => {
    const m = String(t || "").trim().match(/^(.*?\S)\s+(\d+)(?:\s+AL\s+(\d+))?\s*$/i);
    return m ? { pref: m[1], d: Number(m[2]), h: Number(m[3] || m[2]) } : null;
  };
  const abrirEditL = async (r, i) => {
    setMsg("");
    const [{ data }, { data: pf }] = await Promise.all([
      supabase.from("lotes").select("id, lote, stock").eq("planta_id", r.planta_id).eq("producto_id", i.producto_id).order("lote"),
      supabase.from("prefijos_precinto").select("prefijo").eq("activo", true).order("prefijo"),
    ]);
    const pp = parsePrec(i.precinto);
    setEditL({
      remitoId: r.id, itemId: i.id, total: Number(i.cantidad), cantStr: String(i.cantidad), actual: i.lote_texto,
      lotes: (data || []).filter((x) => x.id !== i.lote_id), loteId: "", motivo: "", precintoActual: i.precinto || "",
      puedePartir: !!pp && pp.h - pp.d + 1 === Number(i.cantidad), rango: pp,
      repDesde: "", repHasta: "",
      prefijos: (pf || []).map((x) => x.prefijo), pref: pp?.pref || "", pd: "", ph: "", conPrecinto: false,
    });
  };
  const editLCalc = (e) => {
    const cant = Number(String(e.cantStr).replace(",", "."));
    const parcial = cant > 0 && cant < e.total;
    const rd = e.repDesde === "" ? null : Number(e.repDesde);
    const rh = e.repHasta === "" ? rd : Number(e.repHasta);
    const cntNuevo = e.pd === "" ? null : (e.ph === "" ? 1 : Number(e.ph) - Number(e.pd) + 1);
    const precNuevo = e.pd === "" || !e.pref ? "" : `${e.pref} ${pad4(e.pd)}${e.ph !== "" && Number(e.ph) !== Number(e.pd) ? ` AL ${pad4(e.ph)}` : ""}`;
    let err = "";
    if (!(cant > 0) || cant > e.total) err = `La cantidad tiene que estar entre 1 y ${e.total}.`;
    else if (parcial) {
      if (!e.puedePartir) err = "El precinto de este renglón no tiene el formato prefijo + desde AL hasta (o no coincide con las unidades): no se puede partir. Cambiá el renglón entero o anulá y rehacé el remito.";
      else if (rd == null || !Number.isFinite(rd) || !Number.isFinite(rh)) err = "Indicá qué precintos se reemplazan (desde / hasta).";
      else if (rd < e.rango.d || rh > e.rango.h || rh < rd) err = `Los precintos reemplazados tienen que estar entre ${e.rango.d} y ${e.rango.h}.`;
      else if (rh - rd + 1 !== cant) err = `Los precintos reemplazados son ${rh - rd + 1} y las unidades a cambiar son ${cant}.`;
      else if (!precNuevo) err = "Indicá el precinto del renglón nuevo.";
      else if (cntNuevo !== cant) err = `Los precintos nuevos son ${cntNuevo} y las unidades a cambiar son ${cant}.`;
    } else if (e.conPrecinto) {
      if (!precNuevo) err = "Indicá el precinto nuevo.";
      else if (cntNuevo !== cant) err = `Los precintos nuevos son ${cntNuevo} y las unidades son ${cant}.`;
    }
    return { cant, parcial, rd, rh, precNuevo, err };
  };
  const guardarEditL = async () => {
    setMsg("");
    const c = editLCalc(editL);
    if (c.err) return setMsg(c.err);
    const { data, error } = await supabase.rpc("corregir_lote_remito", {
      p_item_id: editL.itemId, p_lote_nuevo: editL.loteId, p_motivo: editL.motivo,
      p_precinto: c.parcial || editL.conPrecinto ? c.precNuevo : null,
      p_cantidad: c.parcial ? c.cant : null, p_rep_desde: c.parcial ? c.rd : null, p_rep_hasta: c.parcial ? c.rh : null,
    });
    if (error) return setMsg(friendlyError(error));
    setEditL(null);
    await buscar();
    setMsg(`Lote corregido: ${fmtNum(data?.cantidad)} u. del lote ${data?.lote_anterior} → ${data?.lote_nuevo}. El stock se movió entre los dos lotes. Reimprimí el remito.${data?.aviso ? " " + data.aviso : ""}`);
  };
  const guardarEditN = async () => {
    setMsg("");
    const { data, error } = await supabase.rpc("corregir_numero_remito", { p_remito_id: editN.id, p_numero: editN.numero, p_motivo: editN.motivo });
    if (error) return setMsg(friendlyError(error));
    setEditN(null);
    await buscar();
    setMsg(`Número corregido: ahora el remito es el N° ${data}. Si ya lo imprimiste con otro número, reimprimilo.`);
  };
  const guardarEditT = async () => {
    setMsg("");
    const { id, ...datos } = editT;
    const { error } = await supabase.rpc("editar_remito_transporte", { p_remito_id: id, p_datos: datos });
    if (error) return setMsg(friendlyError(error));
    setEditT(null);
    await buscar();
    setMsg("Datos del remito actualizados. Si ya lo imprimiste, reimprimilo con los datos nuevos.");
  };

  const reimprimir = (r) => {
    const items = [...(r.remito_items || [])].sort((a, b) => a.orden - b.orden).map((i) => ({ cantidad: i.cantidad, unidad: i.unidad, descripcion: i.descripcion, kgTotal: i.kg_total }));
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
      observaciones: observacionesImpresas({ cot: r.cot, observaciones: r.observaciones }),
      ordenCarga: ordenCargaImpresa(r.orden_carga, r.orden_salida),
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
            "Orden de carga": r.orden_carga,
            COT: r.cot,
            Provincia: r.cliente_provincia,
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
          <input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Cliente, número, chofer, transporte, COT, orden…" className={`${inputCls} flex-1 min-w-[200px]`} />
          <input value={f.lote} onChange={(e) => setF({ ...f, lote: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Lote" className={`${inputCls} w-32`} />
          <input value={f.precinto} onChange={(e) => setF({ ...f, precinto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Precinto" className={`${inputCls} w-32`} />
          <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} className={inputCls}>
            <option value="">Todos los estados</option>
            <option value="emitido">Emitidos</option>
            <option value="en_transito">En tránsito</option>
            <option value="recibido">Recibidos (traslados)</option>
            <option value="rechazado">Rechazados (traslados)</option>
            <option value="anulado">Anulados</option>
            <option value="cot_pendiente">COT pendiente</option>
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
          {!soloLectura && <SelectorCopias copias={copias} onChange={setCopias} />}
        </div>

        {msg && <div className="text-sm bg-amber-50 border border-amber-300 text-amber-800 rounded p-3">{msg}</div>}

        <div className="panel overflow-x-auto">
          <table className="w-full text-sm block md:table">
            <thead className="text-xs text-stone-500 bg-stone-50 hidden md:table-header-group">
              <tr>
                <th className="text-left p-2 pl-4">Remito</th>
                <th className="text-left p-2">Fecha</th>
                <th className="text-left p-2">Cliente</th>
                <th className="text-left p-2">Orden de carga</th>
                {esAdmin && <th className="text-left p-2">Planta</th>}
                <th className="text-right p-2">Unid.</th>
                <th className="text-right p-2">Kg</th>
                <th className="text-left p-2">Usuario</th>
                <th className="text-left p-2">Estado</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {loading && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-stone-400">
                    Buscando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-stone-400">
                    No hay remitos con esos filtros.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="border-t border-stone-100 cursor-pointer hover:bg-stone-50 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5 md:p-0 md:table-row">
                    <td className="md:p-2 md:pl-4 font-mono font-semibold md:font-normal order-1">
                      {r.punto_venta}-{r.numero}
                    </td>
                    <td className="md:p-2 order-4 text-stone-500 md:text-stone-800 text-[13px] md:text-sm">{fmtFecha(r.fecha)}</td>
                    <td className="md:p-2 order-3 w-full md:w-auto">{r.tipo === "traslado" ? <><span className="text-[11px] font-medium text-sky-700 bg-sky-50 rounded px-1.5 py-0.5 mr-1.5">TRASLADO</span>{r.planta?.nombre} → {r.destino?.nombre}</> : r.cliente_nombre}</td>
                    <td className={`md:p-2 font-mono text-[12px] order-7 ${r.orden_carga ? "" : "hidden md:table-cell"}`}>{r.orden_carga ? `${r.orden_carga}${r.orden_salida ? ` · ${r.orden_salida}` : ""}` : <span className="text-stone-300">—</span>}</td>
                    {esAdmin && <td className="hidden md:table-cell md:p-2">{r.planta?.nombre}</td>}
                    <td className="md:p-2 md:text-right order-5 text-[13px] md:text-sm">{fmtNum(r.total_unidades)}<span className="md:hidden"> u.</span></td>
                    <td className="md:p-2 md:text-right order-6 text-[13px] md:text-sm">{fmtNum(r.total_kgs)}<span className="md:hidden"> kg</span></td>
                    <td className="hidden md:table-cell md:p-2 text-stone-500">{r.usuario_nombre}</td>
                    <td className="md:p-2 order-2 ml-auto md:ml-0">
                      <span className={`text-xs px-2 py-0.5 rounded ${ESTADO_CLS[r.estado] || "bg-stone-100 text-stone-700"}`}>{ESTADO_TXT[r.estado] || r.estado}</span>
                      {r.digital && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-800" title={`Emitido sin papel por ${r.digital_por_nombre || ""}`}>Digital</span>}
                      {pend[r.id] && (
                        <span className={`ml-1.5 text-xs px-2 py-0.5 rounded font-medium ${cotAtrasado(pend[r.id]) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>COT pendiente</span>
                      )}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-stone-50 block md:table-row">
                      <td colSpan={9} className="p-3 md:p-4 space-y-3 block md:table-cell">
                        <div className="text-xs text-stone-500 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                          <div>Modalidad: <b>{r.modalidad}</b></div>
                          {pend[r.id] && (
                            <div className="sm:col-span-2 text-amber-800">
                              COT pendiente: este remito todavía no tiene COT. <Link href="/cot" className="underline font-medium">Ir a la pantalla COT</Link>
                            </div>
                          )}
                          {(r.orden_carga || r.cot) && <div>Orden de carga: <b>{r.orden_carga ? `${r.orden_carga}${r.orden_salida ? ` · ${r.orden_salida}` : ""}` : "—"}</b>{r.orden_carga && r.planta?.nombre ? ` (sale de ${r.planta.nombre})` : ""} · COT: <b>{r.cot || "—"}</b> ({r.cliente_provincia || "—"})</div>}
                          <div>Registrado: {new Date(r.created_at).toLocaleString("es-AR")}</div>
                          <div>Transporte: {r.transportista_nombre || "—"}</div>
                          <div>Chofer: {r.chofer_nombre || "—"} {r.chofer_cuil ? `(${r.chofer_cuil})` : ""}</div>
                          <div>Chasis / Acoplado: {r.chasis || "—"} / {r.acoplado || "—"}</div>
                          <div>Entregar en: {r.entregar_en || "—"}</div>
                          {r.cai && <div>CAI: <b>{r.cai}</b> (vence {fmtFecha(r.cai_vencimiento)})</div>}
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
                              {profile.rol === "admin" && <th></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {[...(r.remito_items || [])]
                              .sort((a, b) => a.orden - b.orden)
                              .map((i) => (
                                <Fragment key={i.id}>
                                <tr className="border-t border-stone-200">
                                  <td className="text-right pr-3">{fmtNum(i.cantidad)}</td>
                                  <td>{i.descripcion}</td>
                                  <td className="font-mono">{i.lote_texto || "—"}</td>
                                  <td className="font-mono">{i.precinto || "—"}</td>
                                  {r.tipo === "traslado" && <td className="text-right pr-3">{i.cantidad_recibida == null ? "—" : fmtNum(i.cantidad_recibida)}</td>}
                                  <td className="text-right">{fmtNum(i.kg_total)}</td>
                                  {profile.rol === "admin" && (
                                    <td className="text-right pl-2">
                                      {i.lote_id && i.producto_id && (r.estado === "emitido" || r.estado === "en_transito") && editL?.itemId !== i.id && (
                                        <button onClick={() => abrirEditL(r, i)} className="text-amber-800 hover:underline whitespace-nowrap">Corregir lote</button>
                                      )}
                                    </td>
                                  )}
                                </tr>
                                {editL && editL.itemId === i.id && (() => {
                                  const c = editLCalc(editL);
                                  const inpL = "border border-stone-300 rounded px-2 py-1.5 bg-white";
                                  const mostrarPrec = c.parcial || editL.conPrecinto;
                                  return (
                                  <tr><td colSpan={7} className="pb-3">
                                    <div className="border border-amber-300 bg-amber-50/50 rounded p-3 space-y-2 text-[13px]">
                                      <div className="font-medium">Corregir lote del renglón ({fmtNum(i.cantidad)} u., hoy lote {editL.actual}, precinto {editL.precintoActual || "—"})</div>
                                      <div className="grid gap-2 sm:grid-cols-3">
                                        <select value={editL.loteId} onChange={(e) => setEditL({ ...editL, loteId: e.target.value })} className={inpL}>
                                          <option value="">Lote correcto (mismo producto y planta)…</option>
                                          {editL.lotes.map((x) => (
                                            <option key={x.id} value={x.id} disabled={Number(x.stock) < (c.cant || 1)}>{x.lote} · stock {fmtNum(x.stock)}{Number(x.stock) < (c.cant || 1) ? " (no alcanza)" : ""}</option>
                                          ))}
                                        </select>
                                        <label className="flex items-center gap-2">
                                          <span className="text-stone-600 whitespace-nowrap">Unidades que cambian</span>
                                          <input value={editL.cantStr} onChange={(e) => setEditL({ ...editL, cantStr: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" className={`${inpL} w-20`} />
                                          <span className="text-stone-400">de {fmtNum(editL.total)}</span>
                                        </label>
                                        <input value={editL.motivo} onChange={(e) => setEditL({ ...editL, motivo: e.target.value })} placeholder="Motivo (obligatorio)" className={inpL} />
                                      </div>
                                      {c.parcial && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-stone-600">Precintos que se reemplazan (dentro de {editL.rango ? `${editL.rango.d} a ${editL.rango.h}` : "—"}):</span>
                                          <input value={editL.repDesde} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setEditL({ ...editL, repDesde: v, repHasta: v !== "" && c.cant ? String(Number(v) + c.cant - 1) : "" }); }} placeholder="desde" className={`${inpL} w-24`} />
                                          <span>al</span>
                                          <input value={editL.repHasta} onChange={(e) => setEditL({ ...editL, repHasta: e.target.value.replace(/\D/g, "") })} placeholder="hasta" className={`${inpL} w-24`} />
                                          {c.rd != null && Number.isFinite(c.rd) && c.rd >= (editL.rango?.d ?? 0) && c.rh <= (editL.rango?.h ?? 0) && (
                                            <span className="text-stone-500">Queda: {[c.rd > editL.rango.d ? `${editL.rango.d}–${c.rd - 1}` : null, c.rh < editL.rango.h ? `${c.rh + 1}–${editL.rango.h}` : null].filter(Boolean).join(" y ")} en el lote {editL.actual}</span>
                                          )}
                                        </div>
                                      )}
                                      {!c.parcial && (
                                        <label className="flex items-center gap-2 text-stone-600">
                                          <input type="checkbox" checked={editL.conPrecinto} onChange={(e) => setEditL({ ...editL, conPrecinto: e.target.checked })} />
                                          Corregir también el precinto
                                        </label>
                                      )}
                                      {mostrarPrec && (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-stone-600">{c.parcial ? "Precinto del renglón nuevo:" : "Precinto nuevo:"}</span>
                                          {editL.prefijos.length > 0 ? (
                                            <select value={editL.pref} onChange={(e) => setEditL({ ...editL, pref: e.target.value })} className={inpL}>
                                              <option value="">Prefijo…</option>
                                              {[...new Set([...(editL.pref ? [editL.pref] : []), ...editL.prefijos])].map((x) => <option key={x} value={x}>{x}</option>)}
                                            </select>
                                          ) : (
                                            <input value={editL.pref} onChange={(e) => setEditL({ ...editL, pref: e.target.value.toUpperCase() })} placeholder="Prefijo" className={`${inpL} w-40`} />
                                          )}
                                          <input value={editL.pd} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setEditL({ ...editL, pd: v, ph: v !== "" && c.cant ? String(Number(v) + c.cant - 1) : "" }); }} placeholder="desde" className={`${inpL} w-24`} />
                                          <span>al</span>
                                          <input value={editL.ph} onChange={(e) => setEditL({ ...editL, ph: e.target.value.replace(/\D/g, "") })} placeholder="hasta" className={`${inpL} w-24`} />
                                          {c.precNuevo && <span className="font-mono text-stone-600">{c.precNuevo}</span>}
                                        </div>
                                      )}
                                      {c.err && editL.loteId && <div className="text-red-700 text-xs">{c.err}</div>}
                                      <div className="flex gap-2">
                                        <button onClick={guardarEditL} disabled={!editL.loteId || editL.motivo.trim().length < 3 || !!c.err} className="bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-50">Guardar corrección</button>
                                        <button onClick={() => setEditL(null)} className="text-stone-600 px-2">Cancelar</button>
                                      </div>
                                      <div className="text-xs text-stone-500">El stock vuelve al lote anterior y se descuenta del nuevo; queda registrado en Movimientos y en el historial de cambios del remito. {c.parcial ? "El renglón se parte alrededor de los precintos reemplazados; los totales del remito no cambian." : ""}</div>
                                    </div>
                                  </td></tr>
                                  );
                                })()}
                                </Fragment>
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
                        {r.tipo === "traslado" && r.veces_reabierto > 0 && (
                          <div className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded p-2">
                            Corregido por el administrador {r.veces_reabierto} vez/veces. Última: {r.reabierto_por_nombre}, {new Date(r.reabierto_at).toLocaleString("es-AR")}. Motivo: {r.motivo_reapertura}
                          </div>
                        )}
                        {r.estado === "anulado" && (
                          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                            Anulado por {r.anulado_por_nombre} el {new Date(r.anulado_at).toLocaleString("es-AR")}. Motivo: {r.motivo_anulacion}
                          </div>
                        )}
                        {editT?.id === r.id && (
                          <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2 text-sm">
                            <div className="font-medium text-amber-900">Corregir transporte y chofer del remito {r.punto_venta}-{r.numero}</div>
                            <div className="grid sm:grid-cols-3 gap-2">
                              <select value={editT.transportista_id} onChange={(e) => { const t = transportistas.find((x) => x.id === e.target.value); setEditT({ ...editT, transportista_id: e.target.value, ...(t ? { transportista_nombre: t.nombre || "", transportista_cuit: t.cuit || "", transportista_domicilio: t.domicilio || "" } : {}) }); }} className="border border-stone-300 rounded px-2 py-1.5 sm:col-span-3">
                                <option value="">Transportista: elegir de la lista (o escribir abajo)…</option>
                                {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                              </select>
                              <input value={editT.transportista_nombre} onChange={(e) => setEditT({ ...editT, transportista_id: "", transportista_nombre: e.target.value })} placeholder="Transportista" className="border border-stone-300 rounded px-2 py-1.5" />
                              <input value={editT.transportista_cuit} onChange={(e) => setEditT({ ...editT, transportista_cuit: e.target.value })} placeholder="CUIT transportista" className="border border-stone-300 rounded px-2 py-1.5" />
                              <input value={editT.transportista_domicilio} onChange={(e) => setEditT({ ...editT, transportista_domicilio: e.target.value })} placeholder="Domicilio transportista" className="border border-stone-300 rounded px-2 py-1.5" />
                              <select value={editT.chofer_id} onChange={(e) => { const c = choferes.find((x) => x.id === e.target.value); setEditT({ ...editT, chofer_id: e.target.value, ...(c ? { chofer_nombre: c.nombre || "", chofer_cuil: c.cuil || "", chasis: c.chasis || editT.chasis, acoplado: c.acoplado || editT.acoplado } : {}) }); }} className="border border-stone-300 rounded px-2 py-1.5 sm:col-span-3">
                                <option value="">Chofer: elegir de la lista (o escribir abajo)…</option>
                                {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                              </select>
                              <input value={editT.chofer_nombre} onChange={(e) => setEditT({ ...editT, chofer_id: "", chofer_nombre: e.target.value })} placeholder="Chofer" className="border border-stone-300 rounded px-2 py-1.5" />
                              <input value={editT.chofer_cuil} onChange={(e) => setEditT({ ...editT, chofer_cuil: e.target.value })} placeholder="CUIL / DNI" className="border border-stone-300 rounded px-2 py-1.5" />
                              <span />
                              <input value={editT.chasis} onChange={(e) => setEditT({ ...editT, chasis: e.target.value })} placeholder="Chasis" className="border border-stone-300 rounded px-2 py-1.5" />
                              <input value={editT.acoplado} onChange={(e) => setEditT({ ...editT, acoplado: e.target.value })} placeholder="Acoplado" className="border border-stone-300 rounded px-2 py-1.5" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={guardarEditT} className="bg-emerald-700 text-white px-3 py-1.5 rounded">Guardar cambios</button>
                              <button onClick={() => setEditT(null)} className="text-stone-600 px-2">Cancelar</button>
                            </div>
                            <div className="text-xs text-stone-500">No cambia el stock, los kilos ni la mercadería. Queda registrado quién lo modificó y cómo estaba antes.</div>
                          </div>
                        )}
                        {editN?.id === r.id && (
                          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm mb-2">
                            <div className="font-medium text-amber-900">Corregir el número del remito {r.punto_venta}-{r.numero}</div>
                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-stone-600">Número real del formulario:</span>
                              <input value={editN.numero} onChange={(e) => setEditN({ ...editN, numero: e.target.value.replace(/\D/g, "").slice(0, 8) })} onBlur={() => editN.numero && setEditN({ ...editN, numero: editN.numero.padStart(8, "0") })} inputMode="numeric" placeholder="00002503" className="border border-stone-300 rounded px-2 py-1.5 w-32 font-mono" />
                              <input value={editN.motivo} onChange={(e) => setEditN({ ...editN, motivo: e.target.value })} placeholder="Motivo (obligatorio)" className="border border-stone-300 rounded px-2 py-1.5 flex-1 min-w-[200px]" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={guardarEditN} disabled={!editN.numero || editN.motivo.trim().length < 3} className="bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-50">Guardar número</button>
                              <button onClick={() => setEditN(null)} className="text-stone-600 px-2">Cancelar</button>
                            </div>
                            <div className="text-xs text-stone-500">El número viejo queda libre. No cambia el stock ni la mercadería; queda registrado quién lo corrigió y cómo estaba. Con el control de talonarios activo, el número tiene que estar dentro de un talonario de la planta.</div>
                          </div>
                        )}
                        <div className="flex gap-2 items-start flex-wrap">
                          {!soloLectura && (
                            <button onClick={() => reimprimir(r)} className="border border-emerald-700 text-emerald-800 text-sm px-3 py-1.5 rounded">
                              Reimprimir
                            </button>
                          )}
                          {profile.rol === "admin" && r.estado !== "anulado" && editT?.id !== r.id && (
                            <button onClick={() => abrirEditT(r)} className="border border-amber-400 text-amber-800 text-sm px-3 py-1.5 rounded">
                              Corregir transporte / chofer
                            </button>
                          )}
                          {profile.rol === "admin" && r.estado !== "anulado" && editN?.id !== r.id && (
                            <button onClick={() => setEditN({ id: r.id, numero: "", motivo: "" })} className="border border-amber-400 text-amber-800 text-sm px-3 py-1.5 rounded">
                              Corregir número
                            </button>
                          )}
                          {profile.rol === "admin" && r.estado !== "anulado" && (
                            <button onClick={() => bajarPdf(r)} className="border border-stone-400 text-stone-700 text-sm px-3 py-1.5 rounded">
                              Descargar PDF
                            </button>
                          )}
                          {puedeAnular && (r.estado === "emitido" || (r.estado === "en_transito" && (esAdmin || r.planta_id === profile.planta?.id))) && anulando?.id !== r.id && (
                            <button onClick={() => setAnulando({ id: r.id, motivo: "" })} className="border border-red-300 text-red-700 text-sm px-3 py-1.5 rounded">
                              Anular…
                            </button>
                          )}
                          {profile.rol === "admin" && r.tipo === "traslado" && (r.estado === "recibido" || r.estado === "rechazado") && reabriendo?.id !== r.id && (
                            <button onClick={() => setReabriendo({ id: r.id, motivo: "" })} className="border border-amber-400 text-amber-800 text-sm px-3 py-1.5 rounded">
                              Reabrir para corregir…
                            </button>
                          )}
                          {reabriendo?.id === r.id && (
                            <div className="flex-1 min-w-[260px] space-y-2">
                              <textarea
                                value={reabriendo.motivo}
                                onChange={(e) => setReabriendo({ ...reabriendo, motivo: e.target.value })}
                                rows={2}
                                placeholder="Qué se corrige y por qué (obligatorio)"
                                className={`${inputCls} w-full`}
                              />
                              <div className="flex gap-2">
                                <button onClick={reabrir} className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded">
                                  Reabrir traslado
                                </button>
                                <button onClick={() => setReabriendo(null)} className="text-sm text-stone-500">
                                  Cancelar
                                </button>
                              </div>
                              <div className="text-xs text-stone-400">Se deshace la recepción (el stock del destino vuelve a «en tránsito») y se confirma de nuevo con los datos correctos. Si el destino ya usó ese stock, no se puede reabrir.</div>
                            </div>
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
          <RemitoConCopias d={reimp} calibracion={calibracion} visible copias={copias} />
        </div>
      )}
    </NavBar>
  );
}
