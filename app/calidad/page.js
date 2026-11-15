"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, norm, friendlyError, nombreConPresentacion } from "@/lib/util";
import { ESTADOS_CALIDAD, calidadInfo, calKey, traerDatosLotes } from "@/lib/calidad";

export default function CalidadPage() {
  return <AuthGuard roles={["admin", "logistica"]}>{(profile) => <CalidadInner profile={profile} />}</AuthGuard>;
}

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm bg-white";

function CalidadInner({ profile }) {
  const [filas, setFilas] = useState([]); // un renglón por producto + lote (suma todas las plantas)
  const [plantas, setPlantas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fPlanta, setFPlanta] = useState("");
  const [fCat, setFCat] = useState("");
  const [soloStock, setSoloStock] = useState(true);
  const [sel, setSel] = useState({});
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    setCargando(true);
    const { data: pl } = await supabase.from("plantas").select("id, nombre").eq("activa", true).order("nombre");
    setPlantas(pl || []);
    const nombrePl = Object.fromEntries((pl || []).map((p) => [p.id, p.nombre]));
    const lotes = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await supabase
        .from("lotes")
        .select("id, lote, stock, danado, planta_id, producto_id, producto:productos(nombre, presentacion, categoria, grupo)")
        .order("id")
        .range(d, d + 999);
      if (error) { setMsg({ tipo: "error", texto: friendlyError(error) }); break; }
      lotes.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const datos = await traerDatosLotes(supabase);
    const m = new Map();
    for (const l of lotes) {
      if (l.lote === "PALLETS") continue;
      const k = calKey(l.producto_id, l.lote);
      let f = m.get(k);
      if (!f) {
        const d = datos[k] || {};
        f = { k, producto_id: l.producto_id, lote: String(l.lote).trim().toUpperCase(), producto: l.producto, estado: d.estado || "aprobado", calibre: d.calibre || "", kg: d.kg || null, stock: 0, danado: 0, plantas: [] };
        m.set(k, f);
      }
      f.stock += Number(l.stock);
      f.danado += Number(l.danado || 0);
      if (Number(l.stock) > 0 || !f.plantas.length) f.plantas.push({ id: l.planta_id, nombre: nombrePl[l.planta_id] || "—", stock: Number(l.stock) });
    }
    setFilas([...m.values()].sort((a, b) => nombreConPresentacion(a.producto?.nombre, a.producto?.presentacion).localeCompare(nombreConPresentacion(b.producto?.nombre, b.producto?.presentacion)) || a.lote.localeCompare(b.lote, "es", { numeric: true })));
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const nq = norm(q);
    return filas.filter((f) =>
      (!soloStock || f.stock > 0) &&
      (!fEstado || f.estado === fEstado) &&
      (!fPlanta || f.plantas.some((p) => p.id === fPlanta)) &&
      (!fCat || f.producto?.categoria === fCat) &&
      (!nq || norm(`${f.lote} ${f.producto?.nombre} ${f.producto?.presentacion} ${f.calibre}`).includes(nq)));
  }, [filas, q, fEstado, fPlanta, fCat, soloStock]);

  const idsSel = visibles.filter((f) => sel[f.k]);
  const todos = visibles.length > 0 && visibles.every((f) => sel[f.k]);
  const resumen = ESTADOS_CALIDAD.map((e) => ({ ...e, n: filas.filter((f) => f.estado === e.v && (!soloStock || f.stock > 0)).length }));

  const aplicar = async () => {
    if (!nuevo || !idsSel.length) return;
    if (!window.confirm(`¿Pasar ${idsSel.length} lote${idsSel.length === 1 ? "" : "s"} a "${calidadInfo(nuevo).t}"?`)) return;
    setBusy(true);
    setMsg({ tipo: "", texto: "" });
    const { data, error } = await supabase.rpc("calidad_masiva", { p_filas: idsSel.map((f) => ({ producto_id: f.producto_id, lote: f.lote, estado: nuevo })) });
    setBusy(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `${data ?? idsSel.length} lote(s) pasaron a "${calidadInfo(nuevo).t}".` });
    setSel({});
    cargar();
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4 min-w-0">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Calidad</h1>
          <p className="text-[13px] text-stone-500">Estado de calidad de cada lote. Vale para el lote en todas las plantas y no mueve stock. Solo los lotes aprobados se pueden remitir a clientes.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {resumen.map((e) => (
            <button key={e.v} onClick={() => setFEstado(fEstado === e.v ? "" : e.v)} className={`text-[12.5px] font-semibold px-2.5 py-1 rounded border ${fEstado === e.v ? "border-stone-800" : "border-transparent"} ${e.cls}`}>
              {e.t}: {e.n}
            </button>
          ))}
        </div>

        <div className="panel p-3 flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lote, producto o calibre…" className={`${inputCls} flex-1 min-w-[200px]`} />
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={inputCls}>
            <option value="">Todos los estados</option>
            {ESTADOS_CALIDAD.map((e) => <option key={e.v} value={e.v}>{e.t}</option>)}
          </select>
          <select value={fPlanta} onChange={(e) => setFPlanta(e.target.value)} className={inputCls}>
            <option value="">Todas las plantas</option>
            {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select value={fCat} onChange={(e) => setFCat(e.target.value)} className={inputCls}>
            <option value="">Soja, maíz y otros</option>
            <option value="soja">Soja</option>
            <option value="maiz">Maíz</option>
            <option value="otro">Otros</option>
          </select>
          <label className="text-[13px] text-stone-600 flex items-center gap-1.5">
            <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} /> Solo con stock
          </label>
        </div>

        <div className="panel p-3 flex flex-wrap gap-2 items-center sticky top-0 z-10">
          <span className="text-[13px] text-stone-700"><b>{idsSel.length}</b> lote{idsSel.length === 1 ? "" : "s"} tildado{idsSel.length === 1 ? "" : "s"}</span>
          <select value={nuevo} onChange={(e) => setNuevo(e.target.value)} className={inputCls}>
            <option value="">Pasar a…</option>
            {ESTADOS_CALIDAD.map((e) => <option key={e.v} value={e.v}>{e.t}</option>)}
          </select>
          <button disabled={busy || !nuevo || !idsSel.length} onClick={aplicar} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40">{busy ? "Aplicando…" : "Aplicar"}</button>
          {idsSel.length > 0 && <button onClick={() => setSel({})} className="text-xs text-stone-500 underline">Limpiar selección</button>}
        </div>

        {msg.texto && <div className={`text-sm rounded p-2 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-300 text-red-700"}`}>{msg.texto}</div>}

        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50">
              <tr>
                <th className="p-2 pl-4 w-8"><input type="checkbox" title="Tildar todos los que se ven" checked={todos} onChange={(e) => setSel(e.target.checked ? { ...sel, ...Object.fromEntries(visibles.map((f) => [f.k, true])) } : {})} /></th>
                <th className="text-left p-2">Producto</th>
                <th className="text-left p-2">Lote</th>
                <th className="text-left p-2">Estado</th>
                <th className="text-right p-2">Stock</th>
                <th className="text-left p-2 hidden md:table-cell">Plantas</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={6} className="p-6 text-center text-stone-400">Cargando…</td></tr>}
              {!cargando && !visibles.length && <tr><td colSpan={6} className="p-6 text-center text-stone-400">No hay lotes con esos filtros.</td></tr>}
              {visibles.map((f) => (
                <tr key={f.k} className={`border-t border-stone-100 cursor-pointer ${sel[f.k] ? "bg-emerald-50" : ""}`} onClick={() => setSel({ ...sel, [f.k]: !sel[f.k] })}>
                  <td className="p-2 pl-4"><input type="checkbox" checked={!!sel[f.k]} onChange={() => {}} /></td>
                  <td className="p-2">{nombreConPresentacion(f.producto?.nombre, f.producto?.presentacion)}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{f.lote}{f.calibre && <span className="ml-2 font-sans text-[11px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">Calibre {f.calibre}</span>}</td>
                  <td className="p-2 whitespace-nowrap">
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${calidadInfo(f.estado).cls}`}>{calidadInfo(f.estado).t}</span>
                    {f.danado > 0 && <span className="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800">{fmtNum(f.danado)} dañ.</span>}
                  </td>
                  <td className="p-2 text-right font-semibold">{fmtNum(f.stock)}</td>
                  <td className="p-2 text-[12px] text-stone-500 hidden md:table-cell">{f.plantas.map((p) => `${p.nombre} (${fmtNum(p.stock)})`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </NavBar>
  );
}
