export const up = (s) => (s ?? "").toString().toUpperCase();

export const norm = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");

// Número sin decimales sobrantes: 70.000 -> "70", 12.5 -> "12,5"
export function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "";
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return x.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

export function fmtFecha(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function hoyISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Traduce errores de Supabase/Postgres a mensajes claros para el usuario.
export function friendlyError(error) {
  if (!error) return "";
  const msg = error.message || String(error);
  if (error.code === "23505") {
    if (/punto_venta.*numero|remitos_punto_venta_numero_key/i.test(msg)) return "Ese número de remito ya fue registrado.";
    if (/dni/i.test(msg)) return "Ese CUIL ya está cargado.";
    return "Ya existe un registro igual.";
  }
  if (error.code === "23503") return "No se puede borrar: está siendo usado por otros registros.";
  if (error.code === "42501" || /row-level security|permission denied/i.test(msg)) return "No tenés permiso para hacer esto.";
  if (/Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|fetch failed/i.test(msg))
    return "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.";
  return msg;
}
