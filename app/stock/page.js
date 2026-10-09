"use client";

import { Fragment, useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, up, friendlyError } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";

export default function StockPage() {
  return <AuthGuard>{(profile) => <StockInner profile={profile} />}</AuthGuard>;
}

function StockInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const [plantas, setPlantas] = useState([]);
  const [plantaId, setPlantaId] = useState(profile.planta?.id || "");
  const [productos, setProductos] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [verAgotados, setVerAgotados] = useState(false);
  const [form, setForm] = useState({ productoId: "", lote: "", cantidad: "", motivo: "" });
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [ajuste, setAjuste] = useState(null); // {loteId, delta, motivo}
  const [movs, setMovs] = useState({ loteId: null, rows: [] });

  useEffect(() => {
    (async () => {
      const [p, pl] = await Promise.all([
        supabase.from("productos").select("*").eq("activo", true).order("categoria").order("nombre"),
        supabase.from("plantas").select("*").eq("activa", true).order("nombre"),
      ]);
      setProductos(p.data || []);
      setPlantas(pl.data || []);
      if (esAdmin && !plantaId && pl.data?.[0]) setPlantaId(pl.data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = async () => {
    if (!plantaId) return setLotes([]);
    const { data } = await supabase
      .from("lotes")
      .select("id, lote, stock, producto:productos(nombre, presentacion, categoria, kg_por_unidad)")
      .eq("planta_id", plantaId)
      .order("lote");
    setLotes(data || []);
  };
  useEffect(() => {
    cargar();
    setMovs({ loteId: null, rows: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaId]);

  const ok = (texto) => setMsg({ tipo: "ok", texto });
  const fail = (e) => setMsg({ tipo: "error", texto: friendlyError(e) });

  const ingresar = async (e) => {
    e.preventDefault();
    setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("cargar_stock", {
      p_producto_id: form.productoId,
      p_lote: form.lote,
      p_cantidad: Number(form.cantidad),
      p_planta_id: esAdmin ? plantaId : null,
      p_motivo: form.motivo || null,
    });
    if (error) return fail(error);
    ok(`Se ingresaron ${fmtNum(form.cantidad)} unidades al lote ${up(form.lote)}.`);
    setForm({ productoId: form.productoId, lote: "", cantidad: "", motivo: "" });
    cargar();
  };

  const aplicarAjuste = async () => {
    setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("ajustar_stock", {
      p_lote_id: ajuste.loteId,
      p_delta: Number(ajuste.delta),
      p_motivo: ajuste.motivo,
    });
    if (error) return fail(error);
    ok("Ajuste registrado.");
    setAjuste(null);
    cargar();
  };

  const verMovs = async (loteId) => {
    if (movs.loteId === loteId) return setMovs({ loteId: null, rows: [] });
    const { data } = await supabase
      .from("movimientos_stock")
      .select("*, remito:remitos(punto_venta, numero)")
      .eq("lote_id", loteId)
      .order("created_at", { ascending: false })
      .limit(50);
    setMovs({ loteId, rows: data || [] });
  };

  const visibles = lotes.filter((l) => verAgotados || Number(l.stock) > 0);
  const totalUnidades = visibles.reduce((a, l) => a + Number(l.stock), 0);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800">
      <NavBar profile={profile} />
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold">Stock por lote</h1>
          {esAdmin ? (
            <select value={plantaId} onChange={(e) => setPlantaId(e.target.value)} className={inputCls}>
              {plantas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-stone-500">{profile.planta?.nombre}</span>
          )}
        </div>

        {!plantaId && <div className="text-sm text-red-600">Tu usuario no tiene una planta asignada.</div>}

        {msg.texto && (
          <div className={`text-sm rounded p-3 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-red-50 border-red-300 text-red-700"}`}>{msg.texto}</div>
        )}

        <form onSubmit={ingresar} className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
          <div className="text-xs font-semibold text-stone-500 uppercase">Ingresar stock de un lote</div>
          <div className="flex gap-2 flex-wrap">
            <select required value={form.productoId} onChange={(e) => setForm({ ...form, productoId: e.target.value })} className={`${inputCls} flex-1 min-w-[220px]`}>
              <option value="">Producto…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.categoria.toUpperCase()} · {p.nombre} {p.presentacion}
                </option>
              ))}
            </select>
            <input required value={form.lote} onChange={(e) => setForm({ ...form, lote: up(e.target.value) })} placeholder="N° de lote" className={`${inputCls} w-36`} />
            <input required value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value.replace(",", ".") })} placeholder="Unidades" inputMode="decimal" className={`${inputCls} w-28`} />
            <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Nota (opcional)" className={`${inputCls} flex-1 min-w-[140px]`} />
            <button className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded">Ingresar</button>
          </div>
          <div className="text-xs text-stone-400">Si el lote ya existe, la cantidad se suma al stock actual.</div>
        </form>

        <div className="bg-white border border-stone-200 rounded-lg">
          <div className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-stone-600">
              {visibles.length} lotes · <b>{fmtNum(totalUnidades)}</b> unidades
            </div>
            <label className="text-xs text-stone-500 flex items-center gap-1">
              <input type="checkbox" checked={verAgotados} onChange={(e) => setVerAgotados(e.target.checked)} /> Mostrar agotados
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 bg-stone-50">
                <tr>
                  <th className="text-left p-2 pl-4">Producto</th>
                  <th className="text-left p-2">Lote</th>
                  <th className="text-right p-2">Stock (u.)</th>
                  <th className="text-right p-2">Kg aprox.</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-stone-400">
                      No hay lotes cargados.
                    </td>
                  </tr>
                )}
                {visibles.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="border-t border-stone-100">
                      <td className="p-2 pl-4">
                        <span className="text-[10px] uppercase text-stone-400 mr-1">{l.producto?.categoria}</span>
                        {l.producto?.nombre} {l.producto?.presentacion}
                      </td>
                      <td className="p-2 font-mono">{l.lote}</td>
                      <td className={`p-2 text-right font-semibold ${Number(l.stock) === 0 ? "text-stone-300" : ""}`}>{fmtNum(l.stock)}</td>
                      <td className="p-2 text-right text-stone-500">{l.producto?.kg_por_unidad ? fmtNum(l.stock * l.producto.kg_por_unidad) : "—"}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <button onClick={() => setAjuste({ loteId: l.id, delta: "", motivo: "" })} className="text-xs text-emerald-700 hover:underline mr-3">
                          Ajustar
                        </button>
                        <button onClick={() => verMovs(l.id)} className="text-xs text-stone-500 hover:underline">
                          Movimientos
                        </button>
                      </td>
                    </tr>
                    {ajuste?.loteId === l.id && (
                      <tr className="bg-amber-50">
                        <td colSpan={5} className="p-3">
                          <div className="flex gap-2 flex-wrap items-center">
                            <input value={ajuste.delta} onChange={(e) => setAjuste({ ...ajuste, delta: e.target.value.replace(",", ".") })} placeholder="+/− unidades" className={`${inputCls} w-32`} />
                            <input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} placeholder="Motivo del ajuste (obligatorio)" className={`${inputCls} flex-1 min-w-[200px]`} />
                            <button onClick={aplicarAjuste} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">
                              Aplicar
                            </button>
                            <button onClick={() => setAjuste(null)} className="text-sm text-stone-500">
                              Cancelar
                            </button>
                          </div>
                          <div className="text-xs text-stone-500 mt-1">Ej.: −5 por bolsa dañada, +10 por conteo físico. Queda registrado quién lo hizo.</div>
                        </td>
                      </tr>
                    )}
                    {movs.loteId === l.id && (
                      <tr className="bg-stone-50">
                        <td colSpan={5} className="p-3">
                          <table className="w-full text-xs">
                            <tbody>
                              {movs.rows.map((m) => (
                                <tr key={m.id} className="border-b border-stone-100">
                                  <td className="py-1 pr-2 text-stone-400">{new Date(m.created_at).toLocaleString("es-AR")}</td>
                                  <td className="pr-2 uppercase">{m.tipo}</td>
                                  <td className={`pr-2 text-right font-semibold ${m.cantidad < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtNum(m.cantidad)}</td>
                                  <td className="pr-2 text-right text-stone-500">→ {fmtNum(m.stock_resultante)}</td>
                                  <td className="pr-2">{m.remito ? `Remito ${m.remito.punto_venta}-${m.remito.numero}` : m.motivo || ""}</td>
                                  <td className="text-stone-400">{m.usuario_nombre}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
