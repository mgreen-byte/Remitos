"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { norm } from "@/lib/util";

// Selector con búsqueda: se escribe y muestra todas las coincidencias parciales.
// options: [{ value, label, sub, buscar }]  ·  extras: opciones fijas al principio/final ({ value, label, alFinal })
export default function BuscadorSelect({ value, onChange, options, extras = [], placeholder = "Escribí para buscar…", className = "", disabled = false }) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef(null);
  const sel = options.find((o) => o.value === value) || extras.find((o) => o.value === value && value);

  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) { setAbierto(false); setTexto(""); } };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const lista = useMemo(() => {
    const palabras = norm(texto).split(/\s+/).filter(Boolean);
    const dig = texto.replace(/\D/g, "");
    const coinciden = !palabras.length ? options : options.filter((o) => {
      const h = norm(`${o.label} ${o.sub || ""} ${o.buscar || ""}`);
      const hd = `${o.label} ${o.sub || ""} ${o.buscar || ""}`.replace(/\D/g, "");
      return palabras.every((p) => h.includes(p)) || (dig.length >= 3 && hd.includes(dig));
    });
    return [...extras.filter((x) => !x.alFinal), ...coinciden.slice(0, 200), ...extras.filter((x) => x.alFinal)];
  }, [texto, options, extras]);

  const elegir = (o) => { onChange(o.value); setAbierto(false); setTexto(""); };

  return (
    <div ref={caja} className="relative">
      <input
        value={abierto ? texto : sel ? `${sel.label}${sel.sub ? ` — ${sel.sub}` : ""}` : ""}
        onFocus={() => { setAbierto(true); setTexto(""); setActivo(0); }}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(a + 1, lista.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (lista[activo]) elegir(lista[activo]); }
          else if (e.key === "Escape") { setAbierto(false); setTexto(""); e.currentTarget.blur(); }
        }}
        placeholder={sel ? "" : placeholder}
        disabled={disabled}
        className={`${className} pr-8`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 text-[11px]">▼</span>
      {abierto && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-stone-200 rounded-md shadow-lg text-[13.5px]">
          {texto && lista.filter((o) => !extras.includes(o)).length === 0 && <div className="px-3 py-2 text-stone-400">No hay coincidencias con “{texto}”.</div>}
          {lista.map((o, i) => (
            <button
              key={`${o.value}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegir(o)}
              onMouseEnter={() => setActivo(i)}
              className={`block w-full text-left px-3 py-2 ${i === activo ? "bg-emerald-50" : ""} ${extras.includes(o) ? "text-emerald-700" : ""} ${o.value === value && value ? "font-semibold" : ""}`}
            >
              {o.label}
              {o.sub && <span className="text-stone-400"> — {o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
