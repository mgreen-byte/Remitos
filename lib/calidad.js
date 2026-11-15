export const ESTADOS_CALIDAD = [
  { v: "aprobado", t: "Aprobado calidad", cls: "bg-emerald-100 text-emerald-800" },
  { v: "pre_inspeccion", t: "Pre inspección", cls: "bg-amber-100 text-amber-800" },
  { v: "pre_inspeccion_datos", t: "Pre inspección c/datos", cls: "bg-amber-100 text-amber-800" },
  { v: "no_aprobado", t: "No aprobado calidad", cls: "bg-red-100 text-red-700" },
];
export const calidadInfo = (v) => ESTADOS_CALIDAD.find((e) => e.v === v) || ESTADOS_CALIDAD[0];
export const calKey = (productoId, lote) => `${productoId}||${String(lote || "").trim().toUpperCase()}`;

// Peso por bolsa y calibre por producto+lote (maíz en bolsas). Devuelve { "producto||LOTE": { kg, calibre, estado } }.
export async function traerDatosLotes(supabase) {
  const out = {};
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from("calidad_lotes").select("producto_id, lote_key, estado, kg_unidad, calibre").order("producto_id").order("lote_key").range(desde, desde + 999);
    if (error || !data) break;
    data.forEach((c) => { out[`${c.producto_id}||${c.lote_key}`] = { kg: c.kg_unidad, calibre: c.calibre, estado: c.estado }; });
    if (data.length < 1000) break;
  }
  return out;
}
