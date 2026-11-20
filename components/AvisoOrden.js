"use client";
// Dentro de la orden: aviso por correo a cada depósito (Outlook), con estado "sin avisar / cambió / avisado".
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { armarAviso, mismoAviso, urlOutlookApp, urlOutlookWeb, MAILTO_MAX } from "@/lib/avisoOrden";
import { friendlyError } from "@/lib/util";

let ccCache = null;
export const ccAvisos = () => {
  if (!ccCache) ccCache = supabase.from("configuracion").select("valor").eq("clave", "aviso_ordenes").maybeSingle().then(({ data }) => data?.valor?.cc || "");
  return ccCache;
};

export default function AvisoOrden({ orden, lineas, plantas, profile, onCambio, descargarPdf }) {
  const [avisos, setAvisos] = useState([]);
  const [cc, setCc] = useState("");
  const [msg, setMsg] = useState(null);
  const [ver, setVer] = useState(null); // planta con el texto desplegado

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("orden_avisos").select("*").eq("orden_id", orden.id).order("created_at", { ascending: false });
    setAvisos(data || []);
  }, [orden.id]);
  useEffect(() => { cargar(); ccAvisos().then(setCc); }, [cargar]);

  const esT = orden.modalidad === "traslado";
  const ids = esT ? [orden.planta_origen_id, orden.planta_destino_id].filter(Boolean) : [...new Set(lineas.map((l) => l.planta_id).filter(Boolean))];
  if (!ids.length) return null;
  const url = typeof window !== "undefined" ? `${window.location.origin}/ordenes?oc=${encodeURIComponent(orden.numero)}` : "";

  const datos = (pid) => {
    const planta = plantas.find((p) => p.id === pid) || { id: pid, nombre: "Planta" };
    const ls = esT ? lineas : lineas.filter((l) => l.planta_id === pid);
    const ultimo = avisos.find((a) => a.planta_id === pid) || null;
    const m = armarAviso({ orden, lineas: ls, planta, cc, url, usuario: profile.nombre, anterior: ultimo });
    const estado = !ultimo ? "sin" : mismoAviso(ultimo.firma, orden, ls) ? "ok" : "cambio";
    return { planta, m, ultimo, estado };
  };

  const registrar = async (pid, m) => {
    const { error } = await supabase.rpc("registrar_aviso_orden", { p_orden: orden.id, p_planta: pid, p_firma: m.firma, p_para: m.para });
    if (error) return setMsg({ tipo: "error", texto: friendlyError(error) });
    await cargar();
    onCambio && onCambio();
  };

  const abrir = async (pid, web) => {
    setMsg(null);
    const { planta, m } = datos(pid);
    if (!m.para) return setMsg({ tipo: "error", texto: `${planta.nombre} no tiene correos cargados. Cargalos en Administración → Plantas → “Correos para avisos”.` });
    if (web) {
      window.open(urlOutlookWeb(m), "_blank");
    } else {
      let u = urlOutlookApp(m);
      if (u.length > MAILTO_MAX) {
        // Outlook corta los textos largos: va el resumen y el detalle completo queda copiado para pegar.
        try { await navigator.clipboard.writeText(m.cuerpo); } catch {}
        u = urlOutlookApp(m, `Hola,\n\n(Pegá acá el detalle con Ctrl+V)\n\nVer la orden en la plataforma: ${url}`);
        setMsg({ tipo: "ok", texto: "El detalle es largo: quedó copiado. En el correo, pegalo con Ctrl+V." });
      }
      window.location.href = u;
    }
    await registrar(pid, m);
  };

  const copiar = async (pid) => {
    const { m } = datos(pid);
    try {
      await navigator.clipboard.writeText(`Para: ${m.para}\nCC: ${m.cc}\nAsunto: ${m.asunto}\n\n${m.cuerpo}`);
      setMsg({ tipo: "ok", texto: "Correo copiado (para, CC, asunto y texto)." });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo copiar. Desplegá el texto y copialo a mano." });
    }
  };

  const fh = (x) => new Date(x).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const btn = "text-[12.5px] px-2.5 py-1 rounded-md border";

  return (
    <div className="rounded-md border border-stone-200">
      <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-[13px] flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-800">✉ Aviso al depósito</span>
        {cc ? <span className="text-[11.5px] text-stone-400">· copia a {cc}</span> : <span className="text-[11.5px] text-amber-700">· sin copia a Logística (cargala en Administración → Configuración)</span>}
      </div>
      <div className="divide-y divide-stone-100">
        {ids.map((pid) => {
          const { planta, m, ultimo, estado } = datos(pid);
          return (
            <div key={pid} className="px-3 py-2.5 text-[13px] space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-stone-800">{planta.nombre}</span>
                {esT && <span className="text-[11px] text-stone-500">{pid === orden.planta_origen_id ? "(origen)" : "(destino)"}</span>}
                {estado === "sin" && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">sin avisar</span>}
                {estado === "cambio" && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-red-100 text-red-700">cambió desde el último aviso</span>}
                {estado === "ok" && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800">avisado</span>}
                {ultimo && <span className="text-[11.5px] text-stone-400">último aviso {fh(ultimo.created_at)} · {ultimo.enviado_por_nombre}</span>}
              </div>
              <div className="text-[12px] text-stone-500">Para: {m.para || <span className="text-amber-700">sin correos cargados</span>}</div>
              {estado === "cambio" && m.cambios.length > 0 && (
                <ul className="text-[12px] text-red-800 list-disc pl-5">
                  {m.cambios.slice(0, 6).map((c) => <li key={c}>{c}</li>)}
                  {m.cambios.length > 6 && <li>…y {m.cambios.length - 6} más</li>}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => abrir(pid, false)} className={`${btn} ${estado === "ok" ? "bg-white border-stone-300 text-stone-700" : "bg-emerald-700 border-emerald-700 text-white"}`}>
                  {estado === "sin" ? "Avisar en Outlook" : estado === "cambio" ? "Avisar el cambio en Outlook" : "Volver a avisar (Outlook)"}
                </button>
                <button onClick={() => abrir(pid, true)} className={`${btn} bg-white border-stone-300 text-stone-700`} title="Outlook en el navegador (Microsoft 365)">Outlook web</button>
                <button onClick={() => copiar(pid)} className={`${btn} bg-white border-stone-300 text-stone-700`}>Copiar correo</button>
                {descargarPdf && <button onClick={descargarPdf} className={`${btn} bg-white border-stone-300 text-stone-700`}>PDF para adjuntar</button>}
                <button onClick={() => setVer(ver === pid ? null : pid)} className="text-[12px] text-stone-500 underline px-1">{ver === pid ? "Ocultar texto" : "Ver texto"}</button>
              </div>
              {ver === pid && (
                <pre className="whitespace-pre-wrap text-[11.5px] bg-stone-50 border border-stone-200 rounded p-2 font-sans text-stone-700">{`Asunto: ${m.asunto}\n\n${m.cuerpo}`}</pre>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div className={`px-3 py-2 text-[12.5px] ${msg.tipo === "error" ? "text-red-700" : "text-emerald-700"}`}>{msg.texto}</div>}
    </div>
  );
}
