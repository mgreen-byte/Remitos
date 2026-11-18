"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError } from "@/lib/util";
import { coordsDe, kmTramos, kmRecta, linkRecorrido, urlMaps } from "@/lib/rutas";
import { TIPOS_UNIDAD, armarPedido, textoPedido, descargarPedidoPdf, domPlanta } from "@/lib/pedidoUnidad";

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

  // Orden de los depósitos: automático (el más lejano a la primera descarga primero) o el que elija el usuario.
  const [ordenManual, setOrdenManual] = useState(null);
  const ordenAuto = useMemo(() => {
    const ids = base.depositos.map((d) => d.planta_id);
    const destino = cd?.par.find(Boolean);
    if (!cd || !destino) return ids;
    return [...ids].sort((a, b) => (cd.dep[b] ? kmRecta(cd.dep[b], destino) : -1) - (cd.dep[a] ? kmRecta(cd.dep[a], destino) : -1));
  }, [cd, idsDep]);
  const ordenDep = ordenManual || ordenAuto;
  const depositos = ordenDep.map((id) => ({ ...base.depositos.find((d) => d.planta_id === id), planta: plantaDe(id) }));
  const mover = (i, delta) => {
    const o = [...ordenDep];
    const j = i + delta;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrdenManual(o);
  };

  // Km: depósitos (en orden) → paradas (en orden de descarga). Puntos sin ubicación no entran.
  const [km, setKm] = useState({ dep: [], par: [], total: null, estimado: false, faltan: 0, cargando: true });
  const [recorrido, setRecorrido] = useState("");
  const firmaRuta = ordenDep.join(",") + "|" + (cd ? "ok" : "");
  useEffect(() => {
    if (!cd) return;
    let vivo = true;
    (async () => {
      const pts = []; const ref = [];
      ordenDep.forEach((id, i) => { if (cd.dep[id]) { pts.push(cd.dep[id]); ref.push(["dep", i]); } });
      cd.par.forEach((c, i) => { if (c) { pts.push(c); ref.push(["par", i]); } });
      const faltan = ordenDep.filter((id) => !cd.dep[id]).length + cd.par.filter((c) => !c).length;
      if (pts.length < 2) { if (vivo) { setKm({ dep: [], par: [], total: null, estimado: false, faltan, cargando: false }); setRecorrido(""); } return; }
      const r = await kmTramos(pts);
      if (!vivo) return;
      const dep = ordenDep.map(() => null), par = cd.par.map(() => null);
      ref.forEach(([t, i], k) => { if (k > 0) (t === "dep" ? dep : par)[i] = r.tramos[k - 1]; });
      setKm({ dep, par, total: r.tramos.reduce((a, b) => a + b, 0), estimado: r.estimado, faltan, cargando: false });
      setRecorrido(linkRecorrido(pts));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaRuta]);

  const totU = paradas.reduce((a, p) => a + p.unidades, 0);
  const totKg = paradas.reduce((a, p) => a + p.kg, 0);
  const empresa = plantaDe(ordenDep[0])?.empresa;
  const datos = { orden, depositos, paradas, km, recorrido, tipoUnidad: tipo, obs, totU, totKg, empresa, empresaNombre: EMPRESA_NOMBRE[empresa] };

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
          {depositos.length > 1 ? "Depósitos de carga, en este orden" : "Depósito de carga"}
          {depositos.length > 1 && <span className="normal-case font-normal"> · {ordenManual ? "orden elegido a mano" : "orden automático: el más lejano a la descarga primero"}</span>}
          {ordenManual && <button onClick={() => setOrdenManual(null)} className="ml-2 normal-case font-normal text-sky-700 underline">volver al automático</button>}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {depositos.map((d, i) => {
            const pl = d.planta || {};
            return (
              <div key={d.planta_id} className="rounded border border-stone-200 bg-white p-3 text-[13px] space-y-0.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white text-[11px] font-semibold">{i + 1}</span>
                  <div className="font-medium flex-1">{pl.nombre || d.nombre}</div>
                  {i > 0 && <span className="text-[12px] text-emerald-800 bg-emerald-50 rounded-full px-2">{kmTxt(km.dep[i])}</span>}
                  {depositos.length > 1 && (
                    <span className="flex gap-1">
                      <button disabled={i === 0} onClick={() => mover(i, -1)} title="Cargar antes" className="px-1.5 rounded border border-stone-300 disabled:opacity-30">↑</button>
                      <button disabled={i === depositos.length - 1} onClick={() => mover(i, 1)} title="Cargar después" className="px-1.5 rounded border border-stone-300 disabled:opacity-30">↓</button>
                    </span>
                  )}
                </div>
                <div className="text-stone-600">{domPlanta(pl) || "Sin domicilio"}</div>
                {pl.gps ? <a href={urlMaps(pl.gps)} target="_blank" rel="noreferrer" className="text-sky-700 underline">Ubicación en Maps</a> : <div className="text-red-700">Sin ubicación de Maps (Administración → Plantas)</div>}
                <div>Contacto: {[pl.contacto_nombre, pl.contacto_telefono].filter(Boolean).join(" · ") || <span className="text-amber-700">sin cargar</span>} · Horario: {pl.horario_atencion || <span className="text-amber-700">sin cargar</span>}</div>
                <div className="font-medium">Se carga: {fmt(d.unidades)} u. · {fmt(d.kg)} kg</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-stone-500 font-semibold mb-1">Descargas, en este orden</div>
        <div className="space-y-2">
          {paradas.map((pa, i) => (
            <div key={i} className="rounded border border-stone-200 bg-white text-[13px]">
              <div className="p-3 flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold">{i + 1}</span>
                <div className="flex-1">
                  <div className="font-medium">{[pa.localidad, pa.provincia].filter(Boolean).join(", ") || pa.domicilio}</div>
                  <div className="text-stone-500 text-[12px]">{pa.domicilio}</div>
                  {pa.contactos.length ? <div className="text-[12px]">Contacto: {pa.contactos.join(" / ")}</div> : <div className="text-[12px] text-amber-700">sin contacto</div>}
                  {!pa.gps && <div className="text-[12px] text-red-700">sin ubicación</div>}
                </div>
                <span className="text-[12px] text-emerald-800 bg-emerald-50 rounded-full px-2">{kmTxt(km.par[i])}</span>
              </div>
              <div className="overflow-x-auto border-t border-stone-100">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-stone-50 text-[11.5px] text-stone-500">
                    <tr><th className="p-1.5 pl-3 text-left">Cliente</th><th className="p-1.5 text-left">Material / Variedad · lote</th><th className="p-1.5 text-left">O/V</th>{depositos.length > 1 && <th className="p-1.5 text-left">Carga en</th>}<th className="p-1.5 text-right">Cant.</th><th className="p-1.5 pr-3 text-right">Kg</th></tr>
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
          ))}
        </div>
        <div className="text-[12px] text-stone-500 mt-1">La descarga 1 corresponde al último renglón de la orden. Los clientes con la misma ubicación de Maps se agrupan en una sola descarga.</div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button disabled={km.cargando} onClick={() => descargarPedidoPdf(datos)} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Descargar PDF</button>
        <button disabled={km.cargando} onClick={copiar} className="border border-stone-300 bg-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Copiar texto (WhatsApp / mail)</button>
        {msg && <span className="text-[13px] text-stone-600">{msg}</span>}
      </div>
    </div>
  );
}
