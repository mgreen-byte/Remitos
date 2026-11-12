export const ESTADOS_CALIDAD = [
  { v: "aprobado", t: "Aprobado calidad", cls: "bg-emerald-100 text-emerald-800" },
  { v: "pre_inspeccion", t: "Pre inspección", cls: "bg-amber-100 text-amber-800" },
  { v: "pre_inspeccion_datos", t: "Pre inspección c/datos", cls: "bg-amber-100 text-amber-800" },
  { v: "no_aprobado", t: "No aprobado calidad", cls: "bg-red-100 text-red-700" },
];
export const calidadInfo = (v) => ESTADOS_CALIDAD.find((e) => e.v === v) || ESTADOS_CALIDAD[0];
export const calKey = (productoId, lote) => `${productoId}||${String(lote || "").trim().toUpperCase()}`;
