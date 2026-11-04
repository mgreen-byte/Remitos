"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, friendlyError } from "@/lib/util";
import { TIPOS, generarReporte, reporteExcel, reportePdf } from "@/lib/reportes";

export default function ReportesPage() {
  return <AuthGuard roles={["admin"]}>{(profile) => <ReportesInner profile={profile} />}</AuthGuard>;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mesActual = () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; };
const MAX_VISTA = 100;

function ReportesInner({ profile }) {
  const [tipo, setTipo] = useState("remitos");
  const [[desde, hasta], setRango] = useState(mesActual());
  const [plantaId, setPlantaId] = useState("");
  const [plantas, setPlantas] = useState([]);
  const [cliente, setCliente] = useState("");
  const [producto, setProducto] = useState("");
  const [tipoRemito, setTipoRemito] = useState("cliente");
  const [soloConOrden, setSoloConOrden] = useState(false);
  const [estadoOrden, setEstadoOrden] = useState("activa");
  const [tipoOrden, setTipoOrden] = useState("cliente");
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [soloConStock, setSoloConStock] = useState(true);
  const [rep, setRep] = useState(null);
  const [filtrosTxt, setFiltrosTxt] = useState("");
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("plantas").select("id, nombre").eq("activa", true).order("nombre").then(({ data }) => setPlantas(data || []));
  }, []);
  useEffect(() => { setRep(null); setError(""); }, [tipo]);

  const usaFechas = tipo !== "stock";
  const nombrePlanta = plantas.find((p) => p.id === plantaId)?.nombre || "Todas las plantas";

  const descripcionFiltros = () => {
    const p = [`Planta: ${nombrePlanta}`];
    if (usaFechas) p.push(`${tipo === "ordenes" ? "Fecha de orden" : "Fecha de remito"}: ${desde || "inicio"} a ${hasta || "hoy"}`);
    if (tipo === "remitos") p.push(`Tipo: ${tipoRemito === "cliente" ? "despachos a clientes" : tipoRemito === "traslado" ? "traslados entre plantas" : "clientes y traslados"}`, soloConOrden ? "solo con orden de carga" : "");
    if (tipo === "ordenes") p.push(`Órdenes: ${estadoOrden === "activa" ? "activas" : "todas"}`, `Tipo: ${tipoOrden === "cliente" ? "clientes" : tipoOrden === "traslado" ? "traslados" : "clientes y traslados"}`, soloPendientes ? "solo con saldo pendiente" : "");
    if (tipo === "stock" && soloConStock) p.push("solo lotes con stock");
    if (cliente && tipo !== "stock") p.push(`Cliente: ${cliente}`);
    if (producto) p.push(`Producto/lote: ${producto}`);
    return p.filter(Boolean).join("  ·  ");
  };

  const generar = async () => {
    setCargando(true); setError(""); setRep(null);
    try {
      const r = await generarReporte(supabase, tipo, { desde, hasta, plantaId, cliente: cliente.trim(), producto: producto.trim(), tipoRemito, soloConOrden, estadoOrden, tipoOrden, soloPendientes, soloConStock });
      setRep(r); setFiltrosTxt(descripcionFiltros());
    } catch (e) { setError(friendlyError(e)); }
    setCargando(false);
  };

  const bajar = async (fmtArchivo) => {
    setBajando(fmtArchivo); setError("");
    try { await (fmtArchivo === "xlsx" ? reporteExcel(rep, filtrosTxt) : reportePdf(rep, filtrosTxt)); }
    catch (e) { setError(friendlyError(e)); }
    setBajando("");
  };

  const inp = "border border-stone-300 rounded-md px-2.5 py-1.5 text-[13.5px] bg-white";
  const chk = "flex items-center gap-2 text-[13.5px] text-stone-700";
  const totales = useMemo(() => (rep ? rep.columnas.filter((c) => c.n).map((c) => [c.t, rep.totales[c.k]]) : []), [rep]);

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5 min-w-0">
        <div>
          <h1 className="text-[22px] font-semibold">Reportes</h1>
          <p className="text-[13px] text-stone-500 mt-1">Elegí qué reporte, ajustá los filtros, mirá la vista previa y descargalo en Excel o PDF.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(TIPOS).map(([k, t]) => (
            <button key={k} onClick={() => setTipo(k)} className={`px-4 py-2 rounded-full text-[13.5px] border ${tipo === k ? "bg-emerald-700 text-white border-emerald-700" : "border-stone-300 text-stone-700 bg-white hover:bg-stone-50"}`}>{t.titulo}</button>
          ))}
        </div>
        <p className="text-[13px] text-stone-500 -mt-2">{TIPOS[tipo].ayuda}</p>

        <section className="panel p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            {usaFechas && (
              <>
                <div><div className="text-[12px] text-stone-500 mb-1">Desde</div><input type="date" value={desde} onChange={(e) => setRango([e.target.value, hasta])} className={inp} /></div>
                <div><div className="text-[12px] text-stone-500 mb-1">Hasta</div><input type="date" value={hasta} onChange={(e) => setRango([desde, e.target.value])} className={inp} /></div>
              </>
            )}
            <div>
              <div className="text-[12px] text-stone-500 mb-1">Planta</div>
              <select value={plantaId} onChange={(e) => setPlantaId(e.target.value)} className={inp}>
                <option value="">Todas las plantas</option>
                {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            {tipo !== "stock" && (
              <div className="min-w-[180px] flex-1"><div className="text-[12px] text-stone-500 mb-1">Cliente (nombre o CUIT)</div><input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="contiene…" className={`${inp} w-full`} /></div>
            )}
            <div className="min-w-[180px] flex-1"><div className="text-[12px] text-stone-500 mb-1">{tipo === "stock" ? "Producto o lote" : "Producto"}</div><input value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="contiene…" className={`${inp} w-full`} /></div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
            {tipo === "remitos" && (
              <>
                <div className="flex items-center gap-2 text-[13.5px]">Tipo
                  <select value={tipoRemito} onChange={(e) => setTipoRemito(e.target.value)} className={inp}>
                    <option value="cliente">Despachos a clientes</option>
                    <option value="traslado">Traslados entre plantas</option>
                    <option value="ambos">Clientes y traslados</option>
                  </select>
                </div>
                <label className={chk}><input type="checkbox" checked={soloConOrden} onChange={(e) => setSoloConOrden(e.target.checked)} /> Solo con orden de carga</label>
              </>
            )}
            {tipo === "ordenes" && (
              <>
                <div className="flex items-center gap-2 text-[13.5px]">Órdenes
                  <select value={estadoOrden} onChange={(e) => setEstadoOrden(e.target.value)} className={inp}>
                    <option value="activa">Solo activas</option>
                    <option value="todas">Todas (incluye cerradas y anuladas)</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 text-[13.5px]">Tipo
                  <select value={tipoOrden} onChange={(e) => setTipoOrden(e.target.value)} className={inp}>
                    <option value="cliente">Clientes</option>
                    <option value="traslado">Traslados</option>
                    <option value="ambos">Clientes y traslados</option>
                  </select>
                </div>
                <label className={chk}><input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo con saldo pendiente</label>
              </>
            )}
            {tipo === "stock" && <label className={chk}><input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} /> Solo lotes con stock</label>}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={generar} disabled={cargando} className="btn-primario">{cargando ? "Generando…" : "Generar reporte"}</button>
            {rep && rep.filas.length > 0 && (
              <>
                <button onClick={() => bajar("xlsx")} disabled={!!bajando} className="btn-secundario">{bajando === "xlsx" ? "Preparando…" : "Descargar Excel"}</button>
                <button onClick={() => bajar("pdf")} disabled={!!bajando} className="btn-secundario">{bajando === "pdf" ? "Preparando…" : "Descargar PDF"}</button>
              </>
            )}
          </div>
        </section>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        {rep && (
          <section className="panel p-4 space-y-3 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-[15px]">{rep.titulo} · {fmtNum(rep.filas.length)} fila{rep.filas.length === 1 ? "" : "s"}</h2>
              <div className="text-[13px] text-stone-600">{totales.map(([t, v]) => <span key={t} className="ml-4">{t}: <b>{fmtNum(v)}</b></span>)}</div>
            </div>
            <div className="text-[12px] text-stone-400">{filtrosTxt}</div>
            {rep.filas.length === 0 ? (
              <div className="text-[13px] text-stone-400 py-3">No hay datos con esos filtros.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-stone-500 border-b border-stone-200">
                      {rep.columnas.map((c) => <th key={c.k} className={`p-1.5 whitespace-nowrap ${c.n ? "text-right" : ""}`}>{c.t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rep.filas.slice(0, MAX_VISTA).map((x, i) => (
                      <tr key={i} className="border-b border-stone-100 align-top">
                        {rep.columnas.map((c) => <td key={c.k} className={`p-1.5 ${c.n ? "text-right whitespace-nowrap" : ""}`}>{c.n ? fmtNum(x[c.k]) : x[c.k]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rep.filas.length > MAX_VISTA && <div className="text-[12px] text-stone-400">Vista previa de las primeras {MAX_VISTA} filas. Los archivos descargados traen todas.</div>}
          </section>
        )}
      </div>
    </NavBar>
  );
}
