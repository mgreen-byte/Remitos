"use client";

import { Fragment, useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { traerTodo } from "@/lib/despachos";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, up, norm, friendlyError, nombreConPresentacion } from "@/lib/util";
import ImportarStock from "@/components/ImportarStock";

const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm";

export default function StockPage() {
  return <AuthGuard>{(profile) => <StockInner profile={profile} />}</AuthGuard>;
}

function StockInner({ profile }) {
  const esAdmin = profile.rol === "admin" || profile.rol === "consulta" || profile.rol === "logistica"; // elige planta
  const soloLectura = profile.rol === "consulta";
  const puedeCargar = profile.rol === "admin"; // solo el admin carga stock
  const puedeSumar = profile.rol === "admin" || profile.rol === "logistica"; // ajustes positivos
  const [plantas, setPlantas] = useState([]);
  const [plantaId, setPlantaId] = useState(profile.planta?.id || "");
  const [productos, setProductos] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [inicialPorLote, setInicialPorLote] = useState({}); // lote_id -> suma de ingresos, ajustes positivos y traslados recibidos
  const [tip, setTip] = useState(null); // cartel flotante de Comprometido: {x, y, titulo, items, total}
  const [ocLineas, setOcLineas] = useState([]); // líneas de órdenes activas con saldo (comprometido)
  const [verAgotados, setVerAgotados] = useState(false);
  const [form, setForm] = useState({ productoId: "", lote: "", cantidad: "", motivo: "" });
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [abiertos, setAbiertos] = useState({}); // productos desplegados
  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState({}); // lotes tildados para eliminar
  const [reasig, setReasig] = useState(null); // {loteId, productoId}
  const [ajuste, setAjuste] = useState(null); // {loteId, delta, motivo}
  const [transito, setTransito] = useState([]);
  const [importando, setImportando] = useState(false);
  const [todasPlantas, setTodasPlantas] = useState([]);
  const [movs, setMovs] = useState({ loteId: null, rows: [] });

  useEffect(() => {
    (async () => {
      const [p, pl] = await Promise.all([
        supabase.from("productos").select("*").eq("activo", true).order("categoria").order("nombre"),
        supabase.from("plantas").select("*").eq("activa", true).order("nombre"),
      ]);
      setProductos(p.data || []);
      setPlantas(pl.data || []);
      setTodasPlantas(pl.data || []);
      if (esAdmin && !plantaId && pl.data?.[0]) setPlantaId(pl.data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = async () => {
    if (!plantaId) return setLotes([]);
    const { data } = await supabase
      .from("lotes")
      .select("id, lote, stock, producto_id, producto:productos(nombre, presentacion, categoria, kg_por_unidad)")
      .eq("planta_id", plantaId)
      .order("lote");
    setLotes(data || []);
    const { data: ln } = await supabase
      .from("v_ordenes_lineas_saldo")
      .select("id, producto_id, lote_texto, planta_id, saldo, orden_numero, cliente")
      .eq("planta_id", plantaId)
      .eq("orden_estado", "activa")
      .gt("saldo", 0);
    setOcLineas(ln || []);
    try {
      const movs = await traerTodo(() =>
        supabase.from("movimientos_stock").select("id, lote_id, cantidad, lote:lotes!inner(planta_id)").eq("lote.planta_id", plantaId).in("tipo", ["ingreso", "ajuste", "traslado_ingreso"]).gt("cantidad", 0).order("id")
      );
      const m = {};
      for (const x of movs) m[x.lote_id] = (m[x.lote_id] || 0) + Number(x.cantidad);
      setInicialPorLote(m);
    } catch { setInicialPorLote({}); }
  };
  const cargarTransito = async () => {
    if (!plantaId) return setTransito([]);
    const { data } = await supabase.from("v_stock_en_transito").select("*").or(`planta_id.eq.${plantaId},planta_destino_id.eq.${plantaId}`);
    setTransito(data || []);
  };
  useEffect(() => {
    cargarTransito();
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

  const aplicarReasignacion = async () => {
    setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("reasignar_lote_producto", { p_lote_id: reasig.loteId, p_producto_id: reasig.productoId });
    if (error) return fail(error);
    ok("Lote reasignado al nuevo producto.");
    setReasig(null);
    cargar();
  };

  const eliminarSel = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length) return;
    if (!confirm(`¿Eliminar ${ids.length} lote(s) cargado(s) por error? Se borran con su stock y su historial. No se puede deshacer.`)) return;
    setMsg({ tipo: "", texto: "" });
    const { data, error } = await supabase.rpc("eliminar_lotes", { p_ids: ids });
    if (error) return fail(error);
    ok(`Se eliminaron ${data} lote(s).`);
    setSel({});
    cargar();
  };

  const eliminarMov = async (m, loteId) => {
    if (!confirm(`¿Eliminar este ${m.tipo} de ${fmtNum(m.cantidad)} unidades? El stock del lote se corrige en ${fmtNum(-m.cantidad)}.`)) return;
    const motivo = window.prompt("Motivo (opcional, queda registrado):", "Carga duplicada");
    if (motivo === null) return;
    setMsg({ tipo: "", texto: "" });
    const { error } = await supabase.rpc("eliminar_movimiento_stock", { p_mov_id: m.id, p_motivo: motivo });
    if (error) return fail(error);
    ok("Movimiento eliminado y stock corregido.");
    await cargar();
    await cargarMovs(loteId);
  };

  const verMovs = async (loteId) => {
    if (movs.loteId === loteId) return setMovs({ loteId: null, rows: [] });
    await cargarMovs(loteId);
  };
  const cargarMovs = async (loteId) => {
    const { data } = await supabase
      .from("movimientos_stock")
      .select("*, remito:remitos(punto_venta, numero)")
      .eq("lote_id", loteId)
      .order("created_at", { ascending: false })
      .limit(50);
    setMovs({ loteId, rows: data || [] });
  };

  // Comprometido = saldo pendiente de las órdenes de carga activas (no toca el stock). Se asocia por planta + producto + lote.
  const loteKey = (pid, lote) => `${pid}|${norm(lote)}`;
  const clavesLotes = new Set(lotes.map((l) => loteKey(l.producto_id, l.lote)));
  const compPorLote = {};
  const compSinLote = {}; // producto -> saldo de líneas que no encajan con ningún lote
  let compSinProducto = 0;
  for (const ln of ocLineas) {
    const sal = Number(ln.saldo) || 0;
    if (!ln.producto_id) compSinProducto += sal;
    else if (ln.lote_texto && clavesLotes.has(loteKey(ln.producto_id, ln.lote_texto))) compPorLote[loteKey(ln.producto_id, ln.lote_texto)] = (compPorLote[loteKey(ln.producto_id, ln.lote_texto)] || 0) + sal;
    else compSinLote[ln.producto_id] = (compSinLote[ln.producto_id] || 0) + sal;
  }
  const compDe = (l) => compPorLote[loteKey(l.producto_id, l.lote)] || 0;
  const iniDe = (l) => Number(inicialPorLote[l.id] || 0);
  // Detalle del comprometido: una línea por orden/cliente (saldo pendiente).
  const detalleLote = (l) => ocLineas.filter((ln) => ln.producto_id === l.producto_id && ln.lote_texto && norm(ln.lote_texto) === norm(l.lote)).map((ln) => ({ orden: ln.orden_numero, cliente: ln.cliente, n: Number(ln.saldo) || 0 }));
  const detalleProducto = (g) => ocLineas.filter((ln) => ln.producto_id === g.id).map((ln) => ({
    orden: ln.orden_numero, cliente: ln.cliente, n: Number(ln.saldo) || 0,
    lote: ln.lote_texto && clavesLotes.has(loteKey(ln.producto_id, ln.lote_texto)) ? ln.lote_texto : "",
  }));
  const mostrarTip = (e, titulo, items, fijar) => {
    if (!items.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = { x: Math.min(r.right, window.innerWidth - 12), y: r.bottom + 6, titulo, items, total: items.reduce((a, i) => a + i.n, 0) };
    setTip((prev) => (fijar && prev && prev.titulo === titulo ? null : t));
  };
  const q = norm(busqueda);
  const visibles = lotes
    .filter((l) => verAgotados || Number(l.stock) > 0)
    .filter((l) => !q || norm(`${l.producto?.nombre || ""} ${l.producto?.presentacion || ""} ${l.lote}`).includes(q));
  // Agrupados por producto: producto -> lotes -> movimientos.
  const grupos = [];
  for (const l of visibles) {
    let g = grupos.find((x) => x.id === l.producto_id);
    if (!g) {
      g = { id: l.producto_id, producto: l.producto, lotes: [], unidades: 0, inicial: 0, kg: 0, comp: 0, sinLote: compSinLote[l.producto_id] || 0 };
      grupos.push(g);
    }
    g.lotes.push(l);
    g.unidades += Number(l.stock);
    g.inicial += iniDe(l);
    g.comp += compDe(l);
    g.kg += Number(l.stock) * Number(l.producto?.kg_por_unidad || 0);
  }
  grupos.sort((a, b) => nombreConPresentacion(a.producto?.nombre, a.producto?.presentacion).localeCompare(nombreConPresentacion(b.producto?.nombre, b.producto?.presentacion)));
  const abierto = (g) => !!q || !!abiertos[g.id];
  const totalUnidades = visibles.reduce((a, l) => a + Number(l.stock), 0);
  const totalComp = grupos.reduce((a, g) => a + g.comp + g.sinLote, 0);
  const totalKg = visibles.reduce((a, l) => a + Number(l.stock) * Number(l.producto?.kg_por_unidad || 0), 0);

  return (
    <NavBar profile={profile}>
      <div className="max-w-[1400px] mx-auto p-6 space-y-5">
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

        {puedeCargar && (
          <div>
            {importando ? (
              <ImportarStock profile={profile} plantas={todasPlantas} productos={productos} onClose={() => setImportando(false)} onDone={cargar} />
            ) : (
              <button onClick={() => setImportando(true)} className="btn-secundario">Cargar stock desde Excel</button>
            )}
          </div>
        )}

        {!plantaId && <div className="text-sm text-red-600">Tu usuario no tiene una planta asignada.</div>}

        {msg.texto && (
          <div className={`text-sm rounded p-3 border ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-red-50 border-red-300 text-red-700"}`}>{msg.texto}</div>
        )}

        {transito.length > 0 && (
          <div className="panel p-4 space-y-2 border-amber-200 bg-amber-50/50">
            <div className="text-xs font-semibold text-amber-800 uppercase">Mercadería en tránsito (sigue siendo de la empresa)</div>
            <div className="divide-y divide-amber-100">
              {(() => {
                const m = new Map();
                for (const t of transito) {
                  if (!m.has(t.remito_id)) m.set(t.remito_id, { ...t, items: [], u: 0 });
                  const g = m.get(t.remito_id); g.items.push(t); g.u += Number(t.cantidad || 0);
                }
                return [...m.values()].map((g) => (
                  <details key={g.remito_id} className="group">
                    <summary className="cursor-pointer list-none py-2 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[13px]">
                      <span className="text-stone-400 group-open:rotate-90 transition-transform">▸</span>
                      <span className="font-mono font-semibold">{g.punto_venta}-{g.numero}</span>
                      <span className="text-stone-600">{g.planta_id === plantaId ? `hacia ${g.planta_destino}` : `desde ${g.planta_origen}`}</span>
                      <span className="ml-auto font-semibold whitespace-nowrap">{fmtNum(g.u)} u.<span className="text-stone-400 font-normal"> · {g.items.length} {g.items.length === 1 ? "renglón" : "renglones"}</span></span>
                    </summary>
                    <div className="pl-6 pb-2 space-y-1">
                      {g.items.map((t, i) => (
                        <div key={i} className="flex justify-between gap-3 text-[13px]">
                          <span className="min-w-0 break-words">{t.descripcion} <span className="font-mono text-[12px] text-stone-500">· {t.lote}</span></span>
                          <span className="font-semibold shrink-0">{fmtNum(t.cantidad)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ));
              })()}
            </div>
            <div className="text-xs text-stone-500">Lo que viene desde otra planta se suma a tu stock cuando confirmás la recepción en Traslados.</div>
          </div>
        )}

        {!puedeCargar && !soloLectura && (
          <div className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded p-3">
            {puedeSumar ? "El stock nuevo lo carga el administrador o llega por traslados. Acá podés ajustar (sumar o restar) con motivo." : "El stock de tu planta lo carga el administrador o llega por traslados. Acá podés registrar bajas (mermas, roturas) con un ajuste negativo."}
          </div>
        )}

        {puedeCargar && (
        <form onSubmit={ingresar} className="panel p-4 space-y-3">
          <div className="text-xs font-semibold text-stone-500 uppercase">Ingresar stock de un lote</div>
          <div className="flex gap-2 flex-wrap">
            <select required value={form.productoId} onChange={(e) => setForm({ ...form, productoId: e.target.value })} className={`${inputCls} flex-1 min-w-[220px]`}>
              <option value="">Producto…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {((p.grupo || "semilla") === "semilla" ? p.categoria : p.grupo).toUpperCase()} · {nombreConPresentacion(p.nombre, p.presentacion)}
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
        )}

        <div className="panel">
          <div className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-stone-600">
              {visibles.length} lotes · <b>{fmtNum(totalUnidades)}</b> unidades · <b>{fmtNum(totalKg)}</b> kg · comprometido <b>{fmtNum(totalComp)}</b> · disponible <b className={totalUnidades - totalComp < 0 ? "text-red-600" : ""}>{fmtNum(totalUnidades - totalComp)}</b>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar variedad o lote…" className={`${inputCls} w-56`} />
              <button type="button" onClick={() => setAbiertos(Object.fromEntries(grupos.map((g) => [g.id, true])))} className="text-xs text-emerald-700 hover:underline">Abrir todo</button>
              <button type="button" onClick={() => setAbiertos({})} className="text-xs text-emerald-700 hover:underline">Cerrar todo</button>
            </div>
            <label className="text-xs text-stone-500 flex items-center gap-1">
              <input type="checkbox" checked={verAgotados} onChange={(e) => setVerAgotados(e.target.checked)} /> Mostrar agotados
            </label>
          </div>
          {compSinProducto > 0 && (
            <div className="px-4 pb-2 text-xs text-amber-800">Hay {fmtNum(compSinProducto)} unidades en órdenes de carga de esta planta sin producto identificado: no se descuentan de ningún lote.</div>
          )}
          <div className="md:hidden border-t border-stone-200 divide-y divide-stone-200">
            {profile.rol === "admin" && Object.values(sel).some(Boolean) && (
              <div className="px-4 py-2 bg-red-50"><button onClick={eliminarSel} className="text-sm text-red-700 font-semibold underline">Eliminar seleccionados ({Object.values(sel).filter(Boolean).length})</button></div>
            )}
            {visibles.length === 0 && <div className="p-6 text-center text-stone-400 text-sm">No hay lotes cargados.</div>}
            {grupos.map((g) => {
              const disp = g.unidades - g.comp - g.sinLote;
              return (
                <div key={g.id}>
                  <button type="button" onClick={() => setAbiertos({ ...abiertos, [g.id]: !abiertos[g.id] })} className="w-full text-left px-4 py-3 bg-stone-50/70 active:bg-stone-100">
                    <div className="flex items-start gap-2">
                      <span className="text-stone-400 mt-0.5">{abierto(g) ? "▾" : "▸"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[14px] break-words">{nombreConPresentacion(g.producto?.nombre, g.producto?.presentacion)}</div>
                        <div className="text-[12px] text-stone-500 mt-0.5">{g.lotes.length} lote{g.lotes.length === 1 ? "" : "s"}{g.inicial > 0 ? ` · inicial ${fmtNum(g.inicial)}` : ""}{g.producto?.kg_por_unidad ? ` · ${fmtNum(g.kg)} kg` : ""}</div>
                      </div>
                      <div className="text-right shrink-0 text-[12px] leading-snug">
                        <div><b className="text-[15px]">{fmtNum(g.unidades)}</b> <span className="text-stone-400">stock</span></div>
                        <div className="text-amber-800 underline decoration-dotted" onClick={(e) => { e.stopPropagation(); mostrarTip(e, nombreConPresentacion(g.producto?.nombre, g.producto?.presentacion), detalleProducto(g), true); }}>{g.comp + g.sinLote > 0 ? `${fmtNum(g.comp + g.sinLote)} compr.` : ""}</div>
                        <div className={`font-semibold ${disp < 0 ? "text-red-600" : "text-emerald-800"}`}>{fmtNum(disp)} disp.</div>
                      </div>
                    </div>
                    {g.sinLote > 0 && <div className="text-[11px] text-amber-700 mt-1 pl-5">{fmtNum(g.sinLote)} comprometidas sin lote asignado</div>}
                  </button>
                  {abierto(g) && g.lotes.map((l) => {
                    const dl = Number(l.stock) - compDe(l);
                    return (
                      <div key={l.id} className="pl-9 pr-4 py-2.5 border-t border-stone-100 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <button type="button" onClick={() => verMovs(l.id)} className="font-mono text-[13px] text-left py-1">
                            <span className="text-stone-400 mr-1">{movs.loteId === l.id ? "▾" : "▸"}</span>{l.lote}
                          </button>
                          <div className="text-[12.5px] text-right whitespace-nowrap">
                            {iniDe(l) > 0 && <span className="text-stone-400">ini {fmtNum(iniDe(l))} · </span>}<b className={Number(l.stock) === 0 ? "text-stone-300" : ""}>{fmtNum(l.stock)}</b>
                            {compDe(l) > 0 && <button type="button" className="text-amber-800 underline decoration-dotted" onClick={(e) => mostrarTip(e, `Lote ${l.lote}`, detalleLote(l), true)}> · {fmtNum(compDe(l))} compr.</button>}
                            <span className={dl < 0 ? "text-red-600 font-semibold" : "text-emerald-800"}> · {fmtNum(dl)} disp.</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {!soloLectura && <button onClick={() => setAjuste({ loteId: l.id, delta: "", motivo: "" })} className="text-[13px] text-emerald-700 py-1">Ajustar</button>}
                          {profile.rol === "admin" && <button onClick={() => setReasig({ loteId: l.id, productoId: "" })} className="text-[13px] text-emerald-700 py-1">Cambiar producto</button>}
                          {profile.rol === "admin" && (
                            <label className="text-[13px] text-red-700 py-1 flex items-center gap-1">
                              <input type="checkbox" checked={!!sel[l.id]} onChange={(e) => setSel({ ...sel, [l.id]: e.target.checked })} /> Eliminar
                            </label>
                          )}
                        </div>
                        {ajuste && ajuste.loteId === l.id && (
                          <div className="bg-amber-50 rounded p-3 space-y-2 -ml-3">
                            <input value={ajuste.delta} onChange={(e) => setAjuste({ ...ajuste, delta: e.target.value.replace(",", ".") })} placeholder={puedeSumar ? "+/− unidades" : "− unidades (baja)"} className={`${inputCls} w-full`} />
                            <input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} placeholder="Motivo del ajuste (obligatorio)" className={`${inputCls} w-full`} />
                            <div className="flex gap-3 items-center">
                              <button onClick={aplicarAjuste} className="bg-emerald-700 text-white text-sm px-4 py-2 rounded">Aplicar</button>
                              <button onClick={() => setAjuste(null)} className="text-sm text-stone-500">Cancelar</button>
                            </div>
                            <div className="text-xs text-stone-500">Ej.: −5 por bolsa dañada, +10 por conteo físico.</div>
                          </div>
                        )}
                        {reasig && reasig.loteId === l.id && (
                          <div className="bg-amber-50 rounded p-3 space-y-2 -ml-3">
                            <div className="text-sm">Pasar el lote <b className="font-mono">{l.lote}</b> a:</div>
                            <select value={reasig.productoId} onChange={(e) => setReasig({ ...reasig, productoId: e.target.value })} className={`${inputCls} w-full`}>
                              <option value="">Elegir producto…</option>
                              {productos.filter((p) => p.activo !== false).map((p) => (
                                <option key={p.id} value={p.id}>{nombreConPresentacion(p.nombre, p.presentacion)}{p.kg_por_unidad ? ` · ${fmtNum(p.kg_por_unidad)} kg` : ""}</option>
                              ))}
                            </select>
                            <div className="flex gap-3 items-center">
                              <button disabled={!reasig.productoId} onClick={aplicarReasignacion} className="bg-emerald-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">Reasignar</button>
                              <button onClick={() => setReasig(null)} className="text-sm text-stone-500">Cancelar</button>
                            </div>
                          </div>
                        )}
                        {movs.loteId === l.id && (
                          <div className="bg-stone-50 rounded p-2 -ml-3 space-y-1.5">
                            {movs.rows.map((m) => (
                              <div key={m.id} className="text-[12px] border-b border-stone-100 pb-1">
                                <div className="flex justify-between gap-2">
                                  <span className="uppercase text-stone-600">{String(m.tipo).replace("traslado_", "traslado ")}</span>
                                  <span><b className={m.cantidad < 0 ? "text-red-600" : "text-emerald-700"}>{fmtNum(m.cantidad)}</b> <span className="text-stone-500">→ {fmtNum(m.stock_resultante)}</span></span>
                                </div>
                                <div className="text-stone-500">{m.remito ? `Remito ${m.remito.punto_venta}-${m.remito.numero}` : m.motivo || ""}</div>
                                <div className="text-stone-400">{new Date(m.created_at).toLocaleString("es-AR")} · {m.usuario_nombre}</div>
                                {profile.rol === "admin" && !m.remito_id && ["ingreso", "ajuste"].includes(m.tipo) && (
                                  <button onClick={() => eliminarMov(m, l.id)} className="text-red-700 py-1">Eliminar movimiento</button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 bg-stone-50">
                <tr>
                  <th className="text-left p-2 pl-4">Producto</th>
                  <th className="text-left p-2">Lote</th>
                  <th className="text-right p-2 hidden md:table-cell">Kg x unidad</th>
                  <th className="text-right p-2" title="Total ingresado al lote: ingresos, ajustes positivos y traslados recibidos (sin contar reintegros por anulaciones o correcciones).">Inicial</th>
                  <th className="text-right p-2">Stock (u.)</th>
                  <th className="text-right p-1.5 md:p-2" title="Saldo pendiente de las órdenes de carga activas. No modifica el stock."><span className="md:hidden">Compr.</span><span className="hidden md:inline">Comprometido</span></th>
                  <th className="text-right p-2">Disponible</th>
                  <th className="text-right p-2 hidden md:table-cell">Kg</th>
                  <th className="p-2 text-right">{profile.rol === "admin" && Object.values(sel).some(Boolean) ? <button onClick={eliminarSel} className="text-xs text-red-700 font-semibold underline">Eliminar ({Object.values(sel).filter(Boolean).length})</button> : null}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-stone-400">
                      No hay lotes cargados.
                    </td>
                  </tr>
                )}
                {grupos.map((g) => (
                  <Fragment key={g.id}>
                    <tr className="border-t border-stone-200 bg-stone-50/70 cursor-pointer hover:bg-stone-100" onClick={() => setAbiertos({ ...abiertos, [g.id]: !abiertos[g.id] })}>
                      <td className="p-2 pl-3 md:pl-4 md:whitespace-nowrap font-medium">
                        <span className="inline-block w-4 text-stone-400">{abierto(g) ? "▾" : "▸"}</span>
                        <span className="text-[10px] uppercase text-stone-400 mr-1">{g.producto?.categoria}</span>
                        {nombreConPresentacion(g.producto?.nombre, g.producto?.presentacion)}
                      </td>
                      <td className="p-2 text-stone-500 text-xs">{g.lotes.length} lote{g.lotes.length === 1 ? "" : "s"}</td>
                      <td className="p-2 text-right text-stone-600 hidden md:table-cell">{g.producto?.kg_por_unidad ? fmtNum(g.producto.kg_por_unidad) : "—"}</td>
                      <td className="p-2 text-right text-stone-600">{g.inicial > 0 ? fmtNum(g.inicial) : "—"}</td>
                      <td className="p-2 text-right font-semibold">{fmtNum(g.unidades)}</td>
                      <td className={`p-2 text-right text-amber-800 ${g.comp + g.sinLote > 0 ? "cursor-help" : ""}`} onMouseEnter={(e) => mostrarTip(e, nombreConPresentacion(g.producto?.nombre, g.producto?.presentacion), detalleProducto(g))} onMouseLeave={() => setTip(null)} title={g.sinLote ? `Incluye ${fmtNum(g.sinLote)} de órdenes sin lote asignado (no coinciden con ningún lote de esta planta)` : ""}>
                        {g.comp + g.sinLote > 0 ? fmtNum(g.comp + g.sinLote) : "—"}
                        {g.sinLote > 0 && <div className="text-[10.5px] text-amber-700 font-normal">{fmtNum(g.sinLote)} sin lote asignado</div>}
                      </td>
                      <td className={`p-2 text-right font-semibold ${g.unidades - g.comp - g.sinLote < 0 ? "text-red-600" : "text-emerald-800"}`}>{fmtNum(g.unidades - g.comp - g.sinLote)}</td>
                      <td className="p-2 text-right hidden md:table-cell">{g.producto?.kg_por_unidad ? fmtNum(g.kg) : "—"}</td>
                      <td className="p-2"></td>
                    </tr>
                    {abierto(g) && g.lotes.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="border-t border-stone-100">
                      <td className="p-2 pl-6 md:pl-10 text-xs text-stone-400">lote</td>
                      <td className="p-2 font-mono whitespace-nowrap cursor-pointer hover:underline" onClick={() => verMovs(l.id)} title="Ver movimientos">
                        <span className="inline-block w-4 text-stone-400">{movs.loteId === l.id ? "▾" : "▸"}</span>
                        {l.lote}
                      </td>
                      <td className="p-2 text-right text-stone-600 hidden md:table-cell">{l.producto?.kg_por_unidad ? fmtNum(l.producto.kg_por_unidad) : "—"}</td>
                      <td className="p-2 text-right text-stone-500">{iniDe(l) > 0 ? fmtNum(iniDe(l)) : "—"}</td>
                      <td className={`p-2 text-right font-semibold ${Number(l.stock) === 0 ? "text-stone-300" : ""}`}>{fmtNum(l.stock)}</td>
                      <td className={`p-2 text-right text-amber-800 ${compDe(l) > 0 ? "cursor-help" : ""}`} onMouseEnter={(e) => mostrarTip(e, `Lote ${l.lote}`, detalleLote(l))} onMouseLeave={() => setTip(null)}>{compDe(l) > 0 ? fmtNum(compDe(l)) : "—"}</td>
                      <td className={`p-2 text-right ${Number(l.stock) - compDe(l) < 0 ? "text-red-600 font-semibold" : "text-emerald-800"}`}>{fmtNum(Number(l.stock) - compDe(l))}</td>
                      <td className="p-2 text-right hidden md:table-cell">{l.producto?.kg_por_unidad ? fmtNum(l.stock * l.producto.kg_por_unidad) : "—"}</td>
                      <td className="p-2 text-right md:whitespace-nowrap">
                        {!soloLectura && (
                          <button onClick={() => setAjuste({ loteId: l.id, delta: "", motivo: "" })} className="text-xs text-emerald-700 hover:underline mr-3">
                            Ajustar
                          </button>
                        )}
                        {profile.rol === "admin" && (
                          <label className="text-xs text-red-700 mr-3 cursor-pointer">
                            <input type="checkbox" className="mr-1 align-middle" checked={!!sel[l.id]} onChange={(e) => setSel({ ...sel, [l.id]: e.target.checked })} />
                            Eliminar
                          </label>
                        )}
                        {profile.rol === "admin" && (
                          <button onClick={() => setReasig({ loteId: l.id, productoId: "" })} className="text-xs text-emerald-700 hover:underline mr-3 inline-block align-middle text-left leading-tight">
                            Cambiar<br />producto
                          </button>
                        )}

                      </td>
                    </tr>
                    {ajuste && ajuste.loteId === l.id && (
                      <tr className="bg-amber-50">
                        <td colSpan={9} className="p-3">
                          <div className="flex gap-2 flex-wrap items-center">
                            <input value={ajuste.delta} onChange={(e) => setAjuste({ ...ajuste, delta: e.target.value.replace(",", ".") })} placeholder={puedeSumar ? "+/− unidades" : "− unidades (baja)"} className={`${inputCls} w-32`} />
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
                    {reasig && reasig.loteId === l.id && (
                      <tr className="bg-amber-50">
                        <td colSpan={9} className="p-3">
                          <div className="flex gap-2 flex-wrap items-center">
                            <span className="text-sm">Pasar el lote <b className="font-mono">{l.lote}</b> a:</span>
                            <select value={reasig.productoId} onChange={(e) => setReasig({ ...reasig, productoId: e.target.value })} className={`${inputCls} min-w-[280px]`}>
                              <option value="">Elegir producto…</option>
                              {productos.filter((p) => p.activo !== false).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {nombreConPresentacion(p.nombre, p.presentacion)}{p.kg_por_unidad ? ` · ${fmtNum(p.kg_por_unidad)} kg` : ""}
                                </option>
                              ))}
                            </select>
                            <button disabled={!reasig.productoId} onClick={aplicarReasignacion} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                              Reasignar
                            </button>
                            <button onClick={() => setReasig(null)} className="text-sm text-stone-500">
                              Cancelar
                            </button>
                          </div>
                          <div className="text-xs text-stone-500 mt-1">El lote conserva su stock y su historial; los remitos ya emitidos no cambian.</div>
                        </td>
                      </tr>
                    )}
                    {movs.loteId === l.id && (
                      <tr className="bg-stone-50">
                        <td colSpan={9} className="p-3">
                          <table className="w-full text-xs">
                            <tbody>
                              {movs.rows.map((m) => (
                                <tr key={m.id} className="border-b border-stone-100">
                                  <td className="py-1 pr-2 text-stone-400">{new Date(m.created_at).toLocaleString("es-AR")}</td>
                                  <td className="pr-2 uppercase">{String(m.tipo).replace("traslado_", "traslado ")}</td>
                                  <td className={`pr-2 text-right font-semibold ${m.cantidad < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtNum(m.cantidad)}</td>
                                  <td className="pr-2 text-right text-stone-500">→ {fmtNum(m.stock_resultante)}</td>
                                  <td className="pr-2">{m.remito ? `Remito ${m.remito.punto_venta}-${m.remito.numero}` : m.motivo || ""}</td>
                                  <td className="text-stone-400">{m.usuario_nombre}</td>
                                  <td className="pl-2 text-right">
                                    {profile.rol === "admin" && !m.remito_id && ["ingreso", "ajuste"].includes(m.tipo) && (
                                      <button onClick={() => eliminarMov(m, l.id)} className="text-red-700 hover:underline">Eliminar</button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {tip && (
        <div className="fixed z-50 bg-white border border-stone-300 rounded-lg shadow-lg p-3 text-[12.5px] max-w-[min(360px,calc(100vw-24px))]" style={{ top: Math.min(tip.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 40), left: Math.max(12, tip.x - 360) }} onClick={() => setTip(null)}>
          <div className="font-semibold text-stone-800 mb-1.5 break-words">Comprometido · {tip.titulo}</div>
          <div className="space-y-1">
            {tip.items.map((i, k) => (
              <div key={k} className="flex justify-between gap-4">
                <span className="min-w-0 break-words"><b className="font-mono">{i.orden}</b> · {i.cliente}{i.lote === "" ? <span className="text-amber-700"> (sin lote asignado)</span> : i.lote ? <span className="text-stone-400 font-mono"> · {i.lote}</span> : null}</span>
                <b className="whitespace-nowrap">{fmtNum(i.n)}</b>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-4 border-t border-stone-200 mt-2 pt-1.5 font-semibold"><span>Total</span><span>{fmtNum(tip.total)}</span></div>
        </div>
      )}
    </NavBar>
  );
}
