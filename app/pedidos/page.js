"use client";
// Pedidos de unidad (Admin y Logística): cada orden de carga activa a clientes se asigna a uno de los
// transportes del portal, que la acepta (cargando chofer y patentes) o la rechaza.
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import PedidoUnidad from "@/components/PedidoUnidad";
import RecorridoInterno from "@/components/RecorridoInterno";
import AsignacionPedido, { ESTADOS_PEDIDO } from "@/components/AsignacionPedido";
import { ccAvisos } from "@/components/AvisoOrden";
import { supabase } from "@/lib/supabaseClient";
import { traerTodo } from "@/lib/despachos";
import { fmtFecha, fmtNum, friendlyError, norm, urlBase } from "@/lib/util";
import { estadoInterno, nombrePunto, lugarTexto, cargaTexto, horaTexto, correoSolicitante } from "@/lib/pedidosInternos";
import { urlOutlookApp, urlOutlookWeb } from "@/lib/avisoOrden";
import { PEDIDOS_DESDE, estadoPedido, resumenOrden } from "@/lib/pedidosPortal";

export default function PedidosPage() {
  return <AuthGuard roles={["admin", "logistica"]}>{(profile) => <Pedidos profile={profile} />}</AuthGuard>;
}

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const ORDENES = {
  carga: "Fecha de carga (próximas primero)",
  carga_desc: "Fecha de carga (últimas primero)",
  numero: "Número de orden",
  creada: "Recién cargadas primero",
  transporte: "Transporte",
  asignado: "Fecha de asignación",
};
const TABS = ["por_confirmar", "sin", "asignado", "falta_unidad", "aceptado", "en_ejecucion", "finalizado", "rechazado", "retira", "desestimado", "cancelado"];
const TABS_SEL = ["por_confirmar", "sin", "asignado", "rechazado", "desestimado"]; // pestañas con selección (confirmar internos / desestimar órdenes)
const TIPOS = [["todos", "Todos"], ["clientes", "Clientes"], ["traslados", "Traslados"], ["internos", "Internos"]];
// Estado del interno → pestaña
const tabInterno = (e) => ({ pendiente: "por_confirmar", confirmado: "sin", programado: "aceptado" }[e] || e);

function Pedidos({ profile }) {
  const esAdmin = profile.rol === "admin";
  const [ordenes, setOrdenes] = useState([]);
  const [lineas, setLineas] = useState({});
  const [pedidos, setPedidos] = useState({});
  const [transportes, setTransportes] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cc, setCc] = useState("");
  const [tab, setTab] = useState("sin");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState(() => { try { return localStorage.getItem("pedidosOrden") || "carga"; } catch { return "carga"; } });
  const [abierto, setAbierto] = useState(null); // orden con el recorrido desplegado
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState(null);
  const [verConfig, setVerConfig] = useState(false);
  const [internos, setInternos] = useState([]);
  const [tipo, setTipo] = useState(() => { try { return new URLSearchParams(window.location.search).get("tipo") === "interno" ? "internos" : localStorage.getItem("pedidosTipo") || "todos"; } catch { return "todos"; } });
  const [cancelarPi, setCancelarPi] = useState(null); // { id, motivo }
  useEffect(() => {
    const ok = new URLSearchParams(window.location.search).get("ok");
    if (ok) { setMsg({ tipo: "ok", texto: `Pedido interno guardado: ${ok}.` }); setTab("por_confirmar"); }
  }, []);

  const cargar = useCallback(async () => {
    const [o, p, t, pl, pr, pi] = await Promise.all([
      supabase.from("ordenes_carga").select("*, transportista:transportistas(nombre, cuit), chofer:choferes(nombre, dni)").eq("estado", "activa").gte("created_at", PEDIDOS_DESDE).order("fecha_carga", { ascending: true, nullsFirst: false }).limit(1000),
      supabase.from("pedidos_unidad").select("*").limit(5000),
      supabase.from("transportistas").select("id, nombre, cuit, portal, correos_aviso").order("nombre"),
      supabase.from("plantas").select("*").order("nombre"),
      supabase.from("productos").select("id, kg_por_unidad"),
      supabase.rpc("pedidos_internos_lista", { p_desde: PEDIDOS_DESDE.slice(0, 10) }),
    ]);
    setInternos(pi.error ? [] : pi.data || []);
    if (p.error) { setCargando(false); return setMsg({ tipo: "error", texto: /pedidos_unidad/.test(p.error.message || "") ? "Falta correr migration_69.sql en Supabase." : friendlyError(p.error) }); }
    const ords = o.data || [];
    const ids = ords.map((x) => x.id);
    const ls = {};
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150);
      const rows = await traerTodo(() => supabase.from("v_ordenes_lineas_saldo").select("*").in("orden_id", lote).order("id"));
      for (const l of rows) (ls[l.orden_id] ||= []).push(l);
    }
    setOrdenes(ords);
    setLineas(ls);
    setPedidos(Object.fromEntries((p.data || []).filter((x) => x.orden_id).map((x) => [x.orden_id, x])));
    setTransportes(t.data || []);
    setPlantas(pl.data || []);
    setProductos(pr.data || []);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); ccAvisos().then(setCc); }, [cargar]);

  const delPortal = transportes.filter((t) => t.portal);
  const nomT = (id) => transportes.find((t) => t.id === id)?.nombre || "";

  const filas = useMemo(() => ordenes.map((o) => {
    const r = resumenOrden(lineas[o.id] || [], o, plantas);
    return { o, ...r, estado: estadoPedido(o, pedidos[o.id]) };
  }).filter((f) => f.ls.length), [ordenes, lineas, pedidos, plantas]);

  // Órdenes e internos juntos, filtrados por tipo
  const items = useMemo(() => [
    ...filas.map((f) => ({ k: "o", id: f.o.id, estado: f.estado, f, tipo: f.o.modalidad === "traslado" ? "traslados" : "clientes" })),
    ...internos.map((pi) => ({ k: "i", id: pi.id, estado: tabInterno(estadoInterno(pi)), pi, tipo: "internos" })),
  ].filter((x) => tipo === "todos" || x.tipo === tipo), [filas, internos, tipo]);
  const cuenta = (e) => items.filter((x) => x.estado === e).length;
  const datos = (x) => (x.k === "o"
    ? { numero: x.f.o.numero, creada: x.f.o.created_at, fecha: x.f.o.fecha_carga, p: pedidos[x.f.o.id] }
    : { numero: x.pi.numero, creada: x.pi.created_at, fecha: x.pi.fecha_carga, p: x.pi.pedido });
  const ordenar = (xs) => {
    const k = (x) => {
      const d = datos(x);
      if (orden === "numero") return d.numero;
      if (orden === "creada") return d.creada;
      if (orden === "transporte") return nomT(d.p?.transportista_id) || "~";
      if (orden === "asignado") return d.p?.asignado_at || "~";
      return d.fecha || "9999";
    };
    const num = (x) => String(x).replace(/\d+/g, (d) => d.padStart(8, "0"));
    const out = [...xs].sort((a, b) => num(k(a)).localeCompare(num(k(b))) || num(datos(a).numero).localeCompare(num(datos(b).numero)));
    return orden === "carga_desc" || orden === "creada" ? out.reverse() : out;
  };
  const textoBusca = (x) => (x.k === "o"
    ? [x.f.o.numero, ...x.f.clientes, ...x.f.dest, ...x.f.deps, nomT(pedidos[x.f.o.id]?.transportista_id)]
    : [x.pi.numero, x.pi.area, x.pi.solicitante_nombre, x.pi.carga?.nombre, x.pi.descarga?.nombre, lugarTexto(x.pi.carga), lugarTexto(x.pi.descarga), x.pi.tipo_carga, nomT(x.pi.pedido?.transportista_id)]);
  const visibles = ordenar(items.filter((x) => x.estado === tab && (!busca || textoBusca(x).some((t) => norm(t).includes(norm(busca))))));
  const [sel, setSel] = useState(new Set());
  useEffect(() => setSel(new Set()), [tab]);
  const conSel = TABS_SEL.includes(tab);
  const alternar = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosSel = visibles.length > 0 && visibles.every((x) => sel.has(x.id));
  const confirmarSel = async (ids) => {
    const { data, error } = await supabase.rpc("confirmar_pedidos_internos", { p_ids: ids });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `${data} pedido(s) confirmados: ya se pueden asignar (pestaña Sin asignar).` });
    setSel(new Set());
    cargar();
  };
  const desestimarSel = async () => {
    if (tab === "por_confirmar") return confirmarSel(visibles.filter((x) => x.k === "i" && sel.has(x.id)).map((x) => x.id));
    const ids = visibles.filter((x) => x.k === "o" && sel.has(x.id)).map((x) => x.id);
    if (!ids.length) return setMsg({ tipo: "error", texto: "Desestimar es solo para órdenes de carga. Un pedido interno se cancela." });
    const volver = tab === "desestimado";
    const { data, error } = await supabase.rpc("desestimar_pedidos", { p_ordenes: ids, p_valor: !volver });
    if (error) return setMsg({ tipo: "error", texto: /desestimar_pedidos/.test(error.message || "") ? "Falta correr migration_73.sql en Supabase." : friendlyError(error) });
    setMsg({ tipo: "ok", texto: volver ? `${data} orden(es) volvieron a pendientes.` : `${data} orden(es) desestimadas: ya no aparecen como pendientes.` });
    setSel(new Set());
    cargar();
  };
  const cambiarOrden = (v) => { setOrden(v); try { localStorage.setItem("pedidosOrden", v); } catch {} };
  const cambiarTipo = (v) => { setTipo(v); try { localStorage.setItem("pedidosTipo", v); } catch {} };
  const cancelarInterno = async () => {
    const { error } = await supabase.rpc("cancelar_pedido_interno", { p_id: cancelarPi.id, p_motivo: cancelarPi.motivo || "" });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setCancelarPi(null);
    setMsg({ tipo: "ok", texto: "Pedido cancelado. Avisale al solicitante si hace falta." });
    cargar();
  };
  const avisarSolicitante = async (pi, web) => {
    const m = correoSolicitante({ pi, usuario: profile.nombre, url: `${urlBase()}/solicitudes` });
    if (!m.para) return setMsg({ tipo: "error", texto: "No encuentro el correo del solicitante." });
    if (web) window.open(urlOutlookWeb(m), "_blank"); else window.location.href = urlOutlookApp(m);
    await supabase.rpc("marcar_interno_avisado", { p_id: pi.id, p_a: "solicitante" });
    cargar();
  };

  const guardarT = async (t, cambios) => {
    const { error } = await supabase.from("transportistas").update(cambios).eq("id", t.id);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setTransportes((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...cambios } : x)));
  };

  const tarjetaInterno = (x) => {
    const pi = x.pi;
    const e = estadoInterno(pi);
    const [et, cls] = ESTADOS_PEDIDO[x.estado] || ["", ""];
    const hoy = hoyAR();
    const contables = [pi.departamento, pi.clase, pi.subsidiaria, pi.cuenta].filter(Boolean);
    const fhs = (t) => (t ? new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    return (
      <div key={pi.id} className="panel p-3 md:p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {conSel && <input type="checkbox" checked={sel.has(pi.id)} onChange={() => alternar(pi.id)} className="w-4 h-4" />}
          <span className="font-semibold text-[15px]">{pi.numero}</span>
          <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{e === "pendiente" ? "Por confirmar" : e === "cancelado" ? "Cancelado" : et}</span>
          <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-teal-100 text-teal-800">Interno · {pi.area || "sin área"}</span>
          {pi.grupo_total > 1 && <span className="text-[12px] text-stone-500">camión {pi.grupo_n} de {pi.grupo_total}</span>}
          <span className={`text-[12px] ${pi.fecha_carga < hoy && !["finalizado", "cancelado"].includes(e) ? "text-red-700 font-medium" : pi.fecha_carga === hoy ? "text-emerald-700 font-medium" : "text-stone-500"}`}>carga {pi.fecha_carga === hoy ? "HOY" : fmtFecha(pi.fecha_carga)}{horaTexto(pi)}</span>
          <span className="text-[12.5px] text-stone-700 md:ml-auto">{cargaTexto(pi)}</span>
        </div>
        <div className="text-[13px] text-stone-700"><span className="text-stone-500">Carga en:</span> {nombrePunto(pi.carga)} <span className="text-stone-500">({lugarTexto(pi.carga)})</span>{(pi.paradas || []).map((pa, i) => <span key={i}> <span className="text-stone-400">→</span> {nombrePunto(pa)}</span>)} <span className="text-stone-400">→</span> <span className="text-stone-500">Descarga:</span> {nombrePunto(pi.descarga)} <span className="text-stone-500">({lugarTexto(pi.descarga)})</span></div>
        <div className="text-[12px] text-stone-500">Pidió {pi.solicitante_nombre || "—"} · {fhs(pi.created_at)}{contables.length ? ` · ${contables.join(" · ")}` : ""}{pi.confirmado_por_nombre ? ` · confirmó ${pi.confirmado_por_nombre}` : ""}</div>
        {pi.comentarios && <div className="text-[12.5px] bg-sky-50 border border-sky-200 rounded px-2 py-1">{pi.comentarios}</div>}
        {e === "cancelado" && <div className="text-[12.5px] text-stone-500">Cancelado por {pi.cancelado_por_nombre} ({fhs(pi.cancelado_at)}): {pi.motivo_cancelacion}</div>}
        {e !== "pendiente" && e !== "cancelado" && (
          <AsignacionPedido interno={pi} profile={profile} pedido={pi.pedido || null} transportes={transportes} cc={cc} onCambio={cargar} />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {e === "pendiente" && <button onClick={() => confirmarSel([pi.id])} className="text-[12.5px] px-2.5 py-1 rounded-md border bg-emerald-700 border-emerald-700 text-white">Confirmar</button>}
          {pi.editable && <a href={`/pedido-interno?id=${pi.id}`} className="text-[12.5px] px-2.5 py-1 rounded-md border bg-white border-stone-300 text-stone-700">Modificar</a>}
          {pi.editable && <button onClick={() => setCancelarPi({ id: pi.id, motivo: "" })} className="text-[12.5px] px-2.5 py-1 rounded-md border bg-white border-stone-300 text-red-700">Cancelar pedido</button>}
          <button onClick={() => avisarSolicitante(pi, false)} className="text-[12.5px] px-2.5 py-1 rounded-md border bg-white border-stone-300 text-stone-700" title="Abre el correo armado en Outlook">✉ Avisar al solicitante</button>
          <button onClick={() => avisarSolicitante(pi, true)} className="text-[12px] text-stone-500 underline px-1">Outlook web</button>
          {pi.avisado_solicitante_at && <span className="text-[11.5px] text-stone-400">avisado {fhs(pi.avisado_solicitante_at)}</span>}
          <button onClick={() => setAbierto(abierto === pi.id ? null : pi.id)} className="text-[12px] text-sky-700 underline px-1 ml-auto">{abierto === pi.id ? "Ocultar recorrido" : "Ver recorrido"}</button>
        </div>
        {cancelarPi?.id === pi.id && (
          <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2">
            <label className="block text-[12px] font-medium text-stone-600">Motivo de la cancelación</label>
            <input value={cancelarPi.motivo} onChange={(ev) => setCancelarPi({ ...cancelarPi, motivo: ev.target.value })} className="w-full border border-stone-300 rounded-md px-3 py-2 text-sm bg-white" />
            <div className="flex gap-2">
              <button onClick={cancelarInterno} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-[13px]">Cancelar el pedido</button>
              <button onClick={() => setCancelarPi(null)} className="px-3 py-1.5 text-[13px] text-stone-500">Volver</button>
            </div>
          </div>
        )}
        {abierto === pi.id && <RecorridoInterno pi={pi} onCerrar={() => setAbierto(null)} />}
      </div>
    );
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4">
        <header className="relative">
          <a href="/pedido-interno" className="float-right ml-3 px-3 py-2 rounded-md bg-emerald-700 text-white text-[13px] font-medium">+ Pedido interno</a>
          <h1 className="text-[22px] font-semibold text-stone-900">Pedidos de unidad</h1>
          <p className="text-stone-500 text-[13.5px]">Cada orden de carga activa, a clientes o de traslado (cargada desde el {fmtFecha(PEDIDOS_DESDE.slice(0, 10))}) se asigna a un transporte. El transporte la ve en su portal y la acepta o la rechaza; el chofer y las patentes los carga él (cuando los tenga) o Logística. Si retira el cliente, tildalo y sale de los pendientes. Los pedidos internos (de las áreas) primero se confirman y después se asignan igual.</p>
        </header>
        <div className="flex flex-wrap gap-1.5 items-center text-[13px]">
          <span className="text-stone-500 mr-1">Tipo:</span>
          {TIPOS.map(([k, t]) => (
            <button key={k} onClick={() => cambiarTipo(k)} className={`px-3 py-1 rounded-full border ${tipo === k ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-700 border-stone-300"}`}>{t}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {TABS.filter((k) => cuenta(k) > 0 || ["sin", "asignado", "aceptado"].includes(k) || k === tab).map((k) => [k, ESTADOS_PEDIDO[k]]).map(([k, [t]]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded text-[13px] font-medium border ${tab === k ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-700 border-stone-300"}`}>
              {t} ({cuenta(k)})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar orden, cliente, destino, transporte…" className="border border-stone-300 rounded-md px-3 py-2 text-sm w-full sm:w-80" />
          <label className="text-[13px] text-stone-500 flex items-center gap-1.5 sm:ml-auto">Ordenar por
            <select value={orden} onChange={(e) => cambiarOrden(e.target.value)} className="border border-stone-300 rounded-md px-2 py-1.5 text-[13px] bg-white text-stone-800">
              {Object.entries(ORDENES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
        </div>

        {conSel && visibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-[13px] rounded-md border border-stone-200 bg-white px-3 py-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={todosSel} onChange={(e) => setSel(e.target.checked ? new Set(visibles.map((x) => x.id)) : new Set())} /> Seleccionar todas ({visibles.length})</label>
            <span className="text-stone-500">{sel.size} seleccionada(s)</span>
            <button disabled={!sel.size} onClick={desestimarSel} className="ml-auto px-3 py-1.5 rounded-md border border-stone-400 bg-stone-700 text-white disabled:opacity-40">
              {tab === "desestimado" ? "Volver a pendientes" : tab === "por_confirmar" ? "Confirmar seleccionados" : "Desestimar seleccionadas"}
            </button>
            {tab !== "desestimado" && tab !== "por_confirmar" && <span className="basis-full text-[12px] text-stone-500">Desestimar = no se pide unidad por la plataforma (p. ej. movimientos ya asignados por fuera). No es “Retira el cliente”. Se puede deshacer en la pestaña Desestimados.</span>}
          </div>
        )}
        {msg && <div className={`text-sm rounded p-3 border ${msg.tipo === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>{msg.texto}</div>}
        {!delPortal.length && !cargando && <div className="text-sm rounded p-3 border bg-amber-50 border-amber-200 text-amber-800">Todavía no marcaste cuáles son los transportes del portal: abajo, en “Transportes del portal”.</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !visibles.length && <div className="panel p-5 text-sm text-stone-500">No hay pedidos en esta pestaña.</div>}

        <div className="space-y-2">
          {visibles.map((x) => {
            if (x.k === "i") return tarjetaInterno(x);
            const { f } = x;
            const { o } = f;
            const [et, cls] = ESTADOS_PEDIDO[f.estado];
            const hoy = hoyAR();
            return (
              <div key={o.id} className="panel p-3 md:p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {conSel && <input type="checkbox" checked={sel.has(o.id)} onChange={() => alternar(o.id)} className="w-4 h-4" />}
                  <a href={`/ordenes?oc=${encodeURIComponent(o.numero)}`} className="font-semibold text-[15px] hover:underline">{o.numero}</a>
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{et}</span>
                  {o.modalidad === "traslado" && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-violet-100 text-violet-800">Traslado</span>}
                  {o.fecha_carga && <span className={`text-[12px] ${o.fecha_carga < hoy ? "text-red-700 font-medium" : o.fecha_carga === hoy ? "text-emerald-700 font-medium" : "text-stone-500"}`}>carga {o.fecha_carga === hoy ? "HOY" : fmtFecha(o.fecha_carga)}</span>}
                  <span className="text-[12px] text-stone-500">{o.tipo_unidad || "unidad a definir"}</span>
                  <span className="text-[12.5px] text-stone-700 md:ml-auto">{fmtNum(f.u)} u.{f.kg ? ` · ${fmtNum(Math.round(f.kg))} kg` : ""}</span>
                </div>
                <div className="text-[13px] text-stone-700"><span className="text-stone-500">Carga en:</span> {f.deps.join(" · ")} <span className="text-stone-400">→</span> <span className="text-stone-500">Destinos:</span> {f.dest.join(" · ")}</div>
                <div className="text-[12px] text-stone-500">{f.clientes.join(" · ")}</div>
                <AsignacionPedido orden={o} lineas={lineas[o.id] || []} plantas={plantas} profile={profile} pedido={pedidos[o.id] || null} transportes={transportes} cc={cc} onCambio={cargar} />
                <div className="flex"><button onClick={() => setAbierto(abierto === o.id ? null : o.id)} className="text-[12px] text-sky-700 underline px-1 ml-auto">{abierto === o.id ? "Ocultar recorrido" : "Ver recorrido"}</button></div>
                {abierto === o.id && <PedidoUnidad orden={o} lineas={lineas[o.id] || []} plantas={plantas} productos={productos} onCerrar={() => setAbierto(null)} />}
              </div>
            );
          })}
        </div>

        <div className="panel p-4">
          <button onClick={() => setVerConfig(!verConfig)} className="text-[14px] font-semibold text-stone-800">{verConfig ? "▾" : "▸"} Transportes del portal ({delPortal.length})</button>
          {verConfig && (
            <div className="mt-3 space-y-2">
              <p className="text-[12.5px] text-stone-500">Marcá los transportes a los que se les asignan pedidos y sus correos para el aviso. {esAdmin ? "" : "Solo el administrador puede cambiarlos."} Los usuarios del portal se crean en Administración → Usuarios (rol “Transportista”).</p>
              {transportes.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-[13px] border-t border-stone-100 pt-2">
                  <label className="flex items-center gap-2 w-72">
                    <input type="checkbox" disabled={!esAdmin} checked={!!t.portal} onChange={(e) => guardarT(t, { portal: e.target.checked })} />
                    <span className={t.portal ? "font-medium" : "text-stone-600"}>{t.nombre}</span>
                  </label>
                  {t.portal && (
                    <input
                      defaultValue={t.correos_aviso || ""}
                      disabled={!esAdmin}
                      onBlur={(e) => e.target.value !== (t.correos_aviso || "") && guardarT(t, { correos_aviso: e.target.value.trim() || null })}
                      placeholder="correos para avisos, separados por coma"
                      className="flex-1 min-w-[260px] border border-stone-300 rounded px-2 py-1"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </NavBar>
  );
}
