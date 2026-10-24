"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, norm, cotAtrasado, nombreConPresentacion } from "@/lib/util";

const esBigBag = (p) => /big\s*-?\s*bag|\bbb\b/i.test(`${p?.presentacion || ""} ${p?.nombre || ""}`);

export default function InicioPage() {
  return <AuthGuard roles={["admin", "consulta", "logistica"]}>{(profile) => <InicioInner profile={profile} />}</AuthGuard>;
}

function InicioInner({ profile }) {
  const [lotes, setLotes] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [transito, setTransito] = useState([]);
  const [cotPend, setCotPend] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloBB, setSoloBB] = useState(true);
  const [q, setQ] = useState("");
  const [actualizado, setActualizado] = useState(null);

  const cargar = async () => {
    setCargando(true);
    setError("");
    const todos = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase
        .from("lotes")
        .select("id, lote, stock, planta_id, producto:productos(nombre, presentacion, categoria, kg_por_unidad)")
        .gt("stock", 0)
        .order("lote")
        .range(desde, desde + 999);
      if (error) {
        setError("No se pudo leer el stock. Probá de nuevo en un momento.");
        break;
      }
      todos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const { data: pl } = await supabase.from("plantas").select("id, nombre, punto_venta").eq("activa", true).order("nombre");
    const { data: tr } = await supabase.from("v_stock_en_transito").select("*").order("fecha", { ascending: false });
    setTransito(tr || []);
    const { data: cp } = await supabase.from("v_cot_pendientes").select("remito_id, planta, created_at").limit(5000);
    setCotPend(cp || []);
    setLotes(todos);
    setPlantas(pl || []);
    setActualizado(new Date());
    setCargando(false);
  };
  useEffect(() => {
    cargar();
  }, []);

  const filas = useMemo(() => {
    const nq = norm(q);
    return lotes
      .filter((l) => (soloBB ? esBigBag(l.producto) : true))
      .filter((l) => !nq || norm(`${l.lote} ${l.producto?.nombre} ${l.producto?.presentacion}`).includes(nq))
      .map((l) => ({ ...l, kg: l.producto?.kg_por_unidad ? l.stock * l.producto.kg_por_unidad : null }));
  }, [lotes, soloBB, q]);

  const porPlanta = useMemo(
    () =>
      plantas.map((p) => {
        const ls = filas.filter((l) => l.planta_id === p.id).sort((a, b) => (a.producto?.nombre || "").localeCompare(b.producto?.nombre || "") || a.lote.localeCompare(b.lote));
        return { planta: p, lotes: ls, unidades: ls.reduce((a, l) => a + Number(l.stock), 0), kg: ls.reduce((a, l) => a + (l.kg || 0), 0) };
      }),
    [plantas, filas]
  );

  const porProducto = useMemo(() => {
    const m = new Map();
    filas.forEach((l) => {
      const k = `${l.producto?.nombre}|${l.producto?.presentacion || ""}`;
      const x = m.get(k) || { nombre: l.producto?.nombre, presentacion: l.producto?.presentacion, unidades: 0, kg: 0 };
      x.unidades += Number(l.stock);
      x.kg += l.kg || 0;
      m.set(k, x);
    });
    return [...m.values()].sort((a, b) => b.unidades - a.unidades);
  }, [filas]);

  const enCamino = useMemo(() => {
    const nq = norm(q);
    return transito
      .filter((t) => (soloBB ? esBigBag({ nombre: t.descripcion }) : true))
      .filter((t) => !nq || norm(`${t.lote} ${t.descripcion} ${t.planta_origen} ${t.planta_destino} ${t.numero}`).includes(nq));
  }, [transito, soloBB, q]);
  const transitoU = enCamino.reduce((a, t) => a + Number(t.cantidad || 0), 0);
  const transitoKg = enCamino.reduce((a, t) => a + Number(t.kg_total || 0), 0);

  const totalU = filas.reduce((a, l) => a + Number(l.stock), 0);
  const totalKg = filas.reduce((a, l) => a + (l.kg || 0), 0);
  const plantasConStock = porPlanta.filter((p) => p.lotes.length).length;

  const exportar = () => {
    const rows = [];
    porPlanta.forEach((p) => p.lotes.forEach((l) => rows.push({ Planta: p.planta.nombre, Producto: l.producto?.nombre, Presentación: l.producto?.presentacion || "", Lote: l.lote, Cantidad: Number(l.stock), "Kg": l.kg ?? "" })));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 24 }, { wch: 34 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, soloBB ? "Stock Big Bag" : "Stock");
    XLSX.writeFile(wb, `stock_${soloBB ? "bigbag_" : ""}${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const Tile = ({ label, valor, sub }) => (
    <div className="panel p-4">
      <div className="text-[12px] text-stone-500 font-medium">{label}</div>
      <div className="text-[26px] font-semibold text-emerald-800 leading-tight mt-1">{valor}</div>
      {sub && <div className="text-[12px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5 min-w-0">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold">Inicio</h1>
            <p className="text-[13px] text-stone-500 mt-1">Stock actual por planta{actualizado ? ` · actualizado ${actualizado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={cargar} disabled={cargando} className="btn-secundario">{cargando ? "Actualizando…" : "Actualizar"}</button>
            <button onClick={exportar} disabled={!filas.length} className="btn-secundario">Exportar a Excel</button>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-4 flex-wrap">
          <div className="inline-flex rounded-md border border-stone-300 overflow-hidden text-[13px]">
            <button onClick={() => setSoloBB(true)} className={`px-3 py-1.5 ${soloBB ? "bg-emerald-700 text-white" : "bg-white text-stone-600"}`}>Big Bag</button>
            <button onClick={() => setSoloBB(false)} className={`px-3 py-1.5 ${!soloBB ? "bg-emerald-700 text-white" : "bg-white text-stone-600"}`}>Todo el stock</button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o lote…" className="px-3 py-1.5 text-[13.5px] w-full md:w-64" />
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        {cotPend.length > 0 && (
          <Link href="/cot" className={`block rounded-lg border px-4 py-3 text-[13.5px] ${cotPend.some((x) => cotAtrasado(x.created_at)) ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
            <b>{cotPend.length}</b> {cotPend.length === 1 ? "remito con COT pendiente" : "remitos con COT pendiente"}
            {cotPend.some((x) => cotAtrasado(x.created_at)) ? ` · ${cotPend.filter((x) => cotAtrasado(x.created_at)).length} con más de un día` : ""}
            {" · "}
            {Object.entries(cotPend.reduce((a, x) => ({ ...a, [x.planta]: (a[x.planta] || 0) + 1 }), {})).map(([pl, n]) => `${pl}: ${n}`).join(" · ")}
            <span className="underline ml-2">Ver</span>
          </Link>
        )}

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <Tile label={soloBB ? "Big Bags en stock" : "Unidades en stock"} valor={fmtNum(totalU)} />
          <Tile label="Kg totales" valor={fmtNum(totalKg)} />
          <Tile label="Lotes con stock" valor={fmtNum(filas.length)} />
          <Tile label="Plantas con stock" valor={`${plantasConStock} de ${plantas.length}`} />
          {transito.length > 0 && <Tile label="En tránsito (traslados)" valor={fmtNum(transitoU)} sub={`${fmtNum(transitoKg)} kg · sigue siendo de la empresa`} />}
        </div>

        {porProducto.length > 0 && (
          <section className="panel p-4 md:p-5">
            <h2 className="paso-titulo mb-3">Total por producto</h2>
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2 text-[13px] grid-cols-1">
              {porProducto.map((x) => (
                <div key={x.nombre + x.presentacion} className="flex justify-between gap-3 min-w-0 border-b border-stone-100 py-1">
                  <span className="min-w-0 break-words md:truncate">{x.nombre} {nombreConPresentacion(x.nombre, x.presentacion) === x.nombre ? null : <span className="text-stone-400">{x.presentacion}</span>}</span>
                  <span className="whitespace-nowrap shrink-0 text-right"><b>{fmtNum(x.unidades)}</b> <span className="text-stone-400">· {fmtNum(x.kg)} kg</span></span>
                </div>
              ))}
            </div>
          </section>
        )}

        {enCamino.length > 0 && (
          <section className="panel overflow-hidden border-t-amber-400">
            <div className="px-4 md:px-5 py-3.5 flex items-center gap-1 md:gap-3 flex-wrap">
              <h2 className="paso-titulo">En tránsito entre plantas</h2>
              <span className="md:ml-auto text-[13px] text-stone-600"><b>{fmtNum(transitoU)}</b> {soloBB ? "BB" : "u."} · {fmtNum(transitoKg)} kg · aún no confirmado por la planta de destino</span>
            </div>
            <div className="md:hidden divide-y divide-stone-100 border-t border-stone-100">
              {enCamino.map((t, i) => (
                <div key={t.remito_id + "-m" + i} className="px-4 py-2.5 space-y-0.5 text-[13px]">
                  <div className="flex justify-between gap-3"><span className="font-medium">{t.punto_venta}-{t.numero} <span className="text-stone-400 font-normal">{fmtFecha(t.fecha)}</span></span><span className="font-semibold whitespace-nowrap">{fmtNum(t.cantidad)} u.{t.kg_total != null ? <span className="text-stone-400 font-normal"> · {fmtNum(t.kg_total)} kg</span> : null}</span></div>
                  <div className="text-stone-600">{t.planta_origen} → {t.planta_destino}</div>
                  <div className="text-stone-500 break-words">{t.descripcion} · <span className="font-mono">{t.lote || "—"}</span></div>
                </div>
              ))}
            </div>
            <table className="w-full text-[13px] hidden md:table">
              <thead>
                <tr className="text-left text-[12px]">
                  <th className="px-5 py-2 font-medium">Remito</th>
                  <th className="px-3 py-2 font-medium">Origen → Destino</th>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 font-medium text-right">Cantidad</th>
                  <th className="px-5 py-2 font-medium text-right">Kg</th>
                </tr>
              </thead>
              <tbody>
                {enCamino.map((t, i) => (
                  <tr key={t.remito_id + "-" + i} className="border-t border-stone-100">
                    <td className="px-5 py-1.5 whitespace-nowrap">{t.punto_venta}-{t.numero} <span className="text-stone-400">{fmtFecha(t.fecha)}</span></td>
                    <td className="px-3 py-1.5">{t.planta_origen} → {t.planta_destino}</td>
                    <td className="px-3 py-1.5">{t.descripcion}</td>
                    <td className="px-3 py-1.5 font-mono">{t.lote || "—"}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{fmtNum(t.cantidad)}</td>
                    <td className="px-5 py-1.5 text-right">{t.kg_total != null ? fmtNum(t.kg_total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!cargando && !filas.length && !error && (
          <div className="panel p-6 text-sm text-stone-500">{lotes.length ? "No hay stock que coincida con el filtro." : "Todavía no hay stock cargado."}</div>
        )}

        <div className="space-y-3">
          {porPlanta.map(({ planta, lotes: ls, unidades, kg }) => (
            <details key={planta.id} open={ls.length > 0} className="panel overflow-hidden group">
              <summary className="cursor-pointer list-none flex items-center gap-x-3 gap-y-0.5 flex-wrap px-4 md:px-5 py-3.5 hover:bg-emerald-50/40">
                <span className="font-semibold text-emerald-900">{planta.nombre}</span>
                <span className="text-[12px] text-stone-400">PV {planta.punto_venta}</span>
                <span className="md:ml-auto text-[13px] text-stone-600 w-full md:w-auto">
                  {ls.length ? (<><b>{fmtNum(unidades)}</b> {soloBB ? "BB" : "u."} · {fmtNum(kg)} kg · {ls.length} lote(s)</>) : <span className="text-stone-400">Sin stock</span>}
                </span>
              </summary>
              {ls.length > 0 && (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px]">
                      <th className="px-3 md:px-5 py-2 font-medium">Producto</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">Presentación</th>
                      <th className="px-3 py-2 font-medium">Lote</th>
                      <th className="px-3 py-2 font-medium text-right">Cantidad</th>
                      <th className="px-3 md:px-5 py-2 font-medium text-right">Kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ls.map((l) => (
                      <tr key={l.id} className="border-t border-stone-100">
                        <td className="px-3 md:px-5 py-1.5 break-words">{l.producto?.nombre}</td>
                        <td className="px-3 py-1.5 text-stone-500 hidden md:table-cell">{l.producto?.presentacion || "—"}</td>
                        <td className="px-2 md:px-3 py-1.5 font-mono text-[12px] md:text-[13px] break-all">{l.lote}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmtNum(l.stock)}</td>
                        <td className="px-3 md:px-5 py-1.5 text-right">{l.kg !== null ? fmtNum(l.kg) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          ))}
        </div>
      </div>
    </NavBar>
  );
}
