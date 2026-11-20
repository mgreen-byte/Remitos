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
  if (error.code === "23514") {
    // Dato rechazado por formato: se dice cuál, según el control que saltó.
    const CHECKS = [
      [/choferes_dni/i, "el CUIL tiene que tener 11 dígitos (o el DNI 7 u 8, si marcaste “Solo tengo el DNI”)."],
      [/cuit|dni/i, "el CUIT o CUIL tiene que tener 11 dígitos, sin guiones."],
      [/punto_venta/i, "el punto de venta tiene que tener 4 dígitos (ej. 0004)."],
      [/gps/i, "la ubicación tiene que ser un link de Google Maps (que empiece con https://) o coordenadas como -33.74, -61.96."],
      [/empresa/i, "elegí la empresa de la lista."],
      [/despacha/i, "elegí qué despacha la planta (soja, maíz o ambos)."],
      [/kg_por_unidad|kg_unidad/i, "el peso por unidad tiene que ser mayor a cero."],
      [/categoria/i, "elegí una categoría válida."],
      [/grupo/i, "elegí un grupo válido."],
      [/numero/i, "el número de remito tiene que tener hasta 8 dígitos."],
      [/cantidad/i, "la cantidad tiene que ser mayor a cero."],
      [/stock|danado/i, "la cantidad supera el stock disponible."],
      [/precio/i, "el precio tiene que ser mayor a cero."],
      [/nombre|lote_check/i, "falta completar el nombre o el lote."],
      [/desde|hasta|primero|talonarios_check/i, "revisá el rango de números del talonario."],
    ];
    const hit = CHECKS.find(([re]) => re.test(msg));
    return `Revisá los datos: ${hit ? hit[1] : "hay un dato con formato incorrecto."}`;
  }
  if (error.code === "23505") {
    if (/(ya está cargad[ao] .*a nombre de|ya está cargado a nombre de)/i.test(msg)) return msg; // CUIL de chofer repetido: el mensaje ya dice a quién pertenece
    if (/punto_venta.*numero|remitos_punto_venta_numero_key|remitos_serie_numero_key/i.test(msg)) return "Ese número de remito ya fue registrado.";
    if (/plantas_empresa_pv_key|plantas_punto_venta_key/i.test(msg)) return "Ya hay otra planta de la misma empresa con ese punto de venta. Dos plantas pueden compartir el número solo si son de empresas distintas.";
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
// Documento del chofer: CUIL con guiones, o "DNI 12.345.678" si solo tienen el DNI (7 u 8 dígitos).
export const esDni = (v) => /^\d{7,8}$/.test(String(v ?? "").replace(/\D/g, ""));
export function fmtDocChofer(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return esDni(d) ? `DNI ${Number(d).toLocaleString("es-AR")}` : fmtCuit(v);
}
// Para imprimir en el remito: solo dígitos, o "DNI 12345678".
export const docChoferRemito = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return esDni(d) ? `DNI ${d}` : d;
};

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
// En un traslado que sale de una orden, se agrega el número de salida: "OC-CLA-001 · 2".
export const ordenCargaImpresa = (ordenCarga, salida) => {
  const t = String(ordenCarga ?? "").trim();
  return t && salida ? `${t} · ${salida}` : t;
};

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
export const ROL_LABEL = { admin: "Administrador", logistica: "Logística", operador: "Despacho de planta", consulta: "Solo vista" };
// Roles que ven todas las plantas.
export const veTodasLasPlantas = (rol) => rol === "admin" || rol === "consulta" || rol === "logistica";
