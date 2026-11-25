"use client";
// Pedidos de unidad (Admin y Logística): cada orden de carga activa a clientes se asigna a uno de los
// transportes del portal, que la acepta (cargando chofer y patentes) o la rechaza.
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import PedidoUnidad from "@/components/PedidoUnidad";
import { ccAvisos } from "@/components/AvisoOrden";
import { supabase } from "@/lib/supabaseClient";
import { traerTodo } from "@/lib/despachos";
import { fmtFecha, fmtNum, friendlyError, norm, urlBase, fmtDocChofer } from "@/lib/util";
import { urlOutlookApp, urlOutlookWeb } from "@/lib/avisoOrden";

export default function PedidosPage() {
  return <AuthGuard roles={["admin", "logistica"]}>{(profile) => <Pedidos profile={profile} />}</AuthGuard>;
}

const ESTADOS = {
  sin: ["Sin asignar", "bg-amber-100 text-amber-800"],
  asignado: ["Esperando respuesta", "bg-sky-100 text-sky-800"],
  aceptado: ["Aceptado", "bg-emerald-100 text-emerald-800"],
  rechazado: ["Rechazado · reasignar", "bg-red-100 text-red-700"],
};
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const lugar = (l) => [l.localidad, l.provincia].filter(Boolean).join(", ") || l.domicilio || "";
const corto = (n) => String(n || "").split("|")[0].replace(/^(DEP[OÓ]SITO|PLANTA|ESTANCIA)\s+/i, "").replace(/["“”]/g, "").trim();

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
  const [elegido, setElegido] = useState({}); // orden_id -> transportista_id elegido en el selector
  const [abierto, setAbierto] = useState(null); // orden con el recorrido desplegado
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState(null);
  const [verConfig, setVerConfig] = useState(false);

  const cargar = useCallback(async () => {
    const [o, p, t, pl, pr] = await Promise.all([
      supabase.from("ordenes_carga").select("*, transportista:transportistas(nombre, cuit), chofer:choferes(nombre, dni)").eq("estado", "activa").neq("modalidad", "traslado").order("fecha_carga", { ascending: true, nullsFirst: false }).limit(1000),
      supabase.from("pedidos_unidad").select("*").limit(5000),
      supabase.from("transportistas").select("id, nombre, cuit, portal, correos_aviso").order("nombre"),
      supabase.from("plantas").select("*").order("nombre"),
      supabase.from("productos").select("id, kg_por_unidad"),
    ]);
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
    setPedidos(Object.fromEntries((p.data || []).map((x) => [x.orden_id, x])));
    setTransportes(t.data || []);
    setPlantas(pl.data || []);
    setProductos(pr.data || []);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); ccAvisos().then(setCc); }, [cargar]);

  const delPortal = transportes.filter((t) => t.portal);
  const opciones = delPortal.length ? delPortal : transportes;
  const nomT = (id) => transportes.find((t) => t.id === id)?.nombre || "—";
  const estadoDe = (o) => pedidos[o.id]?.estado || "sin";

  const filas = useMemo(() => ordenes.map((o) => {
    const ls = (lineas[o.id] || []).filter((l) => Number(l.saldo) > 0);
    const todas = lineas[o.id] || [];
    const base = ls.length ? ls : todas;
    return {
      o, ls: base,
      u: base.reduce((a, l) => a + Number(ls.length ? l.saldo : l.cantidad || 0), 0),
      kg: base.reduce((a, l) => a + (Number(l.cantidad) > 0 ? (Number(l.kilos || 0) * Number(ls.length ? l.saldo : l.cantidad)) / Number(l.cantidad) : 0), 0),
      deps: [...new Set(base.map((l) => corto(l.planta_nombre)).filter(Boolean))],
      dest: [...new Set(base.map(lugar).filter(Boolean))],
      clientes: [...new Set(base.map((l) => l.cliente).filter(Boolean))],
      estado: estadoDe(o),
    };
  }).filter((f) => f.ls.length), [ordenes, lineas, pedidos]);

  const cuenta = (e) => filas.filter((f) => f.estado === e).length;
  const visibles = filas.filter((f) => f.estado === tab && (!busca || [f.o.numero, ...f.clientes, ...f.dest, ...f.deps, nomT(pedidos[f.o.id]?.transportista_id)].some((x) => norm(x).includes(norm(busca)))));

  const asignar = async (o) => {
    const t = elegido[o.id] || (pedidos[o.id]?.estado !== "rechazado" ? pedidos[o.id]?.transportista_id : "") || "";
    if (!t) return setMsg({ tipo: "error", texto: "Elegí el transporte." });
    const { error } = await supabase.rpc("asignar_pedido", { p_orden: o.id, p_transportista: t });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `${o.numero} asignada a ${nomT(t)}. Avisale por Outlook.` });
    cargar();
  };
  const quitar = async (o) => {
    const { error } = await supabase.rpc("quitar_pedido", { p_orden: o.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    cargar();
  };
  const correo = (f) => {
    const p = pedidos[f.o.id];
    const t = transportes.find((x) => x.id === p?.transportista_id) || {};
    const asunto = `Pedido de unidad ${f.o.numero}${f.o.fecha_carga ? ` – carga ${fmtFecha(f.o.fecha_carga)}` : ""}`;
    const L = ["Hola,", "", `Les asignamos un pedido de unidad en la plataforma: ${f.o.numero}.`];
    if (f.o.fecha_carga) L.push(`Fecha de carga: ${fmtFecha(f.o.fecha_carga)}`);
    L.push(`Tipo de unidad: ${f.o.tipo_unidad || "a definir"}`);
    L.push(`Carga en: ${f.deps.join(" / ") || "—"}`);
    L.push(`Destinos: ${f.dest.join(" / ") || "—"}`);
    L.push(`Total: ${fmtNum(f.u)} u.${f.kg ? ` · ${fmtNum(Math.round(f.kg))} kg` : ""}`);
    if (f.o.observaciones_deposito) L.push(`Observaciones: ${f.o.observaciones_deposito}`);
    L.push("", `Ingresá para ver el recorrido, aceptarlo y cargar chofer y patentes: ${urlBase()}/mis-pedidos`, "", "Saludos,", profile.nombre);
    return { para: t.correos_aviso || "", cc, asunto, cuerpo: L.join("\n"), nombre: t.nombre };
  };
  const avisar = async (f, web) => {
    const m = correo(f);
    if (!m.para) return setMsg({ tipo: "error", texto: `${m.nombre || "El transporte"} no tiene correos cargados (abajo, en “Transportes del portal”).` });
    if (web) window.open(urlOutlookWeb(m), "_blank"); else window.location.href = urlOutlookApp(m);
    await supabase.rpc("marcar_pedido_avisado", { p_orden: f.o.id });
    cargar();
  };

  const guardarT = async (t, cambios) => {
    const { error } = await supabase.from("transportistas").update(cambios).eq("id", t.id);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setTransportes((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...cambios } : x)));
  };

  const fh = (x) => (x ? new Date(x).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const btn = "text-[12.5px] px-2.5 py-1 rounded-md border";

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4">
        <header>
          <h1 className="text-[22px] font-semibold text-stone-900">Pedidos de unidad</h1>
          <p className="text-stone-500 text-[13.5px]">Cada orden de carga activa se asigna a un transporte. El transporte la ve en su portal, la acepta cargando chofer y patentes (eso completa el camión de la orden) o la rechaza con motivo.</p>
        </header>

        <div className="flex flex-wrap gap-1">
          {Object.entries(ESTADOS).map(([k, [t]]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded text-[13px] font-medium border ${tab === k ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-700 border-stone-300"}`}>
              {t} ({cuenta(k)})
            </button>
          ))}
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar orden, cliente, destino, transporte…" className="ml-auto border border-stone-300 rounded-md px-3 py-2 text-sm w-full sm:w-72" />
        </div>

        {msg && <div className={`text-sm rounded p-3 border ${msg.tipo === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>{msg.texto}</div>}
        {!delPortal.length && !cargando && <div className="text-sm rounded p-3 border bg-amber-50 border-amber-200 text-amber-800">Todavía no marcaste cuáles son los transportes del portal: abajo, en “Transportes del portal”.</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !visibles.length && <div className="panel p-5 text-sm text-stone-500">No hay pedidos en esta pestaña.</div>}

        <div className="space-y-2">
          {visibles.map((f) => {
            const { o } = f;
            const p = pedidos[o.id];
            const [et, cls] = ESTADOS[f.estado];
            const hoy = hoyAR();
            return (
              <div key={o.id} className="panel p-3 md:p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={`/ordenes?oc=${encodeURIComponent(o.numero)}`} className="font-semibold text-[15px] hover:underline">{o.numero}</a>
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{et}</span>
                  {o.fecha_carga && <span className={`text-[12px] ${o.fecha_carga < hoy ? "text-red-700 font-medium" : o.fecha_carga === hoy ? "text-emerald-700 font-medium" : "text-stone-500"}`}>carga {o.fecha_carga === hoy ? "HOY" : fmtFecha(o.fecha_carga)}</span>}
                  <span className="text-[12px] text-stone-500">{o.tipo_unidad || "unidad a definir"}</span>
                  <span className="text-[12.5px] text-stone-700 md:ml-auto">{fmtNum(f.u)} u.{f.kg ? ` · ${fmtNum(Math.round(f.kg))} kg` : ""}</span>
                </div>
                <div className="text-[13px] text-stone-700"><span className="text-stone-500">Carga en:</span> {f.deps.join(" · ")} <span className="text-stone-400">→</span> <span className="text-stone-500">Destinos:</span> {f.dest.join(" · ")}</div>
                <div className="text-[12px] text-stone-500">{f.clientes.join(" · ")}</div>
                {p && (
                  <div className="text-[12.5px] text-stone-700">
                    <b>{nomT(p.transportista_id)}</b> · asignado {fh(p.asignado_at)} por {p.asignado_por_nombre}
                    {p.avisado_at ? <span className="text-stone-500"> · avisado {fh(p.avisado_at)}</span> : <span className="text-amber-700"> · sin avisar</span>}
                    {p.estado === "aceptado" && <span className="block text-emerald-800">✓ Aceptado {fh(p.respondido_at)} · {o.chofer?.nombre || "—"}{o.chofer?.dni ? ` (${fmtDocChofer(o.chofer.dni)})` : ""} · {o.chasis || "—"} / {o.acoplado || "—"}</span>}
                    {p.estado === "rechazado" && <span className="block text-red-700">✕ Rechazado {fh(p.respondido_at)}: {p.motivo_rechazo}</span>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(f.estado === "sin" || f.estado === "rechazado" || f.estado === "asignado") && (
                    <>
                      <select value={elegido[o.id] ?? (f.estado === "asignado" ? p?.transportista_id : "") ?? ""} onChange={(e) => setElegido({ ...elegido, [o.id]: e.target.value })} className="border border-stone-300 rounded-md px-2 py-1 text-[13px] bg-white">
                        <option value="">Elegir transporte…</option>
                        {opciones.filter((t) => !(f.estado === "rechazado" && t.id === p?.transportista_id)).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                      </select>
                      <button onClick={() => asignar(o)} className={`${btn} bg-emerald-700 border-emerald-700 text-white`}>{f.estado === "sin" ? "Asignar" : "Reasignar"}</button>
                    </>
                  )}
                  {p && f.estado !== "rechazado" && (
                    <>
                      <button onClick={() => avisar(f, false)} className={`${btn} ${p.avisado_at ? "bg-white border-stone-300 text-stone-700" : "bg-sky-700 border-sky-700 text-white"}`}>{p.avisado_at ? "Volver a avisar (Outlook)" : "Avisar por Outlook"}</button>
                      <button onClick={() => avisar(f, true)} className={`${btn} bg-white border-stone-300 text-stone-700`}>Outlook web</button>
                    </>
                  )}
                  {p && <button onClick={() => quitar(o)} className="text-[12px] text-stone-500 underline px-1">Quitar asignación</button>}
                  <button onClick={() => setAbierto(abierto === o.id ? null : o.id)} className="text-[12px] text-sky-700 underline px-1 ml-auto">{abierto === o.id ? "Ocultar recorrido" : "Ver recorrido"}</button>
                </div>
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
