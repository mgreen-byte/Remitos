"use client";

import { descargarOrdenPdf } from "@/lib/ordenPdf";
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
  if (o.estado === "cerrada") return { txt: "Cerrada", cls: "bg-stone-200 text-stone-700 border-stone-300" };
  if (!lineas.length) return { txt: "Sin líneas", cls: "bg-stone-100 text-stone-600 border-stone-200" };
  const saldo = lineas.reduce((a, l) => a + Math.max(0, Number(l.saldo)), 0);
  const rem = lineas.reduce((a, l) => a + Number(l.remitido), 0);
  if (saldo <= 0) return { txt: "Completa", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (rem > 0) return { txt: "Parcial", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { txt: "Pendiente", cls: "bg-sky-50 text-sky-800 border-sky-200" };
}

function OrdenesInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const poderAdmin = esAdmin || profile.rol === "logistica"; // Logística opera sobre todas las plantas, pero no edita órdenes completadas
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
  const [plantaSel, setPlantaSel] = useState(profile.rol === "operador" && miPlanta ? miPlanta : ""); // despacho a clientes
  const [origenSel, setOrigenSel] = useState(""); // traslados
  const [destinoSel, setDestinoSel] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [remitosDe, setRemitosDe] = useState({});
  const [log, setLog] = useState(null);
  const [prev, setPrev] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [manual, setManual] = useState(null);
  const [edit, setEdit] = useState(null); // {ordenId, lineaId|null, data, tieneRemitos}
  const [anulando, setAnulando] = useState(null);
  const [renglones, setRenglones] = useState(null); // renglones de remitos sin vincular a una línea
  const [sueltos, setSueltos] = useState(null); // remitos con número de orden y sin vincular
  const [vista, setVista] = useState("clientes"); // clientes | traslados
  const [nuevoT, setNuevoT] = useState(null); // {origen, destino}
  const [lineaT, setLineaT] = useState(null); // {ordenId, lineaId|null, producto_id, lote_texto, cantidad, prioridad}
  const [lotesOrigen, setLotesOrigen] = useState([]);
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

  // Renglones visibles de una orden: en despacho a clientes, si hay planta elegida, solo los de esa planta.
  const lineasVis = useCallback((o) => {
    const ls = lineasDe[o.id] || [];
    return o.modalidad !== "traslado" && plantaSel ? ls.filter((l) => l.planta_id === plantaSel) : ls;
  }, [lineasDe, plantaSel]);
  const pendiente = (o, ls) => o.estado === "activa" && ls.some((l) => Number(l.saldo) > 0);
  // Botonera: solo plantas con órdenes pendientes (y cuántas)
  const chips = useMemo(() => {
    const cuenta = (m) => (id) => m[id] || 0;
    const cli = {}, ori = {}, des = {};
    for (const o of ordenes) {
      const ls = lineasDe[o.id] || [];
      if (o.modalidad === "traslado") {
        if (!pendiente(o, ls)) continue;
        ori[o.planta_origen_id] = (ori[o.planta_origen_id] || 0) + 1;
        des[o.planta_destino_id] = (des[o.planta_destino_id] || 0) + 1;
      } else {
        for (const pid of new Set(ls.filter((l) => o.estado === "activa" && Number(l.saldo) > 0).map((l) => l.planta_id))) cli[pid] = (cli[pid] || 0) + 1;
      }
    }
    const arr = (m) => plantas.filter((p) => m[p.id]).map((p) => ({ id: p.id, nombre: p.nombre, n: m[p.id] }));
    return { cli: arr(cli), ori: arr(ori), des: arr(des), cuenta };
  }, [ordenes, lineasDe, plantas]);

  const lista = useMemo(() => {
    const q = norm(buscar);
    return ordenes.filter((o) => {
      if ((o.modalidad === "traslado") !== (vista === "traslados")) return false;
      if (vista === "traslados") {
        if (origenSel && o.planta_origen_id !== origenSel) return false;
        if (destinoSel && o.planta_destino_id !== destinoSel) return false;
      } else if (plantaSel && lineasVis(o).length === 0) return false;
      const ls = lineasVis(o);
      if (filtro === "pendientes" && (o.estado === "anulada" || o.estado === "cerrada" || !ls.some((l) => Number(l.saldo) > 0))) return false;
      if (q && !(norm(o.numero).includes(q) || ls.some((l) => norm(l.cliente).includes(q) || norm(l.producto_texto).includes(q) || norm(l.lote_texto).includes(q)))) return false;
      return true;
    }).sort((a, b) => {
      // Primero lo pendiente, con la fecha de carga más próxima arriba (las sin fecha al final); después lo demás.
      const pend = (o) => (o.estado === "activa" && (lineasDe[o.id] || []).some((l) => Number(l.saldo) > 0) ? 0 : 1);
      return pend(a) - pend(b) || String(a.fecha_carga || "9999").localeCompare(String(b.fecha_carga || "9999")) || String(b.created_at).localeCompare(String(a.created_at));
    });
  }, [ordenes, lineasDe, lineasVis, filtro, buscar, vista, plantaSel, origenSel, destinoSel]);
  const resumen = useMemo(() => {
    let ped = 0, rem = 0;
    for (const o of lista) {
      if (o.estado === "anulada") continue;
      for (const l of lineasVis(o)) { ped += Number(l.cantidad); rem += Number(l.remitido); }
    }
    return { ped, rem, saldo: Math.max(0, ped - rem) };
  }, [lista, lineasVis]);
  const hoyISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const badgeCarga = (o, ls) => {
    if (!o.fecha_carga) return null;
    const pend = o.estado === "activa" && ls.some((l) => Number(l.saldo) > 0);
    const cls = pend && o.fecha_carga < hoyISO ? "bg-red-50 text-red-700 border-red-300" : pend && o.fecha_carga === hoyISO ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-stone-50 text-stone-700 border-stone-200";
    const txt = pend && o.fecha_carga < hoyISO ? "Carga vencida " : pend && o.fecha_carga === hoyISO ? "Carga HOY " : "Carga prevista ";
    return <span className={`text-[11.5px] font-medium border rounded px-1.5 py-0.5 ${cls}`}>{txt}{fmtFecha(o.fecha_carga)}</span>;
  };

  // Una orden completada (para la planta) solo la modifica el administrador.
  const completaPlanta = (o, pid) => {
    const ls = (lineasDe[o.id] || []).filter((x) => x.planta_id === pid);
    return ls.length > 0 && ls.every((x) => Number(x.saldo) <= 0);
  };
  const puedeEditar = (l, o) => !soloVista && (esAdmin || ((poderAdmin || l.planta_id === miPlanta) && !(o && completaPlanta(o, l.planta_id))));

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
        setPrev({ archivo: file.name, numero: parsed.ordenCarga || "", fechaCarga: parsed.fechaCarga || "", lineas: ls, depositosSinPlanta, sinCatalogo, mapa: {} });
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
  const deOtraPlanta = (l) => !poderAdmin && l.planta_id && l.planta_id !== miPlanta;
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
    if (!error && prev.fechaCarga) {
      const r2 = await supabase.rpc("fijar_fecha_carga_excel", { p_numero: up(prev.numero).trim(), p_fecha: prev.fechaCarga });
      if (r2.error) setMsg({ tipo: "error", texto: "La orden se guardó, pero no pude guardar la fecha de carga: " + friendlyError(r2.error) });
    }
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
    if (manual.fechaCarga) await supabase.rpc("fijar_fecha_carga", { p_orden_id: data, p_fecha: manual.fechaCarga });
    setManual(null);
    await cargar();
    abrir(data);
    setEdit({ ordenId: data, lineaId: null, data: { ...LINEA_VACIA }, tieneRemitos: false });
    setMsg({ tipo: "ok", texto: "Orden creada. Agregá las líneas." });
  };

  // ---------- órdenes de traslado (Administrador y Logística) ----------
  const nombrePlantaT = (id) => plantas.find((p) => p.id === id)?.nombre || "—";
  const crearTraslado = async () => {
    setMsg(null);
    const { data, error } = await supabase.rpc("crear_orden_traslado", { p_origen: nuevoT.origen, p_destino: nuevoT.destino, p_fecha: null });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    const origen = nuevoT.origen;
    if (nuevoT.fechaCarga) await supabase.rpc("fijar_fecha_carga", { p_orden_id: data, p_fecha: nuevoT.fechaCarga });
    setNuevoT(null);
    await cargar();
    await abrir(data);
    await abrirLineaT(data, origen, null);
    setMsg({ tipo: "ok", texto: "Orden de traslado creada. Agregá los lotes." });
  };
  const abrirLineaT = async (ordenId, origenId, l) => {
    const { data } = await supabase.from("lotes").select("producto_id, lote, stock").eq("planta_id", origenId).gt("stock", 0).order("lote");
    setLotesOrigen(data || []);
    setLineaT(
      l
        ? { ordenId, lineaId: l.id, producto_id: l.producto_id || "", lote_texto: l.lote_texto, cantidad: String(l.cantidad), prioridad: String(l.prioridad ?? ""), tieneRemitos: Number(l.remitido) > 0 }
        : { ordenId, lineaId: null, producto_id: "", lote_texto: "", cantidad: "", prioridad: "", tieneRemitos: false }
    );
  };
  const guardarLineaT = async () => {
    setMsg(null);
    const d = lineaT;
    const cantidad = Number(String(d.cantidad).replace(",", "."));
    const { error } = d.lineaId
      ? await supabase.rpc("guardar_orden_linea", { p_linea_id: d.lineaId, p_data: { cantidad } })
      : await supabase.rpc("agregar_linea_traslado", { p_orden_id: d.ordenId, p_data: { producto_id: d.producto_id, lote_texto: d.lote_texto, cantidad, prioridad: d.prioridad === "" ? null : Number(d.prioridad) } });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: d.lineaId ? "Cantidad guardada." : "Lote agregado a la orden." });
    const id = d.ordenId;
    setLineaT(null);
    await cargar();
    cargarRemitos(id);
  };
  const guardarFechaCarga = async (o, valor) => {
    const { error } = await supabase.rpc("fijar_fecha_carga", { p_orden_id: o.id, p_fecha: valor || null });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: valor ? `Fecha prevista de carga de ${o.numero}: ${fmtFecha(valor)}.` : `Se quitó la fecha prevista de carga de ${o.numero}.` });
    await cargar();
  };
  const cambiarPrioridad = async (l, valor) => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) return setMsg({ tipo: "error", texto: "La prioridad es un número entero desde 1 (1 = más urgente)." });
    if (n === Number(l.prioridad)) return;
    const { error } = await supabase.rpc("cambiar_prioridad_linea", { p_linea_id: l.id, p_prioridad: n });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `Prioridad de ${l.producto_texto} · ${l.lote_texto} → ${n}.` });
    await cargar();
  };

  // ---------- remitos hechos antes del módulo (solo administrador) ----------
  const buscarSueltos = async () => {
    setMsg(null);
    const { data, error } = await supabase.from("remitos").select("id, punto_venta, numero, fecha, cliente_nombre, orden_carga, estado")
      .not("orden_carga", "is", null).is("orden_id", null).not("estado", "in", "(anulado,rechazado)").order("created_at", { ascending: false }).limit(200);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setSueltos((data || []).filter((r) => String(r.orden_carga).trim()));
  };
  const buscarRenglones = async () => {
    setMsg(null);
    const [it, ln] = await Promise.all([
      supabase.from("remito_items")
        .select("id, cantidad, lote_texto, precinto, producto_id, remito:remitos!inner(id, punto_venta, numero, orden_carga, orden_id, estado, planta_id)")
        .is("orden_linea_id", null).not("producto_id", "is", null).not("remito.orden_carga", "is", null).not("remito.estado", "in", "(anulado,rechazado)").limit(300),
      supabase.from("v_ordenes_lineas_saldo").select("id, orden_numero, cliente, producto_id, lote_texto, planta_id, saldo, cantidad").gt("saldo", 0).limit(1000),
    ]);
    if (it.error || ln.error) return setMsg({ tipo: "error", texto: friendlyError(it.error || ln.error) });
    const lineas = ln.data || [];
    setRenglones(
      (it.data || [])
        .filter((x) => String(x.remito?.orden_carga || "").trim())
        .map((x) => {
          const cand = lineas.filter((l) => l.producto_id === x.producto_id && l.planta_id === x.remito.planta_id);
          const buenas = cand.filter((l) => String(l.orden_numero).toUpperCase() === String(x.remito.orden_carga).trim().toUpperCase() && String(l.lote_texto).toUpperCase() === String(x.lote_texto || "").toUpperCase());
          return { ...x, cand, elegida: buenas.length === 1 ? buenas[0].id : "" };
        })
    );
  };
  const vincularRenglon = async (x) => {
    if (!x.elegida) return;
    const { error } = await supabase.rpc("vincular_renglon_remito", { p_item_id: x.id, p_linea_id: x.elegida });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `Renglón del remito ${x.remito.punto_venta}-${x.remito.numero} vinculado a la orden.` });
    await cargar();
    await buscarRenglones();
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

  const cerrarOrden = async (o) => {
    const motivo = window.prompt(`Cerrar la orden ${o.numero}: deja de comprometer stock y de ofrecerse al remitir. Lo ya remitido no cambia. Motivo (opcional):`, "");
    if (motivo === null) return;
    const { error } = await supabase.rpc("cerrar_orden", { p_orden_id: o.id, p_motivo: motivo });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `Orden ${o.numero} cerrada.` });
    await cargar();
  };
  const reabrirOrden = async (o) => {
    if (!window.confirm(`¿Reabrir la orden ${o.numero}? Vuelve a comprometer stock con su saldo pendiente.`)) return;
    const { error } = await supabase.rpc("reabrir_orden", { p_orden_id: o.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `Orden ${o.numero} reabierta.` });
    await cargar();
  };
  const anular = async () => {
    const { error } = await supabase.rpc("anular_orden", { p_orden_id: anulando.id, p_motivo: anulando.motivo });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setAnulando(null);
    setMsg({ tipo: "ok", texto: "Orden anulada." });
    cargar();
  };

  const eliminar = async (o) => {
    if (!window.confirm(`¿Eliminar la orden ${o.numero} y todas sus líneas? No se puede deshacer. Solo se puede si no tiene remitos.`)) return;
    const { error } = await supabase.rpc("eliminar_orden", { p_orden_id: o.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setAbierta(null);
    setMsg({ tipo: "ok", texto: `Orden ${o.numero} eliminada.` });
    cargar();
  };

  if (sinPlanta)
    return (
      <NavBar profile={profile}>
        <div className="max-w-3xl mx-auto p-6 text-sm text-stone-600">Tu usuario no tiene planta asignada. Pedile al administrador que te la asigne.</div>
      </NavBar>
    );

  const plantasEditables = poderAdmin ? plantas : plantas.filter((p) => p.id === miPlanta);

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="text-[22px] font-semibold">{vista === "traslados" ? "Órdenes de traslado" : "Órdenes de carga"}</h1>
          <p className="text-[13px] text-stone-500 mt-1 max-w-3xl">
            Las órdenes quedan guardadas acá. Cada planta ve las suyas y, al hacer un remito, elige la orden y sale precargado. Cargar o editar una orden no mueve stock: el stock baja al emitir el remito.
          </p>
        </div>

        <div className="flex gap-2">
          {[["clientes", "Despacho a clientes"], ["traslados", "Traslados entre plantas"]].map(([k, t]) => (
            <button key={k} onClick={() => { setVista(k); setAbierta(null); setEdit(null); setLineaT(null); }} className={`px-4 py-2 rounded-md text-[13.5px] border ${vista === k ? "bg-emerald-700 text-white border-emerald-700" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}>{t}</button>
          ))}
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

        {vista === "traslados" && poderAdmin && (
          <div className="panel p-4 space-y-3">
            {!nuevoT ? (
              <button onClick={() => setNuevoT({ origen: "", destino: "" })} className={btn2}>+ Nueva orden de traslado</button>
            ) : (
              <div className="grid gap-3 sm:grid-cols-4 items-end">
                <div>
                  <label className={lab}>Planta de origen (sale el stock)</label>
                  <select value={nuevoT.origen} onChange={(e) => setNuevoT({ ...nuevoT, origen: e.target.value, destino: nuevoT.destino === e.target.value ? "" : nuevoT.destino })} className={inp}>
                    <option value="">Elegir…</option>
                    {plantas.map((p) => (<option key={p.id} value={p.id}>{p.nombre}{p.prefijo ? ` (${p.prefijo})` : " — sin prefijo"}</option>))}
                  </select>
                </div>
                <div>
                  <label className={lab}>Planta de destino</label>
                  <select value={nuevoT.destino} onChange={(e) => setNuevoT({ ...nuevoT, destino: e.target.value })} className={inp}>
                    <option value="">Elegir…</option>
                    {plantas.filter((p) => p.id !== nuevoT.origen).map((p) => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
                  </select>
                </div>
                <div>
                  <label className={lab}>Fecha prevista de carga (opcional)</label>
                  <input type="date" value={nuevoT.fechaCarga || ""} onChange={(e) => setNuevoT({ ...nuevoT, fechaCarga: e.target.value })} className={inp} />
                </div>
                <div className="flex gap-2">
                  <button onClick={crearTraslado} disabled={!nuevoT.origen || !nuevoT.destino} className={btn}>Crear y agregar lotes</button>
                  <button onClick={() => setNuevoT(null)} className={btn2}>Cancelar</button>
                </div>
              </div>
            )}
            <div className="text-[12px] text-stone-500">Una orden va de una planta a otra. El número sale solo: OC-(prefijo de la planta de origen)-001, correlativo por planta. Cada renglón es un lote, con su prioridad (1 = más urgente), que se puede cambiar en cualquier momento.</div>
          </div>
        )}

        {vista === "clientes" && !soloVista && (
          <div className="panel p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <span className={lab}>Cargar orden desde Excel (.xlsx, .xlsb)</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsb,.xlsm" onChange={handleFile} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
              </div>
              {poderAdmin && !manual && (
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
            {poderAdmin && (
              <div className="border-t border-stone-200 pt-3">
                <button onClick={() => (renglones ? setRenglones(null) : buscarRenglones())} className={btn2}>Vincular renglones de remitos sin orden</button>
                {renglones && (
                  <div className="mt-2 space-y-2">
                    {renglones.length === 0 && <div className="text-[13px] text-stone-500">No hay renglones de remitos con orden de carga sin vincular.</div>}
                    {renglones.map((x) => (
                      <div key={x.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-medium">{x.remito.punto_venta}-{x.remito.numero}</span>
                        <span className="text-stone-600">orden {x.remito.orden_carga} · lote {x.lote_texto} · {fmtNum(x.cantidad)} u.{x.precinto ? ` · ${String(x.precinto).slice(0, 40)}` : ""}</span>
                        <select value={x.elegida} onChange={(e) => setRenglones((a) => a.map((y) => (y.id === x.id ? { ...y, elegida: e.target.value } : y)))} className="border border-stone-300 rounded px-1 py-1 text-[12px] max-w-[360px]">
                          <option value="">{x.cand.length ? "Elegir línea de la orden…" : "No hay líneas con saldo para este producto"}</option>
                          {x.cand.map((l) => (
                            <option key={l.id} value={l.id}>{l.orden_numero} · {l.cliente} · lote {l.lote_texto} · saldo {fmtNum(l.saldo)}</option>
                          ))}
                        </select>
                        <button disabled={!x.elegida} onClick={() => vincularRenglon(x)} className={btn2}>Vincular</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!poderAdmin && <div className="text-[12px] text-stone-500">Se cargan solo las líneas de tu planta ({profile.planta?.nombre}). Si la orden ya existe, se reemplazan las de tu planta por las del archivo.</div>}

            {manual && poderAdmin && (
              <div className="grid gap-3 sm:grid-cols-4 items-end border-t border-stone-200 pt-3">
                <div>
                  <label className={lab}>Número de orden</label>
                  <input value={manual.numero} onChange={(e) => setManual({ ...manual, numero: up(e.target.value) })} placeholder="Ej: OC-SF-002" className={inp} />
                </div>
                <div>
                  <label className={lab}>Fecha</label>
                  <input type="date" value={manual.fecha} onChange={(e) => setManual({ ...manual, fecha: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className={lab}>Fecha prevista de carga (opcional)</label>
                  <input type="date" value={manual.fechaCarga || ""} onChange={(e) => setManual({ ...manual, fechaCarga: e.target.value })} className={inp} />
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
              <div>
                <label className={lab}>Fecha prevista de carga</label>
                <input type="date" value={prev.fechaCarga || ""} onChange={(e) => setPrev({ ...prev, fechaCarga: e.target.value })} className={inp} />
              </div>
              <div className="text-[13px] text-stone-600">
                Archivo: <b>{prev.archivo}</b> · {efectivas.length} línea(s) · se cargan <b>{aCargar.length}</b>
                {!poderAdmin && efectivas.some(deOtraPlanta) && ` · ${efectivas.filter(deOtraPlanta).length} de otras plantas se ignoran`}
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

        {(() => {
          const Chip = ({ activo, onClick, children }) => (
            <button onClick={onClick} className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] border whitespace-nowrap ${activo ? "bg-emerald-700 text-white border-emerald-700" : "border-stone-300 text-stone-700 bg-white hover:bg-stone-50"}`}>{children}</button>
          );
          const fila = (titulo, lista, sel, setSel) => (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {titulo && <span className="text-[12px] text-stone-500 shrink-0 w-14">{titulo}</span>}
              <Chip activo={!sel} onClick={() => setSel("")}>Todas</Chip>
              {lista.map((p) => (
                <Chip key={p.id} activo={sel === p.id} onClick={() => setSel(p.id)}>{p.nombre} <span className={sel === p.id ? "opacity-90" : "text-stone-500"}>· {p.n}</span></Chip>
              ))}
              {sel && !lista.some((p) => p.id === sel) && <Chip activo onClick={() => setSel("")}>{nombrePlanta(sel)} · 0</Chip>}
            </div>
          );
          return vista === "traslados" ? (
            <div className="space-y-1">
              {fila("Origen", chips.ori, origenSel, setOrigenSel)}
              {fila("Destino", chips.des, destinoSel, setDestinoSel)}
            </div>
          ) : (
            fila(null, chips.cli, plantaSel, setPlantaSel)
          );
        })()}

        {((vista === "clientes" && plantaSel) || (vista === "traslados" && (origenSel || destinoSel))) && (
          <div className="text-[13.5px] text-stone-700 bg-white border border-stone-200 rounded-md px-3 py-2">
            <b>{vista === "traslados" ? [origenSel && `Sale de ${nombrePlanta(origenSel)}`, destinoSel && `Llega a ${nombrePlanta(destinoSel)}`].filter(Boolean).join(" · ") : nombrePlanta(plantaSel)}</b>
            {" · "}Pedido {fmtNum(resumen.ped)} · Remitido {fmtNum(resumen.rem)} · Saldo <b>{fmtNum(resumen.saldo)}</b> u.
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
              const ls = lineasVis(o);
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
                    {badgeCarga(o, ls)}
                    <span className="text-[12.5px] text-stone-500">creada {fmtFecha(o.fecha)} · {o.origen === "manual" ? "creada a mano" : "desde Excel"}{o.creado_por_nombre ? ` · ${o.creado_por_nombre}` : ""}</span>
                    <span className="text-[12.5px] text-stone-500">{o.modalidad === "traslado" ? `${nombrePlantaT(o.planta_origen_id)} → ${nombrePlantaT(o.planta_destino_id)}` : plantasOrden.join(", ")}</span>
                    {o.modalidad === "traslado" && miPlanta && o.planta_destino_id === miPlanta && <span className="text-[11px] font-medium border rounded px-1.5 py-0.5 bg-violet-50 text-violet-800 border-violet-200">Llega a tu planta</span>}
                    <span className="ml-auto text-[13px] text-stone-700">Pedido {fmtNum(ped)} · Remitido {fmtNum(rem)} · Saldo <b>{fmtNum(Math.max(0, ped - rem))}</b></span>
                  </button>
                  {open && (
                    <div className="border-t border-stone-200 px-4 py-3 space-y-3">
                      {poderAdmin && o.estado !== "anulada" && (
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <label className="text-stone-600">Fecha prevista de carga</label>
                          <input key={`${o.id}-${o.fecha_carga || ""}`} type="date" defaultValue={o.fecha_carga || ""} onChange={(e) => guardarFechaCarga(o, e.target.value)} className="border border-stone-300 rounded px-2 py-1 text-[13px]" />
                        </div>
                      )}
                      {o.estado === "cerrada" && (
                        <div className="text-[12.5px] text-stone-700 bg-stone-100 border border-stone-300 rounded p-2">Cerrada por {o.cerrada_por_nombre} el {o.cerrada_at ? new Date(o.cerrada_at).toLocaleString("es-AR") : ""}.{o.motivo_cierre ? ` Motivo: ${o.motivo_cierre}.` : ""} No cuenta como comprometido ni se ofrece al remitir.</div>
                      )}
                      {o.estado === "anulada" && (
                        <div className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded p-2">Anulada por {o.anulada_por_nombre} el {new Date(o.anulada_at).toLocaleString("es-AR")}. Motivo: {o.motivo_anulacion}</div>
                      )}
                      {o.modalidad === "traslado" ? (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                              <thead>
                                <tr className="text-left text-stone-500 border-b border-stone-200">
                                  <th className="p-2 w-24">Prioridad</th><th className="p-2">Producto</th><th className="p-2">Lote</th>
                                  <th className="p-2 text-right">Pedido</th><th className="p-2 text-right">Remitido</th><th className="p-2 text-right">Saldo</th><th className="p-2">Remitos</th><th className="p-2"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...ls].sort((a, b) => (a.prioridad ?? 9999) - (b.prioridad ?? 9999) || String(a.lote_texto).localeCompare(String(b.lote_texto))).map((l) => (
                                  <tr key={l.id} className="border-b border-stone-100 align-top">
                                    <td className="p-2">
                                      {poderAdmin && o.estado !== "anulada" ? (
                                        <input key={`${l.id}-${l.prioridad}`} type="number" min="1" step="1" defaultValue={l.prioridad ?? ""} aria-label="Prioridad"
                                          onBlur={(e) => e.target.value !== String(l.prioridad ?? "") && cambiarPrioridad(l, e.target.value)}
                                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                                          className="w-16 border border-stone-300 rounded px-2 py-1 text-[13px] text-center" />
                                      ) : (
                                        <span className="font-semibold">{l.prioridad ?? "—"}</span>
                                      )}
                                    </td>
                                    <td className="p-2">{l.producto_texto}{l.presentacion ? <span className="text-stone-400"> · {l.presentacion}</span> : null}</td>
                                    <td className="p-2 font-mono">{l.lote_texto}</td>
                                    <td className="p-2 text-right">{fmtNum(l.cantidad)}</td>
                                    <td className="p-2 text-right">{fmtNum(l.remitido)}</td>
                                    <td className={`p-2 text-right font-semibold ${Number(l.saldo) <= 0 ? "text-emerald-700" : ""}`}>{fmtNum(Math.max(0, l.saldo))}</td>
                                    <td className="p-2 text-[12px] text-stone-600">{(remitosDe[l.id] || []).join(", ") || "—"}</td>
                                    <td className="p-2 whitespace-nowrap text-right">
                                      {poderAdmin && o.estado === "activa" && (
                                        <>
                                          <button onClick={() => abrirLineaT(o.id, o.planta_origen_id, l)} className="text-emerald-700 hover:underline text-[12.5px] mr-3">Editar cantidad</button>
                                          {Number(l.remitido) === 0 && <button onClick={() => quitarLinea(l)} className="text-red-600 hover:underline text-[12.5px]">Quitar</button>}
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {ls.length === 0 && <tr><td colSpan={8} className="p-3 text-stone-500">La orden todavía no tiene lotes.</td></tr>}
                              </tbody>
                            </table>
                          </div>
                          {!poderAdmin && !soloVista && miPlanta === o.planta_destino_id && (
                            <div className="text-[12.5px] text-stone-500">Esta orden llega a tu planta: es solo informativa. Cuando salga el remito de traslado, lo confirmás al recibirlo.</div>
                          )}
                          {!poderAdmin && !soloVista && miPlanta === o.planta_origen_id && o.estado === "activa" && (
                            <div className="text-[12.5px] text-stone-500">Para despachar: Remito → Traslado entre plantas → elegí esta orden.</div>
                          )}
                          {lineaT && lineaT.ordenId === o.id && (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                              <div className="font-medium text-[14px]">{lineaT.lineaId ? "Editar cantidad" : "Agregar lote"}</div>
                              {lineaT.lineaId ? (
                                <div className="text-[13px] text-stone-600">{productos.find((x) => x.id === lineaT.producto_id)?.nombre} · lote {lineaT.lote_texto}{lineaT.tieneRemitos ? " · ya tiene remitos: la cantidad no puede quedar por debajo de lo remitido" : ""}</div>
                              ) : (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <label className={lab}>Producto (con stock en el origen)</label>
                                    <select value={lineaT.producto_id} onChange={(e) => setLineaT({ ...lineaT, producto_id: e.target.value, lote_texto: "" })} className={inp}>
                                      <option value="">— elegir —</option>
                                      {productos.filter((p) => lotesOrigen.some((x) => x.producto_id === p.id)).map((p) => (<option key={p.id} value={p.id}>{p.nombre}{p.presentacion ? ` · ${p.presentacion}` : ""}</option>))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className={lab}>Lote</label>
                                    <select value={lineaT.lote_texto} onChange={(e) => setLineaT({ ...lineaT, lote_texto: e.target.value })} disabled={!lineaT.producto_id} className={inp}>
                                      <option value="">— elegir —</option>
                                      {lotesOrigen.filter((x) => x.producto_id === lineaT.producto_id).map((x) => (<option key={x.lote} value={x.lote}>{x.lote} · stock {fmtNum(x.stock)}</option>))}
                                    </select>
                                  </div>
                                </div>
                              )}
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className={lab}>Cantidad (unidades)</label>
                                  <input value={lineaT.cantidad} onChange={(e) => setLineaT({ ...lineaT, cantidad: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" className={inp} />
                                </div>
                                {!lineaT.lineaId && (
                                  <div>
                                    <label className={lab}>Prioridad (1 = más urgente; vacío = al final)</label>
                                    <input value={lineaT.prioridad} onChange={(e) => setLineaT({ ...lineaT, prioridad: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={inp} />
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={guardarLineaT} disabled={!lineaT.cantidad || (!lineaT.lineaId && (!lineaT.producto_id || !lineaT.lote_texto))} className={btn}>Guardar</button>
                                <button onClick={() => setLineaT(null)} className={btn2}>Cancelar</button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                      <div className="md:hidden divide-y divide-stone-100">
                        {ls.map((l) => (
                          <div key={l.id} className="py-2.5 space-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-[14px] break-words">{l.cliente}</div>
                                <div className="text-[12px] text-stone-400">{[l.domicilio, l.provincia].filter(Boolean).join(" · ")}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={`text-[15px] font-semibold ${Number(l.saldo) <= 0 ? "text-emerald-700" : ""}`}>{fmtNum(Math.max(0, l.saldo))}</div>
                                <div className="text-[11px] text-stone-400">saldo</div>
                              </div>
                            </div>
                            <div className="text-[13px] text-stone-700">
                              {l.producto_texto}{!l.producto_id && <span className="ml-1 text-[11px] text-amber-700">(sin catálogo)</span>}
                              <span className="font-mono text-stone-500"> · {l.lote_texto || "sin lote"}</span>{l.ov ? <span className="text-stone-500"> · O/V {l.ov}</span> : null}
                            </div>
                            <div className="text-[12.5px] text-stone-500">{l.planta_nombre} · Pedido {fmtNum(l.cantidad)} · Remitido {fmtNum(l.remitido)}{(remitosDe[l.id] || []).length ? ` · ${(remitosDe[l.id] || []).join(", ")}` : ""}</div>
                            {o.estado !== "anulada" && puedeEditar(l, o) && (
                              <div className="flex gap-4 pt-0.5">
                                <button onClick={() => editar(l)} className="text-emerald-700 text-[13.5px] py-1">Editar</button>
                                {Number(l.remitido) === 0 && <button onClick={() => quitarLinea(l)} className="text-red-600 text-[13.5px] py-1">Quitar</button>}
                              </div>
                            )}
                          </div>
                        ))}
                        {ls.length === 0 && <div className="p-3 text-stone-500 text-[13px]">La orden todavía no tiene líneas.</div>}
                      </div>
                      <div className="overflow-x-auto hidden md:block">
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
                                    {o.estado !== "anulada" && puedeEditar(l, o) && (
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
                              <select value={edit.data.planta_id || (poderAdmin ? "" : miPlanta || "")} onChange={(e) => setD({ planta_id: e.target.value })} disabled={!poderAdmin || edit.tieneRemitos} className={inp}>
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

                        </>
                      )}

                      <div className="flex flex-wrap gap-2 items-start">
                        {o.modalidad !== "traslado" && o.estado !== "anulada" && !esAdmin && !soloVista && (poderAdmin ? [...new Set(ls.map((x) => x.planta_id))] : [miPlanta]).some((pid) => completaPlanta(o, pid)) && (
                          <span className="text-[12px] text-stone-500">Orden completada: solo el administrador puede modificarla.</span>
                        )}
                        {o.modalidad === "traslado" && poderAdmin && o.estado === "activa" && (!lineaT || lineaT.ordenId !== o.id) && (
                          <button onClick={() => abrirLineaT(o.id, o.planta_origen_id, null)} className={btn2}>+ Agregar lote</button>
                        )}
                        {o.modalidad !== "traslado" && o.estado !== "anulada" && !soloVista && (!edit || edit.ordenId !== o.id) && (poderAdmin || (ls.some((l) => l.planta_id === miPlanta) && !completaPlanta(o, miPlanta))) && (
                          <button onClick={() => setEdit({ ordenId: o.id, lineaId: null, data: { ...LINEA_VACIA, planta_id: poderAdmin ? "" : miPlanta }, tieneRemitos: false })} className={btn2}>+ Agregar línea</button>
                        )}
                        {poderAdmin && <button onClick={() => descargarOrdenPdf({ orden: o, lineas: ls, remitosDe, nombrePlanta: nombrePlantaT, estado: est.txt })} className={btn2}>Descargar PDF</button>}
                        {(poderAdmin || soloVista) && (
                          <button onClick={() => (log?.id === o.id ? setLog(null) : verLog(o.id))} className={btn2}>{log?.id === o.id ? "Ocultar cambios" : "Ver cambios"}</button>
                        )}
                        {poderAdmin && o.estado === "activa" && (
                          <button onClick={() => cerrarOrden(o)} className={btn2}>Cerrar orden</button>
                        )}
                        {poderAdmin && o.estado === "cerrada" && (
                          <button onClick={() => reabrirOrden(o)} className={btn2}>Reabrir orden</button>
                        )}
                        {poderAdmin && o.estado !== "anulada" && anulando?.id !== o.id && (
                          <button onClick={() => setAnulando({ id: o.id, motivo: "" })} className="border border-red-300 text-red-700 text-[13px] px-3 py-1.5 rounded-md">Anular orden…</button>
                        )}
                        {poderAdmin && anulando?.id !== o.id && !ls.some((l) => Number(l.remitido) > 0) && (
                          <button onClick={() => eliminar(o)} className="bg-red-600 text-white text-[13px] px-3 py-1.5 rounded-md">Eliminar orden</button>
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
