"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, friendlyError, PROVINCIAS, norm, up } from "@/lib/util";
import { parseOrdenDeCarga } from "@/lib/parseOrdenDeCarga";
import { armarLineas, lineasParaGuardar } from "@/lib/ordenesCarga";

const inp = "w-full border border-stone-300 rounded-md px-3 py-2 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:bg-stone-100 disabled:text-stone-500";
const lab = "block text-[12px] font-medium text-stone-600 mb-1";
const btn = "bg-emerald-700 hover:bg-emerald-800 text-white text-[13.5px] font-medium px-4 py-2 rounded-md disabled:opacity-50";
const btn2 = "border border-stone-300 text-stone-700 text-[13px] px-3 py-1.5 rounded-md hover:bg-stone-50";

const LINEA_VACIA = {
  planta_id: "", cliente: "", cuit: "", contacto: "", telefono: "", domicilio: "", provincia: "", entregar_en: "", ov: "",
  producto_id: "", producto_texto: "", presentacion: "", lote_texto: "", cantidad: "", kilos: "",
};

export default function OrdenesPage() {
  return <AuthGuard>{(profile) => <OrdenesInner profile={profile} />}</AuthGuard>;
}

function estadoOrden(o, lineas) {
  if (o.estado === "anulada") return { txt: "Anulada", cls: "bg-red-50 text-red-700 border-red-200" };
  if (!lineas.length) return { txt: "Sin líneas", cls: "bg-stone-100 text-stone-600 border-stone-200" };
  const saldo = lineas.reduce((a, l) => a + Math.max(0, Number(l.saldo)), 0);
  const rem = lineas.reduce((a, l) => a + Number(l.remitido), 0);
  if (saldo <= 0) return { txt: "Completa", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (rem > 0) return { txt: "Parcial", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { txt: "Pendiente", cls: "bg-sky-50 text-sky-800 border-sky-200" };
}

function OrdenesInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const soloVista = profile.rol === "consulta";
  const miPlanta = profile.planta?.id || null;
  const sinPlanta = profile.rol === "operador" && !miPlanta;

  const [ordenes, setOrdenes] = useState([]);
  const [lineas, setLineas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState(null);
  const [filtro, setFiltro] = useState("pendientes");
  const [buscar, setBuscar] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [remitosDe, setRemitosDe] = useState({});
  const [log, setLog] = useState(null);
  const [prev, setPrev] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [manual, setManual] = useState(null);
  const [edit, setEdit] = useState(null); // {ordenId, lineaId|null, data, tieneRemitos}
  const [anulando, setAnulando] = useState(null);
  const [sueltos, setSueltos] = useState(null); // remitos con número de orden y sin vincular
  const fileRef = useRef(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [o, l, p, pl] = await Promise.all([
      supabase.from("ordenes_carga").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("v_ordenes_lineas_saldo").select("*").order("cliente").limit(5000),
      supabase.from("productos").select("*").eq("activo", true).order("nombre"),
      supabase.from("plantas").select("*").eq("activa", true).order("nombre"),
    ]);
    setCargando(false);
    const err = o.error || l.error;
    if (err) return setMsg({ tipo: "error", texto: friendlyError(err) });
    setOrdenes(o.data || []);
    setLineas(l.data || []);
    setProductos(p.data || []);
    setPlantas(pl.data || []);
  }, []);

  useEffect(() => {
    if (!sinPlanta) cargar();
    else setCargando(false);
  }, [cargar, sinPlanta]);

  const lineasDe = useMemo(() => {
    const m = {};
    for (const l of lineas) (m[l.orden_id] ||= []).push(l);
    return m;
  }, [lineas]);

  const lista = useMemo(() => {
    const q = norm(buscar);
    return ordenes.filter((o) => {
      const ls = lineasDe[o.id] || [];
      if (filtro === "pendientes" && (o.estado === "anulada" || !ls.some((l) => Number(l.saldo) > 0))) return false;
      if (q && !(norm(o.numero).includes(q) || ls.some((l) => norm(l.cliente).includes(q) || norm(l.producto_texto).includes(q) || norm(l.lote_texto).includes(q)))) return false;
      return true;
    });
  }, [ordenes, lineasDe, filtro, buscar]);

  const puedeEditar = (l) => !soloVista && (esAdmin || l.planta_id === miPlanta);

  // ---------- carga de Excel ----------
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    setResultado(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const parsed = parseOrdenDeCarga(rows);
        if (parsed.modalidadDetectada === "maiz") throw new Error("Esta es una orden de maíz: por ahora acá se cargan solo las de soja.");
        const { lineas: ls, depositosSinPlanta, sinCatalogo } = armarLineas(parsed, plantas, productos, "soja");
        if (!ls.length) throw new Error("La orden no trae clientes con cantidad para cargar. Revisá que tenga Cliente y Cantidad completos.");
        setPrev({ archivo: file.name, numero: parsed.ordenCarga || "", lineas: ls, depositosSinPlanta, sinCatalogo, mapa: {} });
      } catch (err) {
        setPrev(null);
        setMsg({ tipo: "error", texto: err.message || "No pude leer el archivo." });
      }
    };
    reader.readAsArrayBuffer(file); // el Excel no se guarda: se lee en este navegador y se guardan solo las líneas
  };

  const efectivas = useMemo(() => {
    if (!prev) return [];
    return prev.lineas.map((l) => {
      const pid = l.planta_id || prev.mapa[l.deposito] || null;
      return { ...l, planta_id: pid };
    });
  }, [prev]);
  const nombrePlanta = (id) => plantas.find((p) => p.id === id)?.nombre || "—";
  const deOtraPlanta = (l) => !esAdmin && l.planta_id && l.planta_id !== miPlanta;
  const aCargar = efectivas.filter((l) => l.planta_id && !deOtraPlanta(l));

  const guardarPrev = async () => {
    setMsg(null);
    setGuardando(true);
    const { data, error } = await supabase.rpc("cargar_orden_carga", {
      p_numero: prev.numero,
      p_fecha: null,
      p_lineas: lineasParaGuardar(efectivas),
      p_origen: "excel",
    });
    setGuardando(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setResultado(data);
    setPrev(null);
    if (fileRef.current) fileRef.current.value = "";
    cargar();
  };

  // ---------- orden a mano (solo administrador) ----------
  const crearManual = async () => {
    setMsg(null);
    const { data, error } = await supabase.rpc("crear_orden_manual", { p_numero: manual.numero, p_fecha: manual.fecha || null });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setManual(null);
    await cargar();
    abrir(data);
    setEdit({ ordenId: data, lineaId: null, data: { ...LINEA_VACIA }, tieneRemitos: false });
    setMsg({ tipo: "ok", texto: "Orden creada. Agregá las líneas." });
  };

  // ---------- remitos hechos antes del módulo (solo administrador) ----------
  const buscarSueltos = async () => {
    setMsg(null);
    const { data, error } = await supabase.from("remitos").select("id, punto_venta, numero, fecha, cliente_nombre, orden_carga, estado")
      .not("orden_carga", "is", null).is("orden_id", null).not("estado", "in", "(anulado,rechazado)").order("created_at", { ascending: false }).limit(200);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setSueltos((data || []).filter((r) => String(r.orden_carga).trim()));
  };
  const vincularSuelto = async (r) => {
    if (!window.confirm(`Registrar el remito ${r.punto_venta}-${r.numero} en la orden ${r.orden_carga}? No cambia el stock ni el remito.`)) return;
    const { error } = await supabase.rpc("registrar_orden_desde_remito", { p_remito_id: r.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `Remito ${r.punto_venta}-${r.numero} registrado en la orden ${r.orden_carga}.` });
    await cargar();
    await buscarSueltos();
  };

  // ---------- detalle de una orden ----------
  const abrir = async (id) => {
    if (abierta === id) {
      setAbierta(null);
      return;
    }
    setAbierta(id);
    setLog(null);
    setEdit(null);
    setAnulando(null);
    await cargarRemitos(id);
  };

  const cargarRemitos = async (id) => {
    const ids = (lineasDe[id] || []).map((l) => l.id);
    if (!ids.length) return;
    const { data } = await supabase
      .from("remito_items")
      .select("orden_linea_id, cantidad, remitos(punto_venta, numero, estado)")
      .in("orden_linea_id", ids);
    const m = {};
    for (const r of data || []) {
      if (!r.remitos || ["anulado", "rechazado"].includes(r.remitos.estado)) continue;
      (m[r.orden_linea_id] ||= []).push(`${r.remitos.punto_venta}-${r.remitos.numero} (${fmtNum(r.cantidad)})`);
    }
    setRemitosDe((x) => ({ ...x, ...m }));
  };

  const verLog = async (id) => {
    const { data } = await supabase.from("ordenes_carga_log").select("*").eq("orden_id", id).order("created_at", { ascending: false }).limit(100);
    setLog({ id, filas: data || [] });
  };

  // ---------- edición de líneas ----------
  const editar = (l) =>
    setEdit({
      ordenId: l.orden_id,
      lineaId: l.id,
      tieneRemitos: Number(l.remitido) > 0,
      data: {
        planta_id: l.planta_id, cliente: l.cliente || "", cuit: l.cuit || "", contacto: l.contacto || "", telefono: l.telefono || "",
        domicilio: l.domicilio || "", provincia: l.provincia || "", entregar_en: l.entregar_en || "", ov: l.ov || "",
        producto_id: l.producto_id || "", producto_texto: l.producto_texto || "", presentacion: l.presentacion || "",
        lote_texto: l.lote_texto || "", cantidad: String(l.cantidad), kilos: l.kilos ?? "",
      },
    });

  const setD = (patch) => setEdit((e) => ({ ...e, data: { ...e.data, ...patch } }));

  const elegirProducto = (id) => {
    const p = productos.find((x) => x.id === id);
    setEdit((e) => ({
      ...e,
      data: {
        ...e.data,
        producto_id: id,
        producto_texto: p && !e.data.producto_texto ? p.nombre : e.data.producto_texto,
        presentacion: p && !e.data.presentacion ? p.presentacion || "" : e.data.presentacion,
      },
    }));
  };

  const guardarLinea = async () => {
    setMsg(null);
    const d = edit.data;
    const prod = productos.find((p) => p.id === d.producto_id);
    const cantidad = Number(String(d.cantidad).replace(",", "."));
    const kilos = prod?.kg_por_unidad && cantidad ? Math.round(cantidad * Number(prod.kg_por_unidad) * 1000) / 1000 : d.kilos === "" ? null : Number(d.kilos);
    const payload = { ...d, cantidad, kilos, producto_id: d.producto_id || null, cliente: up(d.cliente), provincia: d.provincia || "" };
    const { error } = edit.lineaId
      ? await supabase.rpc("guardar_orden_linea", { p_linea_id: edit.lineaId, p_data: payload })
      : await supabase.rpc("agregar_orden_linea", { p_orden_id: edit.ordenId, p_data: payload });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: edit.lineaId ? "Línea guardada." : "Línea agregada." });
    const id = edit.ordenId;
    setEdit(null);
    await cargar();
    cargarRemitos(id);
  };

  const quitarLinea = async (l) => {
    if (!window.confirm(`¿Quitar la línea de ${l.cliente} · ${l.producto_texto} · ${l.lote_texto || "sin lote"}?`)) return;
    const { error } = await supabase.rpc("quitar_orden_linea", { p_linea_id: l.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: "Línea quitada." });
    cargar();
  };

  const anular = async () => {
    const { error } = await supabase.rpc("anular_orden", { p_orden_id: anulando.id, p_motivo: anulando.motivo });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setAnulando(null);
    setMsg({ tipo: "ok", texto: "Orden anulada." });
    cargar();
  };

  if (sinPlanta)
    return (
      <NavBar profile={profile}>
        <div className="max-w-3xl mx-auto p-6 text-sm text-stone-600">Tu usuario no tiene planta asignada. Pedile al administrador que te la asigne.</div>
      </NavBar>
    );

  const plantasEditables = esAdmin ? plantas : plantas.filter((p) => p.id === miPlanta);

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="text-[22px] font-semibold">Órdenes de carga</h1>
          <p className="text-[13px] text-stone-500 mt-1 max-w-3xl">
            Las órdenes quedan guardadas acá. Cada planta ve las suyas y, al hacer un remito, elige la orden y sale precargado. Cargar o editar una orden no mueve stock: el stock baja al emitir el remito.
          </p>
        </div>

        {msg && (
          <div className={`text-[13.5px] rounded-lg border px-4 py-3 ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>
        )}

        {resultado && (
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-[13.5px] space-y-1.5">
            <div className="font-semibold">Orden {resultado.numero} guardada</div>
            {resultado.sin_lineas_para_tu_planta ? (
              <div className="text-amber-700">El archivo no trae líneas de tu planta: no se cargó nada.</div>
            ) : (
              <div className="text-stone-700">
                {resultado.nuevas} nueva(s) · {resultado.actualizadas} actualizada(s) · {resultado.sin_cambio} sin cambios · {resultado.eliminadas} quitada(s)
                {resultado.ignoradas > 0 && ` · ${resultado.ignoradas} de otras plantas ignorada(s)`}
              </div>
            )}
            {(resultado.bloqueadas || []).length > 0 && (
              <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
                <div className="font-medium mb-1">Estas líneas no se modificaron porque ya tienen remitos:</div>
                <ul className="list-disc ml-5 space-y-0.5">
                  {resultado.bloqueadas.map((b, i) => (
                    <li key={i}>{b.cliente} · {b.producto} · {b.lote || "sin lote"}: {b.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
            <button onClick={() => setResultado(null)} className="text-[12px] text-stone-500 hover:underline">Cerrar</button>
          </div>
        )}

        {!soloVista && (
          <div className="panel p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <span className={lab}>Cargar orden desde Excel (.xlsx, .xlsb)</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsb,.xlsm" onChange={handleFile} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
              </div>
              {esAdmin && !manual && (
                <button onClick={() => setManual({ numero: "", fecha: new Date().toISOString().slice(0, 10) })} className={btn2}>+ Nueva orden a mano</button>
              )}
            </div>
            {esAdmin && (
              <div className="border-t border-stone-200 pt-3">
                <button onClick={() => (sueltos ? setSueltos(null) : buscarSueltos())} className={btn2}>Registrar remitos ya emitidos</button>
                {sueltos && (
                  <div className="mt-2 space-y-1">
                    {sueltos.length === 0 && <div className="text-[13px] text-stone-500">No hay remitos con orden de carga sin vincular.</div>}
                    {sueltos.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-3 text-[13px]">
                        <span className="font-medium">{r.punto_venta}-{r.numero}</span>
                        <span className="text-stone-600">{r.cliente_nombre} · orden {r.orden_carga}</span>
                        <button onClick={() => vincularSuelto(r)} className={btn2}>Registrar en la orden</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!esAdmin && <div className="text-[12px] text-stone-500">Se cargan solo las líneas de tu planta ({profile.planta?.nombre}). Si la orden ya existe, se reemplazan las de tu planta por las del archivo.</div>}

            {manual && esAdmin && (
              <div className="grid gap-3 sm:grid-cols-3 items-end border-t border-stone-200 pt-3">
                <div>
                  <label className={lab}>Número de orden</label>
                  <input value={manual.numero} onChange={(e) => setManual({ ...manual, numero: up(e.target.value) })} placeholder="Ej: OC-SF-002" className={inp} />
                </div>
                <div>
                  <label className={lab}>Fecha</label>
                  <input type="date" value={manual.fecha} onChange={(e) => setManual({ ...manual, fecha: e.target.value })} className={inp} />
                </div>
                <div className="flex gap-2">
                  <button onClick={crearManual} className={btn}>Crear y agregar líneas</button>
                  <button onClick={() => setManual(null)} className={btn2}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {prev && (
          <div className="panel p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={lab}>Número de la orden</label>
                <input value={prev.numero} onChange={(e) => setPrev({ ...prev, numero: up(e.target.value) })} placeholder="OC-SF-000" className={inp} />
              </div>
              <div className="text-[13px] text-stone-600">
                Archivo: <b>{prev.archivo}</b> · {efectivas.length} línea(s) · se cargan <b>{aCargar.length}</b>
                {!esAdmin && efectivas.some(deOtraPlanta) && ` · ${efectivas.filter(deOtraPlanta).length} de otras plantas se ignoran`}
              </div>
            </div>

            {prev.depositosSinPlanta.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 space-y-2 text-[13px] text-amber-900">
                <div className="font-medium">Depósitos que no reconozco: elegí a qué planta corresponde cada uno.</div>
                {prev.depositosSinPlanta.map((d) => (
                  <div key={d} className="flex items-center gap-3 flex-wrap">
                    <span className="min-w-[180px]">“{d}”</span>
                    <select value={prev.mapa[d] || ""} onChange={(e) => setPrev({ ...prev, mapa: { ...prev.mapa, [d]: e.target.value } })} className={`${inp} max-w-xs`}>
                      <option value="">— no cargar —</option>
                      {plantasEditables.map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {prev.sinCatalogo.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                <div className="font-medium">Variedades que no están en el catálogo (ni como alias): {prev.sinCatalogo.join(", ")}.</div>
                <div className="text-[12px] mt-0.5">Se cargan igual, pero al hacer el remito saldrán como renglón sin stock. Agregá el producto o su alias en Administración → Productos.</div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-stone-500 border-b border-stone-200">
                    <th className="p-2">Planta</th><th className="p-2">Cliente</th><th className="p-2">Producto</th><th className="p-2">Lote</th><th className="p-2">O/V</th><th className="p-2 text-right">Cant.</th><th className="p-2">Catálogo</th>
                  </tr>
                </thead>
                <tbody>
                  {efectivas.map((l, i) => (
                    <tr key={i} className={`border-b border-stone-100 ${!l.planta_id || deOtraPlanta(l) ? "text-stone-400" : ""}`}>
                      <td className="p-2">{l.planta_id ? nombrePlanta(l.planta_id) : <span className="text-amber-700">sin planta ({l.deposito || "vacío"})</span>}</td>
                      <td className="p-2">{l.cliente}</td>
                      <td className="p-2">{l.producto_texto}</td>
                      <td className="p-2 font-mono">{l.lote_texto || "—"}</td>
                      <td className="p-2">{l.ov || "—"}</td>
                      <td className="p-2 text-right">{fmtNum(l.cantidad)}</td>
                      <td className="p-2">{l.producto_id ? <span className="text-emerald-700">✓</span> : <span className="text-amber-700">sin coincidencia</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={guardarPrev} disabled={guardando || !prev.numero.trim() || !aCargar.length} className={btn}>
                {guardando ? "Guardando…" : "Guardar orden"}
              </button>
              <button onClick={() => { setPrev(null); if (fileRef.current) fileRef.current.value = ""; }} className={btn2}>Cancelar</button>
            </div>
            <div className="text-[12px] text-stone-500">Si la orden ya existe, se reemplazan las líneas de esos depósitos. Las que ya tienen remitos no se pueden quitar ni cambiar de cliente, producto o lote.</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${inp} max-w-[220px]`}>
            <option value="pendientes">Con saldo pendiente</option>
            <option value="todas">Todas</option>
          </select>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por N° de orden, cliente, producto o lote…" className={`${inp} max-w-md`} />
        </div>

        {cargando ? (
          <div className="text-sm text-stone-500">Cargando…</div>
        ) : lista.length === 0 ? (
          <div className="panel p-6 text-sm text-stone-500">{filtro === "pendientes" ? "No hay órdenes con saldo pendiente." : "No hay órdenes cargadas."}</div>
        ) : (
          <div className="space-y-3">
            {lista.map((o) => {
              const ls = lineasDe[o.id] || [];
              const est = estadoOrden(o, ls);
              const ped = ls.reduce((a, l) => a + Number(l.cantidad), 0);
              const rem = ls.reduce((a, l) => a + Number(l.remitido), 0);
              const plantasOrden = [...new Set(ls.map((l) => l.planta_nombre))];
              const open = abierta === o.id;
              return (
                <div key={o.id} className="panel overflow-hidden">
                  <button onClick={() => abrir(o.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-stone-50">
                    <span className="font-semibold text-[15px]">{o.numero}</span>
                    <span className={`text-[11px] font-medium border rounded px-1.5 py-0.5 ${est.cls}`}>{est.txt}</span>
                    <span className="text-[12.5px] text-stone-500">{fmtFecha(o.fecha)} · {o.origen === "manual" ? "creada a mano" : "desde Excel"}{o.creado_por_nombre ? ` · ${o.creado_por_nombre}` : ""}</span>
                    <span className="text-[12.5px] text-stone-500">{plantasOrden.join(", ")}</span>
                    <span className="ml-auto text-[13px] text-stone-700">Pedido {fmtNum(ped)} · Remitido {fmtNum(rem)} · Saldo <b>{fmtNum(Math.max(0, ped - rem))}</b></span>
                  </button>
                  {open && (
                    <div className="border-t border-stone-200 px-4 py-3 space-y-3">
                      {o.estado === "anulada" && (
                        <div className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded p-2">Anulada por {o.anulada_por_nombre} el {new Date(o.anulada_at).toLocaleString("es-AR")}. Motivo: {o.motivo_anulacion}</div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="text-left text-stone-500 border-b border-stone-200">
                              <th className="p-2">Planta</th><th className="p-2">Cliente</th><th className="p-2">Producto</th><th className="p-2">Lote</th><th className="p-2">O/V</th>
                              <th className="p-2 text-right">Pedido</th><th className="p-2 text-right">Remitido</th><th className="p-2 text-right">Saldo</th><th className="p-2">Remitos</th><th className="p-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {ls.map((l) => (
                              <Fragment key={l.id}>
                                <tr className="border-b border-stone-100 align-top">
                                  <td className="p-2">{l.planta_nombre}</td>
                                  <td className="p-2">
                                    {l.cliente}
                                    <div className="text-[11.5px] text-stone-400">{[l.domicilio, l.provincia].filter(Boolean).join(" · ")}</div>
                                  </td>
                                  <td className="p-2">{l.producto_texto}{!l.producto_id && <span className="ml-1 text-[11px] text-amber-700">(sin catálogo)</span>}</td>
                                  <td className="p-2 font-mono">{l.lote_texto || "—"}</td>
                                  <td className="p-2">{l.ov || "—"}</td>
                                  <td className="p-2 text-right">{fmtNum(l.cantidad)}</td>
                                  <td className="p-2 text-right">{fmtNum(l.remitido)}</td>
                                  <td className={`p-2 text-right font-semibold ${Number(l.saldo) <= 0 ? "text-emerald-700" : ""}`}>{fmtNum(Math.max(0, l.saldo))}</td>
                                  <td className="p-2 text-[12px] text-stone-600">{(remitosDe[l.id] || []).join(", ") || "—"}</td>
                                  <td className="p-2 whitespace-nowrap text-right">
                                    {o.estado !== "anulada" && puedeEditar(l) && (
                                      <>
                                        <button onClick={() => editar(l)} className="text-emerald-700 hover:underline text-[12.5px] mr-3">Editar</button>
                                        {Number(l.remitido) === 0 && <button onClick={() => quitarLinea(l)} className="text-red-600 hover:underline text-[12.5px]">Quitar</button>}
                                      </>
                                    )}
                                  </td>
                                </tr>
                              </Fragment>
                            ))}
                            {ls.length === 0 && (
                              <tr><td colSpan={10} className="p-3 text-stone-500">La orden todavía no tiene líneas.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {edit && edit.ordenId === o.id && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                          <div className="font-medium text-[14px]">{edit.lineaId ? "Editar línea" : "Agregar línea"}</div>
                          {edit.tieneRemitos && (
                            <div className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                              Esta línea ya tiene remitos: no se puede cambiar el cliente, el producto, el lote, la O/V ni la planta, y la cantidad no puede quedar por debajo de lo remitido.
                            </div>
                          )}
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className={lab}>Planta (depósito)</label>
                              <select value={edit.data.planta_id || (esAdmin ? "" : miPlanta || "")} onChange={(e) => setD({ planta_id: e.target.value })} disabled={!esAdmin || edit.tieneRemitos} className={inp}>
                                <option value="">Elegir…</option>
                                {plantasEditables.map((p) => (
                                  <option key={p.id} value={p.id}>{p.nombre}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className={lab}>Cliente</label>
                              <input value={edit.data.cliente} onChange={(e) => setD({ cliente: up(e.target.value) })} disabled={edit.tieneRemitos} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>CUIT</label>
                              <input value={edit.data.cuit} onChange={(e) => setD({ cuit: e.target.value })} className={inp} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={lab}>Domicilio (dirección y localidad)</label>
                              <input value={edit.data.domicilio} onChange={(e) => setD({ domicilio: e.target.value })} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>Provincia</label>
                              <select value={edit.data.provincia} onChange={(e) => setD({ provincia: e.target.value })} className={inp}>
                                <option value="">—</option>
                                {PROVINCIAS.map((p) => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className={lab}>Entregar en</label>
                              <input value={edit.data.entregar_en} onChange={(e) => setD({ entregar_en: e.target.value })} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>Contacto</label>
                              <input value={edit.data.contacto} onChange={(e) => setD({ contacto: e.target.value })} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>Teléfono</label>
                              <input value={edit.data.telefono} onChange={(e) => setD({ telefono: e.target.value })} className={inp} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={lab}>Producto del catálogo</label>
                              <select value={edit.data.producto_id} onChange={(e) => elegirProducto(e.target.value)} disabled={edit.tieneRemitos} className={inp}>
                                <option value="">— elegir —</option>
                                {productos.filter((p) => p.categoria === "soja").map((p) => (
                                  <option key={p.id} value={p.id}>{p.nombre}{p.presentacion ? ` · ${p.presentacion}` : ""}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className={lab}>Producto como figura en la orden</label>
                              <input value={edit.data.producto_texto} onChange={(e) => setD({ producto_texto: e.target.value })} disabled={edit.tieneRemitos} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>Lote</label>
                              <input value={edit.data.lote_texto} onChange={(e) => setD({ lote_texto: up(e.target.value) })} disabled={edit.tieneRemitos} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>O/V</label>
                              <input value={edit.data.ov} onChange={(e) => setD({ ov: e.target.value })} disabled={edit.tieneRemitos} className={inp} />
                            </div>
                            <div>
                              <label className={lab}>Cantidad (unidades)</label>
                              <input value={edit.data.cantidad} onChange={(e) => setD({ cantidad: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" className={inp} />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={guardarLinea} className={btn}>Guardar línea</button>
                            <button onClick={() => setEdit(null)} className={btn2}>Cancelar</button>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 items-start">
                        {o.estado !== "anulada" && !soloVista && (!edit || edit.ordenId !== o.id) && (esAdmin || ls.some((l) => l.planta_id === miPlanta)) && (
                          <button onClick={() => setEdit({ ordenId: o.id, lineaId: null, data: { ...LINEA_VACIA, planta_id: esAdmin ? "" : miPlanta }, tieneRemitos: false })} className={btn2}>+ Agregar línea</button>
                        )}
                        {(esAdmin || soloVista) && (
                          <button onClick={() => (log?.id === o.id ? setLog(null) : verLog(o.id))} className={btn2}>{log?.id === o.id ? "Ocultar cambios" : "Ver cambios"}</button>
                        )}
                        {esAdmin && o.estado !== "anulada" && anulando?.id !== o.id && (
                          <button onClick={() => setAnulando({ id: o.id, motivo: "" })} className="border border-red-300 text-red-700 text-[13px] px-3 py-1.5 rounded-md">Anular orden…</button>
                        )}
                        {anulando?.id === o.id && (
                          <div className="flex-1 min-w-[260px] space-y-2">
                            <textarea value={anulando.motivo} onChange={(e) => setAnulando({ ...anulando, motivo: e.target.value })} rows={2} placeholder="Motivo de la anulación (obligatorio)" className={inp} />
                            <div className="flex gap-2">
                              <button onClick={anular} className="bg-red-600 text-white text-[13px] px-3 py-1.5 rounded-md">Confirmar anulación</button>
                              <button onClick={() => setAnulando(null)} className="text-[13px] text-stone-500">Cancelar</button>
                            </div>
                            <div className="text-[12px] text-stone-400">Solo se puede anular si ninguna línea tiene remitos emitidos.</div>
                          </div>
                        )}
                      </div>

                      {log?.id === o.id && (
                        <div className="text-[12.5px] border border-stone-200 rounded p-3 bg-stone-50 space-y-1 max-h-64 overflow-auto">
                          {log.filas.length === 0 && <div className="text-stone-500">Sin cambios registrados.</div>}
                          {log.filas.map((f) => (
                            <div key={f.id}>
                              <span className="text-stone-400">{new Date(f.created_at).toLocaleString("es-AR")}</span> · <b>{f.usuario_nombre}</b> · {f.accion}: {f.detalle}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </NavBar>
  );
}
