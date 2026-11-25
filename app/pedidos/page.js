"use client";
// Pedidos de unidad (Admin y Logística): cada orden de carga activa a clientes se asigna a uno de los
// transportes del portal, que la acepta (cargando chofer y patentes) o la rechaza.
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import PedidoUnidad from "@/components/PedidoUnidad";
import AsignacionPedido, { ESTADOS_PEDIDO } from "@/components/AsignacionPedido";
import { ccAvisos } from "@/components/AvisoOrden";
import { supabase } from "@/lib/supabaseClient";
import { traerTodo } from "@/lib/despachos";
import { fmtFecha, fmtNum, friendlyError, norm } from "@/lib/util";
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
const TABS = ["sin", "asignado", "falta_unidad", "aceptado", "rechazado", "retira"];

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

  const cargar = useCallback(async () => {
    const [o, p, t, pl, pr] = await Promise.all([
      supabase.from("ordenes_carga").select("*, transportista:transportistas(nombre, cuit), chofer:choferes(nombre, dni)").eq("estado", "activa").gte("created_at", PEDIDOS_DESDE).order("fecha_carga", { ascending: true, nullsFirst: false }).limit(1000),
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
  const nomT = (id) => transportes.find((t) => t.id === id)?.nombre || "";

  const filas = useMemo(() => ordenes.map((o) => {
    const r = resumenOrden(lineas[o.id] || [], o, plantas);
    return { o, ...r, estado: estadoPedido(o, pedidos[o.id]) };
  }).filter((f) => f.ls.length), [ordenes, lineas, pedidos, plantas]);

  const cuenta = (e) => filas.filter((f) => f.estado === e).length;
  const ordenar = (xs) => {
    const k = (f) => {
      const p = pedidos[f.o.id];
      if (orden === "numero") return f.o.numero;
      if (orden === "creada") return f.o.created_at;
      if (orden === "transporte") return nomT(p?.transportista_id) || "~";
      if (orden === "asignado") return p?.asignado_at || "~";
      return f.o.fecha_carga || "9999";
    };
    const num = (x) => String(x).replace(/\d+/g, (d) => d.padStart(8, "0"));
    const out = [...xs].sort((a, b) => num(k(a)).localeCompare(num(k(b))) || num(a.o.numero).localeCompare(num(b.o.numero)));
    return orden === "carga_desc" || orden === "creada" ? out.reverse() : out;
  };
  const visibles = ordenar(filas.filter((f) => f.estado === tab && (!busca || [f.o.numero, ...f.clientes, ...f.dest, ...f.deps, nomT(pedidos[f.o.id]?.transportista_id)].some((x) => norm(x).includes(norm(busca))))));
  const cambiarOrden = (v) => { setOrden(v); try { localStorage.setItem("pedidosOrden", v); } catch {} };

  const guardarT = async (t, cambios) => {
    const { error } = await supabase.from("transportistas").update(cambios).eq("id", t.id);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setTransportes((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...cambios } : x)));
  };


  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4">
        <header>
          <h1 className="text-[22px] font-semibold text-stone-900">Pedidos de unidad</h1>
          <p className="text-stone-500 text-[13.5px]">Cada orden de carga activa, a clientes o de traslado (cargada desde el {fmtFecha(PEDIDOS_DESDE.slice(0, 10))}) se asigna a un transporte. El transporte la ve en su portal y la acepta o la rechaza; el chofer y las patentes los carga él (cuando los tenga) o Logística. Si retira el cliente, tildalo y sale de los pendientes.</p>
        </header>

        <div className="flex flex-wrap gap-1">
          {TABS.map((k) => [k, ESTADOS_PEDIDO[k]]).map(([k, [t]]) => (
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

        {msg && <div className={`text-sm rounded p-3 border ${msg.tipo === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>{msg.texto}</div>}
        {!delPortal.length && !cargando && <div className="text-sm rounded p-3 border bg-amber-50 border-amber-200 text-amber-800">Todavía no marcaste cuáles son los transportes del portal: abajo, en “Transportes del portal”.</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !visibles.length && <div className="panel p-5 text-sm text-stone-500">No hay pedidos en esta pestaña.</div>}

        <div className="space-y-2">
          {visibles.map((f) => {
            const { o } = f;
            const [et, cls] = ESTADOS_PEDIDO[f.estado];
            const hoy = hoyAR();
            return (
              <div key={o.id} className="panel p-3 md:p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
