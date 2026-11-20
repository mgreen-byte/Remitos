"use client";
// Archivos del remito conforme de salida + botones para sacar foto o adjuntar.
import { useRef, useState } from "react";
import { subirConforme, abrirConforme, borrarConforme, puedeBorrar, puedeSubir } from "@/lib/conformes";
import { confirmar } from "@/lib/confirmar";

// destino = { tipo: "orden", orden_id, planta_id } o { tipo: "remito", id, planta_id, estado }
export default function ConformesRemito({ destino, archivos = [], profile, onCambio, compacto = false }) {
  const foto = useRef(null);
  const arch = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const sube = puedeSubir(destino, profile);

  const elegir = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setError("");
    setSubiendo(true);
    for (const f of files) {
      const r = await subirConforme(destino, f);
      if (r.error) {
        setError(r.error);
        break;
      }
    }
    setSubiendo(false);
    onCambio && onCambio();
  };
  const abrir = async (c) => {
    const r = await abrirConforme(c.path);
    if (r.error) setError(r.error);
  };
  const borrar = async (c) => {
    if (!(await confirmar("¿Borrar este archivo del conforme?"))) return;
    const r = await borrarConforme(c);
    if (r.error) setError(r.error);
    onCambio && onCambio();
  };

  const hora = (c) => new Date(c.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const btn = `inline-flex items-center gap-1.5 rounded-md border font-medium ${compacto ? "px-2 py-1 text-[12px]" : "px-3 py-2 text-[13.5px]"}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {archivos.map((c, i) => (
        <span key={c.id} className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[12px]">
          <button type="button" onClick={() => abrir(c)} className="px-2 py-1 hover:underline" title={`Subido por ${c.subido_por_nombre || "—"} · ${hora(c)}`}>
            📎 {c.tipo === "application/pdf" ? "PDF" : "Foto"} {archivos.length > 1 ? i + 1 : ""} <span className="text-emerald-700/70">· {hora(c)}</span>
          </button>
          {puedeBorrar(c, profile) && (
            <button type="button" onClick={() => borrar(c)} className="px-1.5 py-1 text-emerald-700/70 hover:text-red-600 border-l border-emerald-200" aria-label="Borrar archivo">
              ✕
            </button>
          )}
        </span>
      ))}
      {!archivos.length && !sube && <span className="text-[12px] text-amber-700">Sin conforme</span>}
      {sube && (
        <>
          <input ref={foto} type="file" accept="image/*" capture="environment" className="hidden" onChange={elegir} />
          <input ref={arch} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={elegir} />
          <button type="button" disabled={subiendo} onClick={() => foto.current?.click()} className={`${btn} bg-emerald-700 border-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60 md:hidden`}>
            📷 {subiendo ? "Subiendo…" : archivos.length ? "Otra foto" : "Sacar foto"}
          </button>
          <button type="button" disabled={subiendo} onClick={() => arch.current?.click()} className={`${btn} border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-60`}>
            {subiendo ? "Subiendo…" : archivos.length ? "+ Agregar" : "Adjuntar foto o PDF"}
          </button>
        </>
      )}
      {error && <span className="basis-full text-[12px] text-red-700">{error}</span>}
    </div>
  );
}
