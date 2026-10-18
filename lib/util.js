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
  if (error.code === "23514") return "Revisá los datos: el CUIT o CUIL tiene que tener 11 dígitos, sin guiones.";
  if (error.code === "23505") {
    if (/punto_venta.*numero|remitos_punto_venta_numero_key/i.test(msg)) return "Ese número de remito ya fue registrado.";
    if (/transportistas_cuit/i.test(msg)) return "Ya hay un transporte cargado con ese CUIT.";
    if (/dni/i.test(msg)) return "Ya hay un chofer cargado con ese CUIL.";
    return "Ya existe un registro igual.";
  }
  if (error.code === "23503") {
    if (/lotes_producto/i.test(msg)) return "No se puede eliminar: el producto tiene lotes cargados. Desactivalo (columna Activo) para que no se use más.";
    return "No se puede borrar: está siendo usado por otros registros.";
  }
  if (error.code === "42501" || /row-level security|permission denied/i.test(msg)) return "No tenés permiso para hacer esto.";
  if (/Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|fetch failed/i.test(msg))
    return "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.";
  return msg;
}

// 30512703719 -> 30-51270371-9 (si no son 11 dígitos, lo deja como está)
export function fmtCuit(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(v ?? "");
}

export const PROVINCIAS = [
  "BUENOS AIRES", "CIUDAD AUTÓNOMA DE BUENOS AIRES", "CATAMARCA", "CHACO", "CHUBUT", "CÓRDOBA", "CORRIENTES",
  "ENTRE RÍOS", "FORMOSA", "JUJUY", "LA PAMPA", "LA RIOJA", "MENDOZA", "MISIONES", "NEUQUÉN", "RÍO NEGRO",
  "SALTA", "SAN JUAN", "SAN LUIS", "SANTA CRUZ", "SANTA FE", "SANTIAGO DEL ESTERO", "TIERRA DEL FUEGO", "TUCUMÁN",
];
// "BuenosAires", "Bs As", "buenos aires" -> "BUENOS AIRES" (devuelve "" si no la reconoce).
export function normalizarProvincia(v) {
  const k = (t) => norm(t).replace(/[^a-z]/g, "");
  const x = k(v);
  if (!x) return "";
  if (["bsas", "buenosaires", "pciabuenosaires", "provinciadebuenosaires", "pbuenosaires"].includes(x)) return "BUENOS AIRES";
  if (["caba", "capitalfederal", "ciudadautonomadebuenosaires", "ciudaddebuenosaires"].includes(x)) return "CIUDAD AUTÓNOMA DE BUENOS AIRES";
  return PROVINCIAS.find((p) => k(p) === x) || "";
}
export const esBuenosAires = (p) => norm(p) === "buenos aires";

// Lo que se imprime en OBSERVACIONES: primero el COT, después el texto libre.
// La orden de carga va en su propio renglón (ver ordenCargaImpresa).
export function observacionesImpresas({ cot, observaciones }) {
  return [cot ? `COT: ${cot}` : "", observaciones].filter(Boolean).join("\n");
}

// Renglón al pie del cuadro de mercadería, arriba del total de unidades: solo el número de la orden.
export const ordenCargaImpresa = (ordenCarga) => String(ordenCarga ?? "").trim();

// COT pendiente "atrasado": pasó más de un día desde que se emitió el remito.
export const cotAtrasado = (creado) => !!creado && Date.now() - new Date(creado).getTime() > 24 * 3600 * 1000;

// Dinero: $ 1.234.567,89
export const fmtMonto = (n) =>
  n === null || n === undefined || n === "" || Number.isNaN(Number(n))
    ? "—"
    : "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Nombre del producto + presentación, sin repetir: si el nombre ya trae la presentación
// (ej. "BIG BAG DE SOJA ORIGINAL - VARIEDAD 50EE59" + "BIG BAG"), se muestra solo el nombre.
export function nombreConPresentacion(nombre, presentacion) {
  const n = String(nombre ?? "").trim();
  const p = String(presentacion ?? "").trim();
  if (!p || norm(n).includes(norm(p))) return n;
  return `${n} ${p}`.trim();
}

// Nombres de los roles tal como se muestran (por dentro siguen siendo admin / operador / consulta).
export const ROL_LABEL = { admin: "Administrador", operador: "Despacho de planta", consulta: "Solo vista" };
