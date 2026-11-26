"use client";
// Recorrido de un pedido interno: carga → paradas → descarga, con km por tramo, link (corto) de Maps, PDF y texto.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { coordsDe, kmTramos, linkRecorrido, urlMaps } from "@/lib/rutas";
import { urlBase, fmtFecha, fmtNum } from "@/lib/util";
import { puntosDe, nombrePunto, lugarTexto, cargaTexto, horaTexto, textoInterno, descargarInternoPdf, tipoLugarLabel } from "@/lib/pedidosInternos";

export default function RecorridoInterno({ pi, onCerrar }) {
  const pts = puntosDe(pi);
  const firma = pts.map((p) => p.gps || "").join("|");
  const [km, setKm] = useState({ tramo: [], total: null, estimado: false, faltan: 0, cargando: true });
  const [link, setLink] = useState("");
  const [corto, setCorto] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const cs = await Promise.all(pts.map((p) => (p.gps ? coordsDe(p.gps).catch(() => null) : null)));
      const ok = []; const ref = [];
      cs.forEach((c, i) => { if (c) { ok.push(c); ref.push(i); } });
      const faltan = pts.length - ok.length;
      if (ok.length < 2) { if (vivo) { setKm({ tramo: [], total: null, estimado: false, faltan, cargando: false }); setLink(""); } return; }
      const r = await kmTramos(ok);
      if (!vivo) return;
      const tramo = pts.map(() => null);
      ref.forEach((i, k) => { if (k > 0) tramo[i] = r.tramos[k - 1]; });
      setKm({ tramo, total: r.tramos.reduce((a, b) => a + b, 0), estimado: r.estimado, faltan, cargando: false });
      setLink(linkRecorrido(ok));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);
  useEffect(() => {
    setCorto("");
    if (!link) return;
    let vivo = true;
    supabase.rpc("crear_link_corto", { p_url: link }).then(({ data, error }) => { if (vivo && !error && data) setCorto(`${urlBase()}/r/${data}`); });
    return () => { vivo = false; };
  }, [link]);
  const linkFinal = corto || link;

  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoInterno(pi, km, linkFinal)); setMsg("Texto copiado."); } catch { setMsg("No se pudo copiar."); }
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-stone-800">Recorrido · {pi.numero}</div>
        {onCerrar && <button onClick={onCerrar} className="ml-auto text-[12.5px] text-stone-500 underline">Cerrar</button>}
      </div>
      <div className="rounded-md border border-stone-200 bg-white p-3 text-[13px] space-y-1">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>Fecha de carga: <b>{fmtFecha(pi.fecha_carga)}{horaTexto(pi)}</b></span>
          <span>Carga: <b>{cargaTexto(pi) || "—"}</b></span>
          <span>Kms: <b>{km.cargando ? "calculando…" : km.total != null ? `${fmtNum(Math.round(km.total))} km${km.estimado ? " (estimado)" : ""}` : "—"}</b></span>
        </div>
        {linkFinal && <a href={linkFinal} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">Ver recorrido en Google Maps · {linkFinal.replace(/^https?:\/\//, "")}</a>}
        {km.faltan > 0 && !km.cargando && <div className="text-[12px] text-amber-700">{km.faltan} punto(s) sin ubicación de Maps: no entran en el cálculo.</div>}
        {km.estimado && <div className="text-[12px] text-amber-700">No respondió el servicio de rutas: es una estimación en línea recta + 30%.</div>}
        {pi.comentarios && <div className="text-[12.5px] bg-sky-50 border border-sky-200 rounded px-2 py-1">{pi.comentarios}</div>}
      </div>
      <div className="space-y-2">
        {pts.map((p, i) => {
          const az = p.paso === "CARGA", ve = p.paso === "DESCARGA";
          return (
            <div key={i} className={`rounded-md border p-3 text-[13px] ${az ? "border-sky-300 bg-sky-50" : ve ? "border-emerald-200 bg-white" : "border-stone-200 bg-white"}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${az ? "bg-sky-700" : ve ? "bg-emerald-700" : "bg-stone-500"}`}>{i + 1}</span>
                <div className="flex-1 space-y-0.5">
                  <div className="font-semibold"><span className={az ? "text-sky-800" : ve ? "text-emerald-800" : "text-stone-600"}>{p.paso}</span> · {nombrePunto(p)} <span className="font-normal text-[11.5px] text-stone-400">{tipoLugarLabel(p.tipo)}</span></div>
                  {(p.domicilio || p.localidad) && <div className="text-stone-600">{[p.domicilio, lugarTexto(p)].filter(Boolean).join(" - ")}</div>}
                  {(p.contacto || p.telefono || p.horario) && <div className="text-stone-600">{[p.contacto && `Contacto: ${p.contacto}`, p.telefono, p.horario && `Horario: ${p.horario}`].filter(Boolean).join(" · ")}</div>}
                  {p.gps ? <a href={urlMaps(p.gps)} target="_blank" rel="noreferrer" className="text-[12px] text-sky-700 underline">Ubicación en Maps</a> : <div className="text-[12px] text-red-700">sin ubicación</div>}
                </div>
                {km.tramo[i] != null && <span className="text-[11.5px] rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5">{fmtNum(Math.round(km.tramo[i]))} km</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => descargarInternoPdf(pi, km, linkFinal)} className="px-3 py-1.5 rounded-md bg-emerald-700 text-white text-[13px]">Descargar PDF</button>
        <button onClick={copiar} className="px-3 py-1.5 rounded-md border border-stone-300 bg-white text-[13px]">Copiar texto (WhatsApp / mail)</button>
        {msg && <span className="text-[12.5px] text-emerald-700 self-center">{msg}</span>}
      </div>
    </div>
  );
}
