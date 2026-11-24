"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError } from "@/lib/util";
import { coordsDe, kmTramos, linkRecorrido, urlMaps } from "@/lib/rutas";
import { TIPOS_UNIDAD, armarPedido, textoPedido, descargarPedidoPdf, domPlanta, ordenarRecorrido, faltaCargar } from "@/lib/pedidoUnidad";

const EMPRESA_NOMBRE = { ms: "MS Technologies", stine: "Stine Seed" };
const fmt = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });

// Pedido de unidad al transporte (solo administrador): depósitos de carga (uno o varios),
// paradas de descarga (clientes agrupados por ubicación), km de todo el recorrido.
export default function PedidoUnidad({ orden, lineas, plantas, productos, onCerrar }) {
  const base = useMemo(() => armarPedido(lineas, productos), [lineas, productos]);
  const { paradas, pendiente } = base;
  const [tipo, setTipo] = useState(orden.tipo_unidad || "");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState("");
  // Plantas leídas de nuevo al abrir (contacto, horario y ubicación al día)
  const [frescas, setFrescas] = useState({});
  const idsDep = base.depositos.map((d) => d.planta_id).join(",");
  useEffect(() => {
    const ids = base.depositos.map((d) => d.planta_id).filter(Boolean);
    if (!ids.length) return;
    supabase.from("plantas").select("*").in("id", ids).then(({ data }) => setFrescas(Object.fromEntries((data || []).map((p) => [p.id, p]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsDep]);
  const plantaDe = (id) => frescas[id] || plantas.find((p) => p.id === id) || null;

  // Coordenadas de depósitos y paradas
  const [cd, setCd] = useState(null); // { dep: {planta_id: coords}, par: [coords] }
  useEffect(() => {
    let vivo = true;
    (async () => {
      const dep = {};
      for (const d of base.depositos) dep[d.planta_id] = await coordsDe(plantaDe(d.planta_id)?.gps);
      const par = await Promise.all(paradas.map((p) => coordsDe(p.gps)));
      if (vivo) setCd({ dep, par });
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsDep, Object.keys(frescas).length, paradas.length]);

  // Recorrido: cargas y descargas intercaladas. Automático (respeta el orden de descarga de la orden y
  // carga cada depósito antes de la primera descarga que lo necesita, con la menor distancia) o a mano (↑↓).
  const [manual, setManual] = useState(null);
  const auto = useMemo(() => ordenarRecorrido(base.depositos, paradas, cd), [cd, idsDep, paradas]);
  const claves = manual || auto;
  const depDe = (id) => ({ ...base.depositos.find((d) => d.planta_id === id), planta: plantaDe(id) });
  const faltas = faltaCargar(claves, paradas);
  const mover = (i, delta) => {
    const o = [...claves];
    const j = i + delta;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setManual(o);
  };
  const ptDe = (k) => (k[0] === "d" ? cd?.dep?.[k.slice(2)] : cd?.par?.[Number(k.slice(2))]);

  // Km de cada tramo del recorrido. Puntos sin ubicación no entran.
  const [km, setKm] = useState({ tramo: [], total: null, estimado: false, faltan: 0, cargando: true });
  const [recorrido, setRecorrido] = useState("");
  const firmaRuta = claves.join(",") + "|" + (cd ? "ok" : "");
  useEffect(() => {
    if (!cd) return;
    let vivo = true;
    (async () => {
      const pts = []; const ref = [];
      claves.forEach((k, i) => { const c = ptDe(k); if (c) { pts.push(c); ref.push(i); } });
      const faltan = claves.length - pts.length;
      if (pts.length < 2) { if (vivo) { setKm({ tramo: [], total: null, estimado: false, faltan, cargando: false }); setRecorrido(""); } return; }
      const r = await kmTramos(pts);
      if (!vivo) return;
      const tramo = claves.map(() => null);
      ref.forEach((i, k) => { if (k > 0) tramo[i] = r.tramos[k - 1]; });
      setKm({ tramo, total: r.tramos.reduce((a, b) => a + b, 0), estimado: r.estimado, faltan, cargando: false });
      setRecorrido(linkRecorrido(pts));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaRuta]);

  // Para qué clientes es cada carga (se muestra si hay más de un depósito)
  const paraDe = (id) => [...new Set(paradas.flatMap((pa) => pa.clientes.filter((c) => c.items.some((it) => it.planta_id === id)).map((c) => c.cliente)))];
  const pasos = claves.map((k, i) => (k[0] === "d"
    ? { tipo: "carga", clave: k, dep: depDe(k.slice(2)), km: km.tramo[i], para: paraDe(k.slice(2)) }
    : { tipo: "descarga", clave: k, pa: paradas[Number(k.slice(2))], km: km.tramo[i] }));
  const depositos = base.depositos.map((d) => depDe(d.planta_id));
  const totU = paradas.reduce((a, p) => a + p.unidades, 0);
  const totKg = paradas.reduce((a, p) => a + p.kg, 0);
  const empresa = plantaDe(claves.find((k) => k[0] === "d")?.slice(2))?.empresa;
  const datos = { orden, depositos, paradas, pasos, km, recorrido, tipoUnidad: tipo, obs, totU, totKg, empresa, empresaNombre: EMPRESA_NOMBRE[empresa] };

  const guardarTipo = async (v) => {
    setTipo(v);
    const { error } = await supabase.rpc("fijar_tipo_unidad", { p_orden: orden.id, p_tipo: v });
    if (error) setMsg(friendlyError(error));
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoPedido(datos)); setMsg("Texto copiado: pegalo en WhatsApp o en el mail."); }
    catch { setMsg("No se pudo copiar automáticamente. Usá el PDF."); }
  };

  const lab = "block text-[12px] text-stone-500 mb-1";
  const inp = "border border-stone-300 rounded-md px-2.5 py-1.5 text-[13.5px] bg-white w-full";
  const kmTxt = (v) => (km.cargando ? "…" : v != null ? `${fmt(v)} km` : "—");
  return (
    <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/50 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[15px] font-semibold text-stone-800">Pedido de unidad · {orden.numero}</div>
        <button onClick={onCerrar} className="ml-auto text-[13px] text-stone-500 underline">Cerrar</button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className={lab}>Tipo de unidad</label>
          <select value={tipo} onChange={(e) => guardarTipo(e.target.value)} className={inp}>
            <option value="">A definir</option>
            {tipo && !TIPOS_UNIDAD.includes(tipo) && <option value={tipo}>{tipo}</option>}
            {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lab}>Observaciones para el transporte (opcional, no se guardan)</label>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: llevar lona, cargar a primera hora…" className={inp} />
        </div>
      </div>

      <div className="rounded border border-stone-200 bg-white p-3 text-[13px] flex flex-wrap gap-x-6 gap-y-1">
        <div>Fecha de carga: <b>{orden.fecha_carga ? String(orden.fecha_carga).slice(0, 10).split("-").reverse().join("/") : "—"}</b></div>
        <div>Carga: <b>{fmt(totU)} u. · {fmt(totKg)} kg</b>{!pendiente && <span className="text-stone-500"> (ya remitida: se muestra lo pedido)</span>}</div>
        <div>Kms: {km.cargando ? <span className="text-stone-500">calculando…</span> : km.total != null ? <b>{fmt(km.total)} km{km.estimado ? " (estimado)" : ""}</b> : "—"}</div>
        {recorrido && <a href={recorrido} target="_blank" rel="noreferrer" className="text-sky-700 underline">Ver recorrido en Google Maps</a>}
        {km.estimado && <div className="basis-full text-[12px] text-amber-700">No respondió el servicio de rutas: es una estimación en línea recta + 30%.</div>}
        {km.faltan > 0 && !km.cargando && <div className="basis-full text-[12px] text-amber-700">{km.faltan} punto(s) sin ubicación de Maps: no entran en el cálculo.</div>}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-stone-500 font-semibold mb-1">
          Recorrido, en este orden
          <span className="normal-case font-normal"> · {manual ? "orden elegido a mano" : depositos.length > 1 ? "automático: cada depósito se carga antes de la primera descarga que lo necesita, por el camino más corto" : "automático"}</span>
          {manual && <button onClick={() => setManual(null)} className="ml-2 normal-case font-normal text-sky-700 underline">volver al automático</button>}
        </div>
        <div className="space-y-2">
          {pasos.map((x, i) => {
            const flechas = (
              <span className="flex gap-1">
                <button disabled={i === 0} onClick={() => mover(i, -1)} title="Antes" className="px-1.5 rounded border border-stone-300 bg-white disabled:opacity-30">↑</button>
                <button disabled={i === pasos.length - 1} onClick={() => mover(i, 1)} title="Después" className="px-1.5 rounded border border-stone-300 bg-white disabled:opacity-30">↓</button>
              </span>
            );
            if (x.tipo === "carga") {
              const pl = x.dep.planta || {};
              return (
                <div key={x.clave} className="rounded border border-sky-200 bg-sky-50/60 p-3 text-[13px] space-y-0.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white text-[11px] font-semibold">{i + 1}</span>
                    <div className="font-medium flex-1"><span className="text-sky-800">CARGA</span> · {pl.nombre || x.dep.nombre}</div>
                    {i > 0 && <span className="text-[12px] text-emerald-800 bg-emerald-50 rounded-full px-2">{kmTxt(x.km)}</span>}
                    {pasos.length > 2 && flechas}
                  </div>
                  <div className="text-stone-600">{domPlanta(pl) || "Sin domicilio"}</div>
                  {pl.gps ? <a href={urlMaps(pl.gps)} target="_blank" rel="noreferrer" className="text-sky-700 underline">Ubicación en Maps</a> : <div className="text-red-700">Sin ubicación de Maps (Administración → Plantas)</div>}
                  <div>Contacto: {[pl.contacto_nombre, pl.contacto_telefono].filter(Boolean).join(" · ") || <span className="text-amber-700">sin cargar</span>} · Horario: {pl.horario_atencion || <span className="text-amber-700">sin cargar</span>}</div>
                  <div className="font-medium">Se carga: {fmt(x.dep.unidades)} u. · {fmt(x.dep.kg)} kg{depositos.length > 1 && x.para.length ? <span className="font-normal text-stone-500"> · para {x.para.join(", ")}</span> : null}</div>
                </div>
              );
            }
            const pa = x.pa;
            const falta = faltas[x.clave];
            return (
              <div key={x.clave} className={`rounded border bg-white text-[13px] ${falta ? "border-red-300" : "border-stone-200"}`}>
                <div className="p-3 flex items-start gap-2">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold">{i + 1}</span>
                  <div className="flex-1">
                    <div className="font-medium"><span className="text-emerald-800">DESCARGA</span> · {[pa.localidad, pa.provincia].filter(Boolean).join(", ") || pa.domicilio}</div>
                    <div className="text-stone-500 text-[12px]">{pa.domicilio}</div>
                    {pa.contactos.length ? <div className="text-[12px]">Contacto: {pa.contactos.join(" / ")}</div> : <div className="text-[12px] text-amber-700">sin contacto</div>}
                    {!pa.gps && <div className="text-[12px] text-red-700">sin ubicación</div>}
                    {falta && <div className="text-[12px] text-red-700 font-medium">Antes hay que cargar en {falta.map((id) => depDe(id).planta?.nombre || "otro depósito").join(" y ")}.</div>}
                  </div>
                  {i > 0 && <span className="text-[12px] text-emerald-800 bg-emerald-50 rounded-full px-2">{kmTxt(x.km)}</span>}
                  {pasos.length > 2 && flechas}
                </div>
                <div className="overflow-x-auto border-t border-stone-100">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-stone-50 text-[11.5px] text-stone-500">
                      <tr><th className="p-1.5 pl-3 text-left">Cliente</th><th className="p-1.5 text-left">Material / Variedad · lote</th><th className="p-1.5 text-left">O/V</th>{depositos.length > 1 && <th className="p-1.5 text-left">Cargado en</th>}<th className="p-1.5 text-right">Cant.</th><th className="p-1.5 pr-3 text-right">Kg</th></tr>
                    </thead>
                    <tbody>
                      {pa.clientes.flatMap((c) => c.items.map((it, k) => (
                        <tr key={c.cliente + k} className="border-t border-stone-100">
                          <td className="p-1.5 pl-3 font-medium">{k === 0 ? c.cliente : ""}</td>
                          <td className="p-1.5">{it.producto}{it.lote ? <span className="text-stone-500"> · {it.lote}</span> : ""}</td>
                          <td className="p-1.5">{it.ov}</td>
                          {depositos.length > 1 && <td className="p-1.5">{it.cargaEn}</td>}
                          <td className="p-1.5 text-right">{fmt(it.cantidad)}</td>
                          <td className="p-1.5 pr-3 text-right">{it.kg ? fmt(it.kg) : "—"}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-[12px] text-stone-500 mt-1">Las descargas siguen el orden de la orden de carga (la primera es el último renglón). Los clientes con la misma ubicación de Maps se agrupan en una sola descarga.</div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button disabled={km.cargando} onClick={() => descargarPedidoPdf(datos)} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Descargar PDF</button>
        <button disabled={km.cargando} onClick={copiar} className="border border-stone-300 bg-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Copiar texto (WhatsApp / mail)</button>
        {msg && <span className="text-[13px] text-stone-600">{msg}</span>}
      </div>
    </div>
  );
}
