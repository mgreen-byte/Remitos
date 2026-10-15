"use client";

import { useEffect, useState } from "react";
import RemitoSheet from "@/components/RemitoSheet";

const CLAVE = "copias_impresion";

// Cantidad de copias a imprimir. Se guarda en este navegador.
export function useCopias() {
  const [copias, setCopias] = useState(1);
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem(CLAVE));
      if (n >= 1 && n <= 6) setCopias(n);
    } catch {}
  }, []);
  const guardar = (n) => {
    const v = Math.max(1, Math.min(6, Number(n) || 1));
    setCopias(v);
    try {
      localStorage.setItem(CLAVE, String(v));
    } catch {}
  };
  return [copias, guardar];
}

// Selector de copias.
export function SelectorCopias({ copias, onChange }) {
  return (
    <label className="no-print inline-flex items-center gap-2 text-[13px] text-stone-600">
      Copias a imprimir
      <select value={copias} onChange={(e) => onChange(e.target.value)} className="border border-stone-300 rounded px-2 py-1 text-sm">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

// La hoja, más (copias - 1) hojas iguales que solo existen al imprimir.
// Así el navegador manda un trabajo de N hojas y no depende de la opción "Copias" del cuadro de impresión.
export default function RemitoConCopias({ copias = 1, ...props }) {
  return (
    <>
      <RemitoSheet {...props} corte={copias > 1} />
      {Array.from({ length: Math.max(0, copias - 1) }).map((_, i) => (
        <div key={i} className="print-extra">
          <RemitoSheet {...props} visible corte={i < copias - 2} />
        </div>
      ))}
    </>
  );
}
