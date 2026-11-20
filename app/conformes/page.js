"use client";
// Conforme de salida del depósito: por ORDEN DE CARGA (un PDF o fotos con todos los remitos de la orden, por planta).
// Los remitos sin orden se adjuntan de a uno, o el admin los marca "N/A conforme".
import { useState, useEffect, useCallback, useMemo } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import ConformesRemito from "@/components/Conformes";
import { supabase } from "@/lib/supabaseClient";
import { conformesDe, conformesDeOrdenes, marcarNA } from "@/lib/conformes";
import { confirmar } from "@/lib/confirmar";
import { fmtFecha, friendlyError, norm } from "@/lib/util";

export default function ConformesPage() {
  return <AuthGuard>{(profile) => <ConformesInner profile={profile} />}</AuthGuard>;
}

const inputCls = "border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";
const MOD = { soja: "Soja", maiz: "Maíz", traslado: "Traslado" };

function ConformesInner({ profile }) {
  const veTodo = profile.rol !== "operador";
  const esAdmin = profile.rol === "admin";
  const miPlanta = profile.planta?.id || null;
  const [tab, setTab] = useState("pendientes");
  const [pend, setPend] = useState([]);
  const [cargados, setCargados] = useState([]);
  const [archOrden, setArchOrden] = useState({});
  const [archRemito, setArchRemito] = useState({});
  const [plantas, setPlantas] = useState([]);
  const [fPlanta, setFPlanta] = useState("");
  const [busca, setBusca] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [recien, setRecien] = useState(() => new Set()); // cargados en esta visita: siguen a la vista para sumar otro archivo

  const cargar = useCallback(async () => {
    setError("");
    if (!veTodo && !miPlanta) return setCargando(false);
    let qp = supabase.from("v_conformes_pendientes").select("*").order("created_at", { ascending: false }).limit(400);
    if (!veTodo) qp = qp.eq("planta_id", miPlanta);
    let qo = supabase.from("orden_conformes").select("orden_id, planta_id, created_at, orden:ordenes_carga(numero, modalidad)").order("created_at", { ascending: false }).limit(300);
    let qr = supabase.from("remito_conformes").select("remito_id, created_at, remito:remitos(id, planta_id, punto_venta, numero, fecha, estado, cliente_nombre, orden_id)").order("created_at", { ascending: false }).limit(200);
    let qn = supabase.from("remito_conforme_na").select("remito_id, motivo, marcado_por_nombre, created_at, remito:remitos(id, planta_id, punto_venta, numero, fecha, estado, cliente_nombre)").order("created_at", { ascending: false }).limit(100);
    if (!veTodo) qo = qo.eq("planta_id", miPlanta);
    const [p, o, r, n] = await Promise.all([qp, qo, qr, qn]);
    if (p.error) {
      setCargando(false);
      return setError(/v_conformes_pendientes/.test(p.error.message || "") ? "Falta correr migration_63.sql en Supabase." : friendlyError(p.error));
    }
    // Cargados: una fila por orden+planta y por remito suelto (lo más reciente primero)
    const vistos = new Set();
    const lista = [];
    for (const c of o.data || []) {
      const k = `${c.orden_id}|${c.planta_id}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      lista.push({ tipo: "orden", clave: k, orden_id: c.orden_id, planta_id: c.planta_id, orden_numero: c.orden?.numero, modalidad: c.orden?.modalidad, created_at: c.created_at });
    }
    for (const c of r.data || []) {
      if (!c.remito || vistos.has(c.remito_id) || (!veTodo && c.remito.planta_id !== miPlanta)) continue;
      vistos.add(c.remito_id);
      lista.push({ tipo: "remito", clave: c.remito_id, remito_id: c.remito_id, planta_id: c.remito.planta_id, remitos_txt: `${c.remito.punto_venta}-${c.remito.numero}`, clientes: c.remito.cliente_nombre, fecha: c.remito.fecha, estado: c.remito.estado, created_at: c.created_at, conOrden: !!c.remito.orden_id });
    }
    for (const c of n.data || []) {
      if (!c.remito || vistos.has(c.remito_id) || (!veTodo && c.remito.planta_id !== miPlanta)) continue;
      vistos.add(c.remito_id);
      lista.push({ tipo: "remito", na: c, clave: c.remito_id, remito_id: c.remito_id, planta_id: c.remito.planta_id, remitos_txt: `${c.remito.punto_venta}-${c.remito.numero}`, clientes: c.remito.cliente_nombre, fecha: c.remito.fecha, estado: c.remito.estado, created_at: c.created_at });
    }
    lista.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const filas = p.data || [];
    const ordenIds = [...new Set([...filas, ...lista].filter((x) => x.tipo === "orden").map((x) => x.orden_id))];
    const remitoIds = [...new Set([...filas, ...lista].filter((x) => x.tipo === "remito").map((x) => x.remito_id))];
    const [ao, ar] = await Promise.all([conformesDeOrdenes(ordenIds), conformesDe(remitoIds)]);
    setPend(filas);
    setCargados(lista);
    setArchOrden(ao);
    setArchRemito(ar);
    setCargando(false);
  }, [veTodo, miPlanta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    supabase.from("plantas").select("id, nombre").order("nombre").then(({ data }) => setPlantas(data || []));
  }, []);

  const base = tab === "pendientes"
    ? [...cargados.filter((x) => recien.has(x.clave) && !x.na && !pend.some((p) => p.clave === x.clave)), ...pend]
    : cargados;
  const lista = useMemo(() => {
    const q = norm(busca);
    return base.filter((r) => (!fPlanta || r.planta_id === fPlanta) && (!q || [r.orden_numero, r.remitos_txt, r.clientes].some((x) => norm(x).includes(q))));
  }, [base, busca, fPlanta]);
  const nomPlanta = (id) => plantas.find((p) => p.id === id)?.nombre || "";
  const archivosDe = (x) => (x.tipo === "orden" ? archOrden[`${x.orden_id}|${x.planta_id}`] : archRemito[x.remito_id]) || [];

  const na = async (x, valor) => {
    if (valor && !(await confirmar(`¿Marcar el remito ${x.remitos_txt} como "no lleva conforme"? Sale de la lista de pendientes.`))) return;
    const r = await marcarNA(x.remito_id, valor);
    if (r.error) return setError(r.error);
    cargar();
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Conformes de salida</h1>
          <p className="text-stone-500 text-[13px] sm:text-[13.5px]">
            Cuando sale el camión, adjuntá el PDF (o sacá las fotos) con todos los remitos firmados de esa orden de carga. Si la orden sale en otro camión después, vuelve a pedir conforme. Una orden no se puede cerrar sin el conforme.
          </p>
        </header>

        {!veTodo && !miPlanta && <div className="panel p-4 text-sm text-amber-800">Tu usuario no tiene planta asignada.</div>}

        <div className="grid grid-cols-2 gap-1 sm:flex">
          {[["pendientes", `Pendientes${pend.length ? ` (${pend.length})` : ""}`], ["cargados", "Cargados"]].map(([id, t]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-2 sm:px-4 py-2.5 sm:py-2 rounded text-[13px] sm:text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-700 border-stone-300"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar orden, remito o cliente…" className={`${inputCls} w-full sm:flex-1`} />
          {veTodo && (
            <select value={fPlanta} onChange={(e) => setFPlanta(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
              <option value="">Todas las plantas</option>
              {plantas.filter((p) => base.some((r) => r.planta_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
        </div>

        {error && <div className="text-sm rounded p-3 border bg-red-50 border-red-200 text-red-700">{error}</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !error && !lista.length && (
          <div className="panel p-5 text-sm text-stone-500">{tab === "pendientes" ? "No hay conformes pendientes. 🎉" : "Todavía no hay conformes cargados."}</div>
        )}

        <div className="space-y-2">
          {lista.map((x) => {
            const arch = archivosDe(x);
            const pendiente = pend.some((p) => p.clave === x.clave);
            const borde = tab === "pendientes" ? (pendiente ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-500") : "";
            return (
              <div key={x.tipo + x.clave} className={`panel p-3 sm:p-4 ${borde}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  {x.tipo === "orden" ? (
                    <>
                      <span className="font-semibold text-[15px]">{x.orden_numero}</span>
                      {MOD[x.modalidad] && <span className="text-[11px] font-medium text-stone-600 bg-stone-100 rounded px-1.5 py-0.5">{MOD[x.modalidad].toUpperCase()}</span>}
                    </>
                  ) : (
                    <>
                      <span className="font-mono font-semibold text-[15px]">{x.remitos_txt}</span>
                      <span className="text-[11px] font-medium text-stone-600 bg-stone-100 rounded px-1.5 py-0.5">{x.conOrden ? "REMITO" : "REMITO SIN ORDEN"}</span>
                    </>
                  )}
                  {x.fecha && <span className="text-[13px] text-stone-500">{fmtFecha(x.fecha)}</span>}
                  {veTodo && <span className="text-[12.5px] text-stone-400 sm:ml-auto">{nomPlanta(x.planta_id)}</span>}
                </div>
                {x.clientes && <div className="text-[13.5px] text-stone-800 mt-0.5">{x.clientes}</div>}
                {x.tipo === "orden" && pendiente && x.remitos_txt && (
                  <div className="text-[12.5px] text-amber-800 mt-0.5">
                    Falta el conforme {x.n_remitos === 1 ? "del remito" : `de ${x.n_remitos} remitos`}: <span className="font-mono">{x.remitos_txt}</span>
                  </div>
                )}
                {x.na ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-stone-600">
                    <span className="rounded bg-stone-100 px-2 py-1">N/A conforme · {x.na.marcado_por_nombre}{x.na.motivo ? ` · ${x.na.motivo}` : ""}</span>
                    {esAdmin && <button onClick={() => na(x, false)} className="underline text-stone-500">Quitar N/A</button>}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ConformesRemito
                      destino={x.tipo === "orden" ? { tipo: "orden", orden_id: x.orden_id, planta_id: x.planta_id } : { tipo: "remito", id: x.remito_id, planta_id: x.planta_id, estado: x.estado }}
                      archivos={arch}
                      profile={profile}
                      onCambio={() => { setRecien((s) => new Set(s).add(x.clave)); cargar(); }}
                    />
                    {esAdmin && x.tipo === "remito" && pendiente && !arch.length && (
                      <button onClick={() => na(x, true)} className="text-[12.5px] px-2.5 py-1.5 rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50">N/A conforme</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </NavBar>
  );
}
