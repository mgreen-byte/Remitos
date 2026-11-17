"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError } from "@/lib/util";
import { coordsDe, kmTramos, linkRecorrido } from "@/lib/rutas";
import { TIPOS_UNIDAD, armarDestinos, textoPedido, descargarPedidoPdf } from "@/lib/pedidoUnidad";

const EMPRESA_NOMBRE = { ms: "MS Technologies", stine: "Stine Seed" };
const fmt = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
// Domicilio + provincia, sin repetir la provincia si ya está escrita en el domicilio
const domicilioPlanta = (p) => { const d = String(p?.domicilio || "").trim(); const pr = String(p?.provincia || "").trim(); return d && pr && d.toUpperCase().includes(pr.toUpperCase()) ? d : [d, pr].filter(Boolean).join(", "); };

// Pedido de unidad al transporte (solo administrador): depósito, recorrido con km y detalle de la orden.
export default function PedidoUnidad({ orden, lineas, plantas, productos, onCerrar }) {
  // La planta se vuelve a leer al abrir, para tomar el contacto y horario recién cargados en Administración.
  const plantaLista = plantas.find((p) => p.id === lineas[0]?.planta_id) || null;
  const [plantaFresca, setPlantaFresca] = useState(null);
  useEffect(() => {
    if (!plantaLista?.id) return;
    supabase.from("plantas").select("*").eq("id", plantaLista.id).single().then(({ data }) => data && setPlantaFresca(data));
  }, [plantaLista?.id]);
  const planta = plantaFresca || plantaLista;
  const { destinos, pendiente } = useMemo(() => armarDestinos(lineas, productos), [lineas, productos]);
  const [tipo, setTipo] = useState(orden.tipo_unidad || "");
  const [obs, setObs] = useState("");
  const [km, setKm] = useState({ tramos: [], total: null, estimado: false, faltan: 0, cargando: true });
  const [recorrido, setRecorrido] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const origen = await coordsDe(planta?.gps);
      const cds = await Promise.all(destinos.map((d) => coordsDe(d.gps)));
      if (!vivo) return;
      if (!origen) return setKm({ tramos: [], total: null, estimado: false, faltan: cds.filter((c) => !c).length, cargando: false, sinOrigen: true });
      // Se calcula por los destinos que tienen ubicación; el km de cada uno es desde el punto anterior con ubicación.
      const idx = cds.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      const pts = [origen, ...idx.map((i) => cds[i])];
      const r = await kmTramos(pts);
      if (!vivo) return;
      const tramos = destinos.map(() => null);
      idx.forEach((i, k) => { tramos[i] = r.tramos[k]; });
      setKm({ tramos, total: r.tramos.reduce((a, b) => a + b, 0), estimado: r.estimado, faltan: destinos.length - idx.length, cargando: false });
      setRecorrido(linkRecorrido(pts));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planta?.id, planta?.gps, destinos.length]);

  const totU = destinos.reduce((a, d) => a + d.items.reduce((b, it) => b + it.cantidad, 0), 0);
  const totKg = destinos.reduce((a, d) => a + d.items.reduce((b, it) => b + it.kg, 0), 0);
  const datos = { orden, planta, destinos, km, recorrido, tipoUnidad: tipo, obs, totU, totKg, empresa: planta?.empresa, empresaNombre: EMPRESA_NOMBRE[planta?.empresa] };

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
  const faltaContacto = planta && !planta.contacto_telefono;
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
            {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lab}>Observaciones para el transporte (opcional, no se guardan)</label>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: llevar lona, cargar a primera hora…" className={inp} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-stone-200 bg-white p-3 text-[13px] space-y-0.5">
          <div className="text-[11px] uppercase tracking-wide text-stone-500 font-semibold mb-1">Depósito de carga</div>
          <div className="font-medium">{planta?.nombre || "—"}</div>
          <div className="text-stone-600">{domicilioPlanta(planta) || "Sin domicilio"}</div>
          {planta?.gps ? <a href={planta.gps} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">Ubicación en Maps</a> : <div className="text-red-700">Sin ubicación de Maps (Administración → Plantas)</div>}
          <div>Contacto: {[planta?.contacto_nombre, planta?.contacto_telefono].filter(Boolean).join(" · ") || <span className="text-amber-700">sin cargar</span>}</div>
          <div>Horario de atención: {planta?.horario_atencion || <span className="text-amber-700">sin cargar</span>}</div>
          {faltaContacto && <div className="text-[12px] text-amber-700 pt-1">Completá contacto y horario en Administración → Plantas.</div>}
        </div>
        <div className="rounded border border-stone-200 bg-white p-3 text-[13px] space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-stone-500 font-semibold mb-1">Viaje</div>
          <div>Fecha de carga: <b>{orden.fecha_carga ? String(orden.fecha_carga).slice(0, 10).split("-").reverse().join("/") : "—"}</b></div>
          <div>Carga: <b>{fmt(totU)} u. · {fmt(totKg)} kg</b>{!pendiente && <span className="text-stone-500"> (ya remitida: se muestra lo pedido)</span>}</div>
          <div>
            Recorrido (solo ida):{" "}
            {km.cargando ? <span className="text-stone-500">calculando…</span> : km.sinOrigen ? <span className="text-red-700">falta la ubicación del depósito</span> : km.total != null ? <b>{fmt(km.total)} km{km.estimado ? " (estimado)" : ""}</b> : "—"}
          </div>
          {km.estimado && <div className="text-[12px] text-amber-700">No respondió el servicio de rutas: es una estimación en línea recta + 30%.</div>}
          {km.faltan > 0 && !km.cargando && <div className="text-[12px] text-amber-700">{km.faltan} destino(s) sin ubicación de Maps: no entran en el cálculo.</div>}
          {recorrido && <a href={recorrido} target="_blank" rel="noreferrer" className="text-sky-700 underline">Ver recorrido en Google Maps</a>}
        </div>
      </div>

      <div className="rounded border border-stone-200 bg-white overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-stone-50 text-xs text-stone-500">
            <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Destino</th><th className="p-2 text-left">Producto · lote</th><th className="p-2 text-right">Cant.</th><th className="p-2 text-right">Kg</th><th className="p-2 text-right">Km</th></tr>
          </thead>
          <tbody>
            {destinos.map((d, i) => (
              <tr key={i} className="border-t border-stone-100 align-top">
                <td className="p-2 font-semibold">{i + 1}</td>
                <td className="p-2">
                  <div className="font-medium">{d.cliente}</div>
                  <div className="text-stone-500 text-[12px]">{[d.localidad, d.provincia].filter(Boolean).join(", ") || d.domicilio}</div>
                  {!d.gps && <div className="text-[12px] text-red-700">sin ubicación</div>}
                </td>
                <td className="p-2">{d.items.map((it, k) => <div key={k}>{it.producto}{it.lote ? <span className="text-stone-500"> · {it.lote}</span> : ""}</div>)}</td>
                <td className="p-2 text-right">{d.items.map((it, k) => <div key={k}>{fmt(it.cantidad)}</div>)}</td>
                <td className="p-2 text-right">{d.items.map((it, k) => <div key={k}>{it.kg ? fmt(it.kg) : "—"}</div>)}</td>
                <td className="p-2 text-right whitespace-nowrap">{km.cargando ? "…" : km.tramos[i] != null ? fmt(km.tramos[i]) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[12px] text-stone-500">Orden de descarga: el destino 1 es el último renglón de la orden. Los km de cada destino son desde el punto anterior.</div>

      <div className="flex flex-wrap gap-3 items-center">
        <button disabled={km.cargando} onClick={() => descargarPedidoPdf(datos)} className="bg-emerald-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Descargar PDF</button>
        <button disabled={km.cargando} onClick={copiar} className="border border-stone-300 bg-white text-sm px-4 py-1.5 rounded disabled:opacity-50">Copiar texto (WhatsApp / mail)</button>
        {msg && <span className="text-[13px] text-stone-600">{msg}</span>}
      </div>
    </div>
  );
}
