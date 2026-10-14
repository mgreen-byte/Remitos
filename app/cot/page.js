"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, fmtMonto, friendlyError, cotAtrasado } from "@/lib/util";

const esBB = (p) => /big\s*-?\s*bag|\bbb\b/i.test(`${p?.presentacion || ""} ${p?.nombre || ""}`);
const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const numStr = (n) => (n === null || n === undefined ? "" : String(Math.round(Number(n) * 100) / 100).replace(".", ","));

export default function CotPage() {
  return <AuthGuard>{(profile) => <CotInner profile={profile} />}</AuthGuard>;
}

// Botón chico para copiar un dato al portapapeles (para pegarlo en ARBA).
function Copiar({ valor }) {
  const [ok, setOk] = useState(false);
  const texto = String(valor ?? "");
  if (!texto) return null;
  const copiar = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
    }
    setOk(true);
    setTimeout(() => setOk(false), 1200);
  };
  return (
    <button onClick={copiar} title="Copiar" className="no-print ml-1.5 text-[11px] text-emerald-700 hover:underline align-middle">
      {ok ? "¡copiado!" : "copiar"}
    </button>
  );
}

function CotInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const soloLectura = profile.rol === "consulta";
  const plantaId = profile.planta?.id || null;
  const sinPlanta = profile.rol === "operador" && !plantaId;

  const [pend, setPend] = useState([]);
  const [items, setItems] = useState({}); // remito_id -> items
  const [precios, setPrecios] = useState([]);
  const [cots, setCots] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [filtroPlanta, setFiltroPlanta] = useState("");
  const [sel, setSel] = useState(new Set());
  const [precioManual, setPrecioManual] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null); // {tipo, texto}
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    if (sinPlanta) return setCargando(false);
    setCargando(true);
    let q = supabase.from("v_cot_pendientes").select("*").order("fecha", { ascending: true }).order("numero", { ascending: true }).limit(500);
    if (profile.rol === "operador") q = q.eq("planta_id", plantaId);
    const { data: pv, error } = await q;
    if (error) {
      setMsg({ tipo: "error", texto: "No se pudieron leer los remitos pendientes. Probá de nuevo en un momento." });
    }
    const lista = pv || [];
    setPend(lista);
    const mapa = {};
    for (let i = 0; i < lista.length; i += 100) {
      const ids = lista.slice(i, i + 100).map((x) => x.remito_id);
      const { data } = await supabase
        .from("remito_items")
        .select("remito_id, orden, descripcion, cantidad, kg_unidad, kg_total, producto:productos(categoria, presentacion, nombre)")
        .in("remito_id", ids);
      (data || []).forEach((it) => (mapa[it.remito_id] = [...(mapa[it.remito_id] || []), it]));
    }
    setItems(mapa);
    const { data: pr } = await supabase.from("precios").select("*").eq("categoria", "soja").order("vigente_desde", { ascending: false });
    setPrecios(pr || []);
    let qc = supabase
      .from("cots")
      .select("*, planta:plantas(nombre), remitos(id, punto_venta, numero, estado, cliente_nombre, orden_carga, total_kgs)")
      .order("created_at", { ascending: false })
      .limit(60);
    if (profile.rol === "operador") qc = qc.eq("planta_id", plantaId);
    const { data: cs } = await qc;
    setCots(cs || []);
    if (profile.rol !== "operador") {
      const { data: pl } = await supabase.from("plantas").select("id, nombre").order("nombre");
      setPlantas(pl || []);
    }
    setSel(new Set());
    setCargando(false);
  }, [profile.rol, plantaId, sinPlanta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const precioPara = useCallback(
    (fecha) => {
      const m = Number(String(precioManual).replace(",", "."));
      if (m > 0) return m;
      const p = precios.find((x) => x.vigente_desde <= fecha);
      return p ? Number(p.precio_kg) : null;
    },
    [precios, precioManual]
  );

  // Datos de soja de un remito: Big Bag, otras unidades, kg y monto.
  const calc = useCallback(
    (r) => {
      const soja = (items[r.remito_id] || []).filter((i) => i.producto?.categoria === "soja");
      const bb = soja.filter((i) => esBB(i.producto)).reduce((a, i) => a + Number(i.cantidad), 0);
      const otras = soja.filter((i) => !esBB(i.producto)).reduce((a, i) => a + Number(i.cantidad), 0);
      const kg = soja.reduce((a, i) => a + Number(i.kg_total ?? Number(i.cantidad) * Number(i.kg_unidad || 0)), 0);
      const precio = precioPara(r.fecha);
      const monto = precio != null ? Math.round(kg * precio * 100) / 100 : null;
      return { bb, otras, kg, precio, monto };
    },
    [items, precioPara]
  );

  const visibles = useMemo(() => pend.filter((r) => !filtroPlanta || r.planta_id === filtroPlanta), [pend, filtroPlanta]);

  // Agrupa por planta + orden de carga. Los que no tienen orden de carga quedan en un grupo aparte.
  const grupos = useMemo(() => {
    const m = new Map();
    visibles.forEach((r) => {
      const oc = (r.orden_carga || "").trim();
      const k = `${r.planta_id}|${oc}`;
      if (!m.has(k)) m.set(k, { key: k, oc, planta: r.planta, planta_id: r.planta_id, rows: [] });
      m.get(k).rows.push(r);
    });
    return [...m.values()].sort((a, b) => (a.oc ? 0 : 1) - (b.oc ? 0 : 1) || a.rows[0].created_at.localeCompare(b.rows[0].created_at));
  }, [visibles]);

  const selRows = useMemo(() => pend.filter((r) => sel.has(r.remito_id)), [pend, sel]);
  const plantasSel = new Set(selRows.map((r) => r.planta_id));
  const mezcla = plantasSel.size > 1;

  const filasResumen = useMemo(() => selRows.map((r) => ({ r, c: calc(r) })), [selRows, calc]);
  const tot = useMemo(
    () => ({
      bb: filasResumen.reduce((a, x) => a + x.c.bb, 0),
      otras: filasResumen.reduce((a, x) => a + x.c.otras, 0),
      kg: filasResumen.reduce((a, x) => a + x.c.kg, 0),
      monto: filasResumen.reduce((a, x) => a + (x.c.monto || 0), 0),
      sinPrecio: filasResumen.some((x) => x.c.monto === null),
    }),
    [filasResumen]
  );
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const transp = {
    cuits: uniq(selRows.map((r) => digitos(r.transportista_cuit))),
    nombres: uniq(selRows.map((r) => r.transportista_nombre)),
    chasis: uniq(selRows.map((r) => r.chasis)),
    acoplado: uniq(selRows.map((r) => r.acoplado)),
    choferes: uniq(selRows.map((r) => r.chofer_nombre)),
    dnis: uniq(selRows.map((r) => digitos(r.chofer_cuil))),
  };

  const alternar = (id) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const alternarGrupo = (g) =>
    setSel((s) => {
      const n = new Set(s);
      const todos = g.rows.every((r) => n.has(r.remito_id));
      g.rows.forEach((r) => (todos ? n.delete(r.remito_id) : n.add(r.remito_id)));
      return n;
    });

  const asignar = async () => {
    setMsg(null);
    if (!selRows.length) return setMsg({ tipo: "error", texto: "Tildá al menos un remito." });
    if (mezcla) return setMsg({ tipo: "error", texto: "Un COT solo puede juntar remitos de una misma planta." });
    if (codigo.trim().length < 3) return setMsg({ tipo: "error", texto: "Cargá el código de COT que te dio ARBA." });
    setGuardando(true);
    const detalle = filasResumen.map(({ r, c }) => ({ remito_id: r.remito_id, remito: `${r.punto_venta}-${r.numero}`, bb: c.bb, kg: c.kg, precio: c.precio, monto: c.monto ?? 0 }));
    const precios1 = uniq(filasResumen.map((x) => x.c.precio));
    const { error } = await supabase.rpc("asignar_cot", {
      p_remitos: selRows.map((r) => r.remito_id),
      p_codigo: codigo.trim(),
      p_precio_kg: precios1.length === 1 ? precios1[0] : null,
      p_detalle: detalle,
    });
    setGuardando(false);
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: `COT ${codigo.trim().toUpperCase()} cargado en ${selRows.length} ${selRows.length === 1 ? "remito" : "remitos"}.` });
    setCodigo("");
    setPrecioManual("");
    cargar();
  };

  const corregir = async (c) => {
    const nuevo = prompt("Código de COT correcto:", c.codigo);
    if (nuevo === null || nuevo.trim() === c.codigo) return;
    const { error } = await supabase.rpc("corregir_cot", { p_cot_id: c.id, p_codigo: nuevo.trim() });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: "Código corregido en todos los remitos del COT." });
    cargar();
  };
  const quitar = async (r) => {
    if (!confirm(`¿Sacar el remito ${r.punto_venta}-${r.numero} de este COT? Vuelve a quedar como COT pendiente.`)) return;
    const { error } = await supabase.rpc("quitar_remito_de_cot", { p_remito_id: r.id });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    setMsg({ tipo: "ok", texto: "Remito sacado del COT." });
    cargar();
  };

  const exportar = () => {
    const filas = filasResumen.map(({ r, c }) => ({
      Remito: `${r.punto_venta}-${r.numero}`,
      Fecha: fmtFecha(r.fecha),
      "Orden de carga": r.orden_carga || "",
      Destinatario: r.cliente_nombre || "",
      "CUIT destino": digitos(r.cliente_cuit),
      "Domicilio / localidad destino": r.cliente_domicilio || "",
      Provincia: r.cliente_provincia || "",
      "Big Bag": c.bb,
      "Kg": Math.round(c.kg * 1000) / 1000,
      "Precio por kg": c.precio ?? "",
      Monto: c.monto ?? "",
    }));
    filas.push({ Remito: "TOTAL", "Big Bag": tot.bb, Kg: Math.round(tot.kg * 1000) / 1000, Monto: Math.round(tot.monto * 100) / 100 });
    filas.push({});
    filas.push({ Remito: "CUIT transporte", Destinatario: transp.cuits.join(" / ") });
    filas.push({ Remito: "Transportista", Destinatario: transp.nombres.join(" / ") });
    filas.push({ Remito: "Patente chasis", Destinatario: transp.chasis.join(" / ") });
    filas.push({ Remito: "Patente acoplado", Destinatario: transp.acoplado.join(" / ") });
    filas.push({ Remito: "Chofer", Destinatario: transp.choferes.join(" / ") });
    filas.push({ Remito: "DNI / CUIL chofer", Destinatario: transp.dnis.join(" / ") });
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [{ wch: 18 }, { wch: 11 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 44 }, { wch: 18 }, { wch: 9 }, { wch: 12 }, { wch: 13 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen COT");
    XLSX.writeFile(wb, `resumen_cot_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const th = "text-left px-2 py-1.5 font-medium";
  const precioUsado = uniq(filasResumen.map((x) => x.c.precio));

  if (sinPlanta)
    return (
      <NavBar profile={profile}>
        <div className="max-w-3xl mx-auto p-6 text-sm text-stone-600">Tu usuario no tiene planta asignada. Pedile al administrador que te la asigne.</div>
      </NavBar>
    );

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <div className="no-print">
          <h1 className="text-[22px] font-semibold">COT</h1>
          <p className="text-[13px] text-stone-500 mt-1">
            Remitos de soja con destino o planta en la provincia de Buenos Aires que todavía no tienen COT. Tildá los que viajan en el mismo camión, copiá los datos a ARBA y cargá acá el código que te da.
          </p>
        </div>

        {msg && (
          <div className={`no-print text-[13.5px] rounded-lg border px-4 py-3 ${msg.tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>{msg.texto}</div>
        )}

        {/* ---------- Pendientes ---------- */}
        <section className="space-y-3 no-print">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="paso-titulo">COT pendientes</h2>
            <span className="text-[13px] text-stone-500">{cargando ? "Cargando…" : `${pend.length} ${pend.length === 1 ? "remito" : "remitos"}`}</span>
            {!esAdmin && !soloLectura ? null : (
              <select value={filtroPlanta} onChange={(e) => setFiltroPlanta(e.target.value)} className="ml-auto border border-stone-300 rounded px-2 py-1.5 text-sm">
                <option value="">Todas las plantas</option>
                {plantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!cargando && !grupos.length && <div className="panel p-5 text-sm text-stone-500">No hay remitos con COT pendiente. 🎉</div>}

          {grupos.map((g) => {
            const todos = g.rows.every((r) => sel.has(r.remito_id));
            const kgG = g.rows.reduce((a, r) => a + calc(r).kg, 0);
            const bbG = g.rows.reduce((a, r) => a + calc(r).bb, 0);
            return (
              <div key={g.key} className="panel overflow-hidden">
                <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center gap-3 flex-wrap text-[13px]">
                  {!soloLectura && <input type="checkbox" checked={todos} onChange={() => alternarGrupo(g)} className="accent-emerald-700 w-4 h-4" aria-label="Elegir todo el grupo" />}
                  <span className="font-semibold">{g.oc ? `Orden de carga ${g.oc}` : "Sin orden de carga"}</span>
                  {(esAdmin || soloLectura) && <span className="text-stone-500">· {g.planta}</span>}
                  <span className="ml-auto text-stone-500">
                    {g.rows.length} {g.rows.length === 1 ? "remito" : "remitos"} · {fmtNum(bbG)} BB · {fmtNum(kgG)} kg
                  </span>
                </div>
                <table className="w-full text-[13px]">
                  <tbody>
                    {g.rows.map((r) => {
                      const c = calc(r);
                      return (
                        <tr key={r.remito_id} onClick={() => !soloLectura && alternar(r.remito_id)} className={`border-t border-stone-100 ${soloLectura ? "" : "cursor-pointer hover:bg-stone-50"} ${sel.has(r.remito_id) ? "bg-emerald-50/60" : ""}`}>
                          {!soloLectura && (
                            <td className="pl-4 py-1.5 w-8">
                              <input type="checkbox" checked={sel.has(r.remito_id)} onChange={() => alternar(r.remito_id)} onClick={(e) => e.stopPropagation()} className="accent-emerald-700 w-4 h-4" />
                            </td>
                          )}
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                            {r.punto_venta}-{r.numero}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {fmtFecha(r.fecha)}
                            {cotAtrasado(r.created_at) && <span className="ml-1.5 text-[11px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">+1 día</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.tipo === "traslado" ? <span className="text-[11px] font-medium text-sky-700 bg-sky-50 rounded px-1.5 py-0.5 mr-1.5">TRASLADO</span> : null}
                            {r.cliente_nombre}
                            <span className="text-stone-400"> · {r.cliente_provincia || "—"}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtNum(c.bb)} BB</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtNum(c.kg)} kg</td>
                          <td className="px-4 py-1.5 text-right whitespace-nowrap">{fmtMonto(c.monto)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        {/* ---------- Resumen para COT ---------- */}
        {!soloLectura && selRows.length > 0 && (
          <section className="panel p-5 space-y-4 print-reset">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="paso-titulo">Resumen para COT</h2>
              <span className="text-[13px] text-stone-500">
                {selRows.length} {selRows.length === 1 ? "remito" : "remitos"} · planta {[...new Set(selRows.map((r) => r.planta))].join(", ")}
              </span>
              <div className="no-print ml-auto flex gap-2">
                <button onClick={exportar} className="btn-secundario">Excel</button>
                <button onClick={() => window.print()} className="btn-secundario">Imprimir</button>
              </div>
            </div>

            {mezcla && <div className="no-print text-[13px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">Elegiste remitos de plantas distintas. Un COT solo puede juntar remitos de una misma planta: destildá los que no corresponden.</div>}

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-stone-500 bg-stone-50">
                  <tr>
                    <th className={th}>Remito</th>
                    <th className={th}>CUIT destino</th>
                    <th className={th}>Localidad / domicilio destino</th>
                    <th className={th}>Provincia</th>
                    <th className={`${th} text-right`}>Big Bag</th>
                    <th className={`${th} text-right`}>Kg</th>
                    <th className={`${th} text-right`}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {filasResumen.map(({ r, c }) => (
                    <tr key={r.remito_id} className="border-t border-stone-100 align-top">
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.punto_venta}-{r.numero}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {digitos(r.cliente_cuit) || "—"}
                        <Copiar valor={digitos(r.cliente_cuit)} />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.cliente_domicilio || "—"}
                        <Copiar valor={r.cliente_domicilio} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.cliente_provincia || "—"}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {fmtNum(c.bb)}
                        <Copiar valor={c.bb} />
                        {c.otras > 0 && <div className="text-[11px] text-amber-700">+ {fmtNum(c.otras)} u. de otro envase</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {fmtNum(c.kg)}
                        <Copiar valor={Math.round(c.kg * 1000) / 1000} />
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {c.monto === null ? <span className="text-red-600">sin precio</span> : fmtMonto(c.monto)}
                        {c.monto !== null && <Copiar valor={numStr(c.monto)} />}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-stone-300 font-semibold">
                    <td className="px-2 py-2" colSpan={4}>TOTAL</td>
                    <td className="px-2 py-2 text-right">{fmtNum(tot.bb)}</td>
                    <td className="px-2 py-2 text-right">{fmtNum(tot.kg)}</td>
                    <td className="px-2 py-2 text-right">{fmtMonto(tot.monto)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2 text-[13px]">
              {[
                ["CUIT transporte", transp.cuits],
                ["Transportista", transp.nombres],
                ["Patente chasis", transp.chasis],
                ["Patente acoplado", transp.acoplado],
                ["Chofer", transp.choferes],
                ["DNI / CUIL chofer", transp.dnis],
              ].map(([lbl, vals]) => (
                <div key={lbl} className="flex gap-2 border-b border-stone-100 py-1">
                  <span className="text-stone-500 w-36 flex-shrink-0">{lbl}</span>
                  <span className="font-medium">
                    {vals.length ? vals.join(" / ") : "—"}
                    {vals.length > 0 && <Copiar valor={vals[0]} />}
                  </span>
                </div>
              ))}
            </div>
            {(transp.cuits.length > 1 || transp.chasis.length > 1) && (
              <div className="no-print text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">Los remitos elegidos tienen distinto transporte o patente. Verificá que realmente viajen en el mismo camión.</div>
            )}

            <div className="no-print border-t border-stone-200 pt-4 flex items-end gap-3 flex-wrap">
              <label className="text-[12px] text-stone-500">
                Precio por kg ($) {precioUsado.length === 1 && Number(String(precioManual).replace(",", ".")) <= 0 ? "· vigente" : ""}
                <input
                  value={precioManual}
                  onChange={(e) => setPrecioManual(e.target.value)}
                  inputMode="decimal"
                  placeholder={precioUsado.length === 1 ? numStr(precioUsado[0]) : "según fecha"}
                  className="block border border-stone-300 rounded px-2 py-1.5 text-sm w-36"
                />
              </label>
              <label className="text-[12px] text-stone-500 flex-1 min-w-[220px] max-w-sm">
                Código de COT (el que te da ARBA)
                <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} className="block w-full border border-stone-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <button onClick={asignar} disabled={guardando || mezcla} className="btn-primario">
                {guardando ? "Guardando…" : `Asignar COT a ${selRows.length} ${selRows.length === 1 ? "remito" : "remitos"}`}
              </button>
            </div>
            {tot.sinPrecio && (
              <div className="no-print text-[12.5px] text-red-700">No hay precio de soja vigente para alguna fecha. Cargalo en Administración → Precios o escribilo acá arriba.</div>
            )}
          </section>
        )}

        {/* ---------- COT cargados ---------- */}
        <section className="space-y-3 no-print">
          <h2 className="paso-titulo">COT cargados</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-stone-500 bg-stone-50">
                <tr>
                  <th className={`${th} pl-4`}>COT</th>
                  <th className={th}>Planta</th>
                  <th className={th}>Cargado</th>
                  <th className={th}>Remitos</th>
                  <th className={`${th} text-right`}>Monto</th>
                  <th className={th}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {!cots.length && (
                  <tr>
                    <td colSpan={6} className="p-5 text-center text-stone-400">
                      Todavía no hay COT cargados.
                    </td>
                  </tr>
                )}
                {cots.map((c) => {
                  const rs = [...(c.remitos || [])].sort((a, b) => a.numero.localeCompare(b.numero));
                  const vivos = rs.filter((r) => r.estado !== "anulado" && r.estado !== "rechazado");
                  return (
                    <Fragment key={c.id}>
                      <tr onClick={() => setAbierto(abierto === c.id ? null : c.id)} className="border-t border-stone-100 cursor-pointer hover:bg-stone-50">
                        <td className="pl-4 py-2 font-mono font-semibold">{c.codigo}</td>
                        <td className="px-2 py-2">{c.planta?.nombre}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{new Date(c.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td className="px-2 py-2">{vivos.length} {vivos.length === 1 ? "remito" : "remitos"}</td>
                        <td className="px-2 py-2 text-right">{c.monto_total != null ? fmtMonto(c.monto_total) : "—"}</td>
                        <td className="px-2 py-2 text-stone-500">{c.usuario_nombre}</td>
                      </tr>
                      {abierto === c.id && (
                        <tr className="bg-stone-50">
                          <td colSpan={6} className="px-4 py-3 space-y-2">
                            {rs.map((r) => (
                              <div key={r.id} className="flex items-center gap-3 text-[13px]">
                                <span className="font-mono">{r.punto_venta}-{r.numero}</span>
                                <span className="text-stone-600">{r.cliente_nombre}</span>
                                {r.orden_carga && <span className="text-stone-400">OC {r.orden_carga}</span>}
                                {(r.estado === "anulado" || r.estado === "rechazado") && <span className="text-[11px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">{r.estado} · fuera del grupo</span>}
                                {!soloLectura && (
                                  <button onClick={() => quitar(r)} className="ml-auto text-[12px] text-red-600 hover:underline">
                                    Sacar del COT
                                  </button>
                                )}
                              </div>
                            ))}
                            {!soloLectura && (
                              <button onClick={() => corregir(c)} className="text-[12.5px] text-emerald-700 hover:underline">
                                Corregir el código
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </NavBar>
  );
}
