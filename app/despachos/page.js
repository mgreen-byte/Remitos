"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtNum, fmtFecha, friendlyError } from "@/lib/util";
import { cargarDespachos, traerTodo } from "@/lib/despachos";

export default function DespachosPage() {
  return <AuthGuard roles={["admin", "logistica", "consulta"]}>{(profile) => <DespachosInner profile={profile} />}</AuthGuard>;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoy = () => iso(new Date());
const PRESETS = [
  ["mes", "Este mes", () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; }],
  ["mesant", "Mes anterior", () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ["30", "Últimos 30 días", () => { const d = new Date(); const a = new Date(); a.setDate(a.getDate() - 29); return [iso(a), iso(d)]; }],
  ["anio", "Este año", () => { const d = new Date(); return [iso(new Date(d.getFullYear(), 0, 1)), iso(d)]; }],
];

const VERDE = "bg-emerald-600";
const CELESTE = "bg-sky-500";

function Kpi({ label, valor, sub, tono }) {
  return (
    <div className="panel p-4">
      <div className="text-[12px] text-stone-500 font-medium">{label}</div>
      <div className={`text-[26px] font-semibold leading-tight mt-1 ${tono || "text-emerald-800"}`}>{valor}</div>
      {sub && <div className="text-[12px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// Lista de barras horizontales: items = [{nombre, valor, extra, valor2}], valor2 = parte "traslado" (opcional).
function Barras({ items, unidad = "", vacio = "Sin datos en el período." }) {
  const max = Math.max(1, ...items.map((i) => i.valor + (i.valor2 || 0)));
  if (!items.length) return <div className="text-[13px] text-stone-400 py-2">{vacio}</div>;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.nombre}>
          <div className="flex justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 break-words">{i.nombre}</span>
            <span className="whitespace-nowrap text-stone-700"><b>{fmtNum(i.valor + (i.valor2 || 0))}</b>{unidad}{i.extra ? <span className="text-stone-400"> · {i.extra}</span> : null}</span>
          </div>
          <div className="h-2.5 bg-stone-100 rounded overflow-hidden flex">
            <div className={VERDE} style={{ width: `${(i.valor / max) * 100}%` }} />
            {i.valor2 > 0 && <div className={CELESTE} style={{ width: `${(i.valor2 / max) * 100}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function Seccion({ titulo, ayuda, children, className = "" }) {
  return (
    <section className={`panel p-4 md:p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="paso-titulo">{titulo}</h2>
        {ayuda && <span className="text-[12px] text-stone-400">{ayuda}</span>}
      </div>
      {children}
    </section>
  );
}

function DespachosInner({ profile }) {
  const [[desde, hasta], setRango] = useState(PRESETS[0][2]());
  const [preset, setPreset] = useState("mes");
  const [plantaId, setPlantaId] = useState("");
  const [plantas, setPlantas] = useState([]);
  const [filas, setFilas] = useState([]);
  const [lineas, setLineas] = useState([]); // renglones de órdenes de carga activas (hoy)
  const [ordenes, setOrdenes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("plantas").select("id, nombre").eq("activa", true).order("nombre").then(({ data }) => setPlantas(data || []));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const [f, ls, os] = await Promise.all([
        cargarDespachos(supabase, { desde, hasta, plantaId }),
        traerTodo(() => {
          let q = supabase.from("v_ordenes_lineas_saldo").select("id, orden_id, orden_numero, cliente, planta_id, cantidad, remitido, saldo, orden_estado, orden_modalidad").eq("orden_estado", "activa").neq("orden_modalidad", "traslado").order("id");
          if (plantaId) q = q.eq("planta_id", plantaId);
          return q;
        }),
        traerTodo(() => supabase.from("ordenes_carga").select("id, numero, fecha_carga, estado, modalidad").eq("estado", "activa").neq("modalidad", "traslado").order("id")),
      ]);
      setFilas(f); setLineas(ls); setOrdenes(os);
    } catch (e) {
      setError(friendlyError(e));
    }
    setCargando(false);
  }, [desde, hasta, plantaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const d = useMemo(() => {
    const cli = filas.filter((f) => f.tipo === "cliente");
    const tr = filas.filter((f) => f.tipo === "traslado");
    const sum = (a, k) => a.reduce((x, f) => x + f[k], 0);
    const remitos = (a) => new Set(a.map((f) => f.remitoId)).size;
    const top = (a, clave, n, extra) => {
      const m = new Map();
      for (const f of a) { const k = clave(f); const g = m.get(k) || { nombre: k, valor: 0, kg: 0, rem: new Set() }; g.valor += f.cantidad; g.kg += f.kg; g.rem.add(f.remitoId); m.set(k, g); }
      return [...m.values()].sort((x, y) => y.kg - x.kg || y.valor - x.valor).slice(0, n).map((g) => ({ nombre: g.nombre, valor: Math.round(g.kg), extra: `${fmtNum(g.valor)} u.${extra ? " · " + g.rem.size + " rem." : ""}` }));
    };
    // Serie por día (o por semana si el período es largo): clientes y traslados en unidades.
    const dias = Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1;
    const semanal = dias > 45;
    const clave = (fecha) => {
      if (!semanal) return fecha;
      const x = new Date(fecha + "T12:00:00"); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return iso(x);
    };
    const serie = new Map();
    for (const f of filas) { const k = clave(f.fecha); const g = serie.get(k) || { k, cli: 0, tr: 0 }; if (f.tipo === "cliente") g.cli += f.cantidad; else g.tr += f.cantidad; serie.set(k, g); }
    const serieArr = [...serie.values()].sort((a, b) => a.k.localeCompare(b.k));
    // Por planta de origen
    const pl = new Map();
    for (const f of filas) { const g = pl.get(f.planta) || { nombre: f.planta, valor: 0, valor2: 0 }; if (f.tipo === "cliente") g.valor += f.cantidad; else g.valor2 += f.cantidad; pl.set(f.planta, g); }
    const porPlanta = [...pl.values()].sort((a, b) => b.valor + b.valor2 - (a.valor + a.valor2));
    // Traslados origen → destino
    const rutas = new Map();
    for (const f of tr) { const k = `${f.planta} → ${f.destino}`; const g = rutas.get(k) || { nombre: k, valor: 0, kg: 0 }; g.valor += f.cantidad; g.kg += f.kg; rutas.set(k, g); }
    const rutasArr = [...rutas.values()].sort((a, b) => b.valor - a.valor).slice(0, 8).map((g) => ({ nombre: g.nombre, valor: 0, valor2: g.valor, extra: `${fmtNum(g.kg)} kg` }));
    // Órdenes activas (hoy)
    const pedido = lineas.reduce((a, l) => a + Number(l.cantidad), 0);
    const remitido = lineas.reduce((a, l) => a + Math.min(Number(l.remitido), Number(l.cantidad)), 0);
    const saldo = lineas.reduce((a, l) => a + Math.max(0, Number(l.saldo)), 0);
    const fechaDe = Object.fromEntries(ordenes.map((o) => [o.id, o.fecha_carga]));
    const porOrden = new Map();
    for (const l of lineas) { const g = porOrden.get(l.orden_id) || { numero: l.orden_numero, ped: 0, rem: 0, saldo: 0, fecha: fechaDe[l.orden_id] || null }; g.ped += Number(l.cantidad); g.rem += Math.min(Number(l.remitido), Number(l.cantidad)); g.saldo += Math.max(0, Number(l.saldo)); porOrden.set(l.orden_id, g); }
    const pend = [...porOrden.values()].filter((o) => o.saldo > 0);
    const vencidas = pend.filter((o) => o.fecha && o.fecha < hoy());
    const atrasadas = [...pend].sort((a, b) => String(a.fecha || "9999").localeCompare(String(b.fecha || "9999")) || b.saldo - a.saldo).slice(0, 8);
    return {
      cli, tr, uCli: sum(cli, "cantidad"), kgCli: sum(cli, "kg"), remCli: remitos(cli),
      clientes: new Set(cli.map((f) => f.cliente + f.cuit)).size,
      sinOrden: remitos(cli.filter((f) => !f.orden)), conOrden: remitos(cli.filter((f) => f.orden)),
      uTr: sum(tr, "cantidad"), kgTr: sum(tr, "kg"), remTr: remitos(tr),
      enTransito: sum(tr.filter((f) => f.estado === "en_transito"), "cantidad"),
      serie: serieArr, semanal, porPlanta, rutasArr,
      topClientes: top(cli, (f) => f.cliente, 10, true), topProductos: top(cli, (f) => f.producto, 10),
      pedido, remitido, saldo, cumpl: pedido ? Math.round((remitido / pedido) * 100) : null,
      nOrdenes: porOrden.size, pend: pend.length, vencidas: vencidas.length, atrasadas,
    };
  }, [filas, lineas, ordenes, desde, hasta]);

  const maxSerie = Math.max(1, ...d.serie.map((s) => s.cli + s.tr));
  const fechaCorta = (k) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : "");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  const inp = "border border-stone-300 rounded-md px-2.5 py-1.5 text-[13.5px] bg-white";
  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5 min-w-0">
        <div>
          <h1 className="text-[22px] font-semibold">Despachos</h1>
          <p className="text-[13px] text-stone-500 mt-1">Lo remitido a clientes (remitos no anulados ni rechazados). Los traslados entre plantas se muestran aparte.</p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(([k, t, f]) => (
              <button key={k} onClick={() => { setPreset(k); setRango(f()); }} className={`px-3 py-1.5 rounded-full text-[13px] border ${preset === k ? "bg-emerald-700 text-white border-emerald-700" : "border-stone-300 text-stone-700 bg-white hover:bg-stone-50"}`}>{t}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div><div className="text-[12px] text-stone-500 mb-1">Desde</div><input type="date" value={desde} onChange={(e) => { setPreset(""); setRango([e.target.value, hasta]); }} className={inp} /></div>
            <div><div className="text-[12px] text-stone-500 mb-1">Hasta</div><input type="date" value={hasta} onChange={(e) => { setPreset(""); setRango([desde, e.target.value]); }} className={inp} /></div>
            <div>
              <div className="text-[12px] text-stone-500 mb-1">Planta</div>
              <select value={plantaId} onChange={(e) => setPlantaId(e.target.value)} className={inp}>
                <option value="">Todas las plantas</option>
                {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <button onClick={cargar} disabled={cargando} className="btn-secundario">{cargando ? "Actualizando…" : "Actualizar"}</button>
          </div>
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Unidades a clientes" valor={fmtNum(d.uCli)} />
          <Kpi label="Kg a clientes" valor={fmtNum(d.kgCli)} />
          <Kpi label="Remitos" valor={fmtNum(d.remCli)} sub={d.remCli ? `${pct(d.conOrden, d.remCli)}% con orden de carga` : ""} />
          <Kpi label="Clientes atendidos" valor={fmtNum(d.clientes)} />
          <Kpi label="Kg por remito" valor={d.remCli ? fmtNum(Math.round(d.kgCli / d.remCli)) : "—"} sub="promedio" />
        </div>

        <Seccion titulo={d.semanal ? "Despacho por semana" : "Despacho por día"} ayuda="unidades">
          {d.serie.length === 0 ? (
            <div className="text-[13px] text-stone-400 py-2">{cargando ? "Cargando…" : "Sin despachos en el período."}</div>
          ) : (
            <>
              <div className="flex items-end gap-1 h-44 overflow-x-auto pb-1">
                {d.serie.map((s) => (
                  <div key={s.k} className="flex flex-col items-center justify-end h-full min-w-[22px] flex-1" title={`${fechaCorta(s.k)}: ${fmtNum(s.cli)} a clientes · ${fmtNum(s.tr)} traslados`}>
                    <div className="text-[10px] text-stone-500">{fmtNum(s.cli + s.tr)}</div>
                    <div className="w-full flex flex-col justify-end" style={{ height: `${((s.cli + s.tr) / maxSerie) * 100}%` }}>
                      {s.tr > 0 && <div className={CELESTE} style={{ height: `${(s.tr / (s.cli + s.tr)) * 100}%` }} />}
                      {s.cli > 0 && <div className={VERDE} style={{ height: `${(s.cli / (s.cli + s.tr)) * 100}%` }} />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 overflow-x-auto">
                {d.serie.map((s) => <div key={s.k} className="min-w-[22px] flex-1 text-[10px] text-stone-400 text-center">{fechaCorta(s.k)}</div>)}
              </div>
              <div className="flex gap-4 mt-2 text-[12px] text-stone-600">
                <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded-sm ${VERDE}`} /> A clientes</span>
                <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded-sm ${CELESTE}`} /> Traslados entre plantas</span>
              </div>
            </>
          )}
        </Seccion>

        <div className="grid gap-5 lg:grid-cols-2">
          <Seccion titulo="Top clientes" ayuda="kg · unidades">
            <Barras items={d.topClientes} unidad=" kg" />
          </Seccion>
          <Seccion titulo="Variedades más despachadas" ayuda="kg · unidades">
            <Barras items={d.topProductos} unidad=" kg" />
          </Seccion>
        </div>

        <Seccion titulo="Por planta de salida" ayuda="unidades · verde = clientes, celeste = traslados">
          <Barras items={d.porPlanta} unidad=" u." />
        </Seccion>

        <Seccion titulo="Traslados entre plantas" ayuda="aparte de las ventas, para dimensionarlos" className="border-t-sky-400">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
            <Kpi label="Remitos de traslado" valor={fmtNum(d.remTr)} tono="text-sky-700" />
            <Kpi label="Unidades" valor={fmtNum(d.uTr)} tono="text-sky-700" />
            <Kpi label="Kg" valor={fmtNum(d.kgTr)} tono="text-sky-700" />
            <Kpi label="Aún en tránsito" valor={fmtNum(d.enTransito)} sub="sin recibir por el destino" tono="text-amber-700" />
          </div>
          <Barras items={d.rutasArr} unidad=" u." vacio="Sin traslados en el período." />
          {d.uCli + d.uTr > 0 && <div className="text-[12.5px] text-stone-500 mt-3">Los traslados son el <b>{pct(d.uTr, d.uCli + d.uTr)}%</b> de las unidades que salieron de planta en el período.</div>}
        </Seccion>

        <Seccion titulo="Órdenes de carga activas (hoy)" ayuda="no depende del período">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
            <Kpi label="Cumplimiento" valor={d.cumpl === null ? "—" : `${d.cumpl}%`} sub={`${fmtNum(d.remitido)} de ${fmtNum(d.pedido)} u.`} />
            <Kpi label="Saldo pendiente" valor={fmtNum(d.saldo)} sub={`${d.pend} orden${d.pend === 1 ? "" : "es"} con saldo`} tono="text-amber-700" />
            <Kpi label="Órdenes activas" valor={fmtNum(d.nOrdenes)} />
            <Kpi label="Carga vencida" valor={fmtNum(d.vencidas)} sub="pasó la fecha prevista y tienen saldo" tono={d.vencidas ? "text-red-700" : "text-emerald-800"} />
          </div>
          <div className="text-[12.5px] font-medium text-stone-600 mb-2">Órdenes más atrasadas</div>
          {d.atrasadas.length === 0 ? (
            <div className="text-[13px] text-stone-400">No hay órdenes con saldo pendiente.</div>
          ) : (
            <div className="space-y-2.5">
              {d.atrasadas.map((o) => {
                const venc = o.fecha && o.fecha < hoy();
                return (
                  <div key={o.numero}>
                    <div className="flex justify-between gap-3 text-[12.5px] flex-wrap">
                      <span><b>{o.numero}</b>{o.fecha ? <span className={`ml-2 ${venc ? "text-red-700 font-medium" : "text-stone-500"}`}>{venc ? "Carga vencida " : "Carga prevista "}{fmtFecha(o.fecha)}</span> : <span className="ml-2 text-stone-400">sin fecha</span>}</span>
                      <span className="text-stone-700">{fmtNum(o.rem)} de {fmtNum(o.ped)} u. · saldo <b>{fmtNum(o.saldo)}</b></span>
                    </div>
                    <div className="h-2.5 bg-stone-100 rounded overflow-hidden"><div className={venc ? "bg-red-500 h-full" : "bg-emerald-600 h-full"} style={{ width: `${pct(o.rem, o.ped)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Seccion>
      </div>
    </NavBar>
  );
}
