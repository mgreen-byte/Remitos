"use client";
// Remito conforme de salida del depósito: la planta saca la foto (o adjunta PDF) de cada remito despachado.
import { useState, useEffect, useCallback, useMemo } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import ConformesRemito from "@/components/Conformes";
import { supabase } from "@/lib/supabaseClient";
import { conformesDe } from "@/lib/conformes";
import { fmtFecha, friendlyError, norm } from "@/lib/util";

export default function ConformesPage() {
  return <AuthGuard>{(profile) => <ConformesInner profile={profile} />}</AuthGuard>;
}

const inputCls = "border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";
const ocTxt = (r) => (r.orden_carga ? (r.orden_salida ? `${r.orden_carga} · ${r.orden_salida}` : r.orden_carga) : "");

function ConformesInner({ profile }) {
  const veTodo = profile.rol !== "operador";
  const miPlanta = profile.planta?.id || null;
  const [tab, setTab] = useState("pendientes");
  const [pend, setPend] = useState([]);
  const [cargados, setCargados] = useState([]); // remitos con conforme (recientes)
  const [archivos, setArchivos] = useState({});
  const [plantas, setPlantas] = useState([]);
  const [fPlanta, setFPlanta] = useState("");
  const [busca, setBusca] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [recien, setRecien] = useState(() => new Set()); // cargados en esta visita: siguen a la vista para sumar otra foto

  const cargar = useCallback(async () => {
    setError("");
    if (!veTodo && !miPlanta) return setCargando(false);
    let qp = supabase.from("v_remitos_sin_conforme").select("*").order("created_at", { ascending: false }).limit(300);
    if (!veTodo) qp = qp.eq("planta_id", miPlanta);
    const [p, c] = await Promise.all([qp, supabase.from("remito_conformes").select("remito_id, created_at").order("created_at", { ascending: false }).limit(400)]);
    if (p.error) {
      setCargando(false);
      return setError(/v_remitos_sin_conforme/.test(p.error.message || "") ? "Falta correr migration_62.sql en Supabase." : friendlyError(p.error));
    }
    const ids = [...new Set((c.data || []).map((x) => x.remito_id))].slice(0, 150);
    let rc = [];
    if (ids.length) {
      let q = supabase.from("remitos").select("id, planta_id, punto_venta, numero, fecha, created_at, tipo, estado, cliente_nombre, cliente_provincia, orden_carga, orden_salida, chofer_nombre, chasis").in("id", ids);
      if (!veTodo) q = q.eq("planta_id", miPlanta);
      rc = (await q).data || [];
      const orden = new Map(ids.map((id, i) => [id, i]));
      rc.sort((a, b) => orden.get(a.id) - orden.get(b.id));
    }
    setPend(p.data || []);
    setCargados(rc);
    setArchivos(await conformesDe([...(p.data || []).map((r) => r.id), ...rc.map((r) => r.id)]));
    setCargando(false);
  }, [veTodo, miPlanta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (veTodo) supabase.from("plantas").select("id, nombre").order("nombre").then(({ data }) => setPlantas(data || []));
  }, [veTodo]);

  const base = tab === "pendientes"
    ? [...cargados.filter((r) => recien.has(r.id) && !pend.some((x) => x.id === r.id)), ...pend].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    : cargados;
  const lista = useMemo(() => {
    const q = norm(busca);
    return base.filter((r) => (!fPlanta || r.planta_id === fPlanta) && (!q || [r.punto_venta + "-" + r.numero, r.numero, r.cliente_nombre, ocTxt(r), r.chofer_nombre, r.chasis].some((x) => norm(x).includes(q))));
  }, [base, busca, fPlanta]);
  const nomPlanta = (id) => plantas.find((p) => p.id === id)?.nombre || "";

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Remitos conformes</h1>
          <p className="text-stone-500 text-[13px] sm:text-[13.5px]">
            Cuando sale el camión, sacale una foto al remito conforme firmado (o adjuntá el PDF). Una orden de carga no se puede cerrar mientras alguno de sus remitos no tenga el conforme.
          </p>
        </header>

        {!veTodo && !miPlanta && <div className="panel p-4 text-sm text-amber-800">Tu usuario no tiene planta asignada.</div>}

        <div className="grid grid-cols-2 gap-1 sm:flex">
          {[["pendientes", `Sin conforme${pend.length ? ` (${pend.length})` : ""}`], ["cargados", "Cargados"]].map(([id, t]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-2 sm:px-4 py-2.5 sm:py-2 rounded text-[13px] sm:text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-700 border-stone-300"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar remito, cliente, orden, chofer, patente…" className={`${inputCls} w-full sm:flex-1`} />
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
          <div className="panel p-5 text-sm text-stone-500">{tab === "pendientes" ? "No hay remitos sin conforme. 🎉" : "Todavía no hay conformes cargados."}</div>
        )}

        <div className="space-y-2">
          {lista.map((r) => (
            <div key={r.id} className={`panel p-3 sm:p-4 ${tab === "pendientes" ? (archivos[r.id]?.length ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-amber-400") : ""}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-mono font-semibold text-[15px]">{r.punto_venta}-{r.numero}</span>
                <span className="text-[13px] text-stone-500">{fmtFecha(r.fecha)}</span>
                {r.tipo === "traslado" && <span className="text-[11px] font-medium text-sky-700 bg-sky-50 rounded px-1.5 py-0.5">TRASLADO</span>}
                {ocTxt(r) && <span className="text-[12.5px] text-stone-600">{ocTxt(r)}</span>}
                {veTodo && <span className="text-[12.5px] text-stone-400 sm:ml-auto">{nomPlanta(r.planta_id)}</span>}
              </div>
              <div className="text-[13.5px] text-stone-800 mt-0.5">
                {r.cliente_nombre || "—"}
                {r.cliente_provincia ? <span className="text-stone-400"> · {r.cliente_provincia}</span> : null}
              </div>
              {(r.chofer_nombre || r.chasis) && <div className="text-[12.5px] text-stone-500">{[r.chofer_nombre, r.chasis].filter(Boolean).join(" · ")}</div>}
              <div className="mt-2">
                <ConformesRemito remito={r} archivos={archivos[r.id] || []} profile={profile} onCambio={() => { setRecien((x) => new Set(x).add(r.id)); cargar(); }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </NavBar>
  );
}
