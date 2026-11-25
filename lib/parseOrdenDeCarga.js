import { uid } from "./fieldCoords";
import { norm, normalizarProvincia, PROVINCIAS } from "./util";
import { normalizarGps } from "./qr";

// En las órdenes las celdas sin dato vienen como 0 o "-": se tratan como vacías.
const limpio = (v) => {
  const t = String(v ?? "").trim();
  return t === "0" || t === "-" || t === "--" ? "" : t;
};

// Cuando la orden no trae columna Provincia (maíz), se busca al final de la dirección: "… - Gualeguay - EntreRíos".
const provinciaDeDireccion = (dir) => {
  const partes = String(dir || "").split(/\s-\s|,/).map((x) => x.trim()).filter(Boolean);
  for (let i = partes.length - 1; i >= Math.max(0, partes.length - 2); i--) {
    const p = normalizarProvincia(partes[i]);
    if (p) return p;
  }
  const k = (t) => norm(t).replace(/[^a-z]/g, "");
  const fin = k(partes[partes.length - 1] || "");
  return PROVINCIAS.find((p) => k(p).length > 5 && fin.endsWith(k(p))) || "";
};

const localidadDeDireccion = (dir) => {
  const partes = String(dir || "").split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  if (partes.length < 2) return "";
  const ultima = partes[partes.length - 1];
  return provinciaDeDireccion(ultima) || normalizarProvincia(ultima) ? partes[partes.length - 2] : ultima;
};

// El Excel nunca se guarda: llega como array-of-arrays (leído por SheetJS en el
// navegador) y se procesa en memoria. Devuelve por cliente los ítems con el
// nombre del producto, para cruzarlos después con el catálogo.
export function parseOrdenDeCarga(rows) {
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || []).some((c) => norm(c) === "cliente")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error("No encontré una columna 'Cliente' en el archivo. ¿Es una orden de carga válida?");
  }
  // Número de la orden (ej. OC-SF-143, OC-MI-182 o el traslado TRAS26-MOR-006): está en las filas de arriba del encabezado.
  let ordenCarga = "";
  for (const r of rows) {
    for (const c of r || []) {
      const m = String(c ?? "").trim().match(/^(OC|TRAS\d{0,4})-[A-Z]{1,4}-\d+/i);
      if (m) { ordenCarga = m[0].toUpperCase(); break; }
    }
    if (ordenCarga) break;
  }
  // Fecha prevista de carga: la celda de abajo (o de la derecha) del rótulo "FECHA", en las filas de arriba del encabezado.
  const aISO = (v) => {
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() + 12 * 3600 * 1000); // evita corrimientos de huso horario de la lectura
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (typeof v === "number" && v > 30000 && v < 80000) return aISO(new Date(Math.round((v - 25569) * 86400000) - new Date().getTimezoneOffset() * 60000));
    const m = String(v ?? "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return "";
  };
  let fechaCarga = "";
  for (let i = 0; i < headerRowIdx && !fechaCarga; i++) {
    (rows[i] || []).forEach((c, j) => {
      if (fechaCarga || norm(c) !== "fecha") return;
      fechaCarga = aISO((rows[i + 1] || [])[j]) || aISO((rows[i] || [])[j + 1]) || aISO((rows[i + 2] || [])[j]);
    });
  }
  const headers = (rows[headerRowIdx] || []).map((h) => (h || "").toString().trim());
  const hIndex = {};
  headers.forEach((h, i) => {
    if (h) hIndex[norm(h)] = i;
  });

  const get = (row, ...names) => {
    for (const n of names) {
      const idx = hIndex[norm(n)];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") return row[idx];
    }
    return "";
  };

  const isMaiz = "hibrido" in hIndex;
  const isSoja = "variedad" in hIndex;
  const modalidadDetectada = isMaiz ? "maiz" : isSoja ? "soja" : "desconocida";

  const clientesMap = {};
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cliente = limpio(get(row, "cliente"));
    if (!cliente) continue;
    const cantidad = Number(get(row, "cantidad")) || 0;
    if (cantidad <= 0) continue; // renglones sin cantidad: no se cargan
    // Un remito por cliente y por depósito (cada depósito es una planta de salida distinta).
    const deposito = limpio(get(row, "deposito", "depósito"));
    // y por destino de entrega: el mismo cliente con dos localidades/direcciones son dos remitos distintos.
    const direccion = limpio(get(row, "direccion de entrega", "dirección de entrega"));
    const localidad = limpio(get(row, "localidad"));
    const domicilio = [direccion, localidad && !norm(direccion).includes(norm(localidad)) ? localidad : ""].filter(Boolean).join(", ");
    const clave = `${cliente}||${deposito}||${norm(domicilio)}`;
    if (!clientesMap[clave]) {
      clientesMap[clave] = {
        clave,
        cliente,
        cuit: limpio(get(row, "cuit")),
        contacto: limpio(get(row, "contacto")),
        telefono: limpio(get(row, "telefono", "teléfono")),
        domicilio,
        // Localidad aparte (soja: columna Localidad; maíz: "… - Localidad - Provincia" dentro de la dirección)
        localidad: (localidad || localidadDeDireccion(direccion)).toUpperCase(),
        provincia: normalizarProvincia(limpio(get(row, "provincia"))) || provinciaDeDireccion(direccion),
        entregarEn: limpio(get(row, "entregar en:", "entregar en")).replace(/^punto\s*gps.*$/i, ""), // "Punto Gps" no es un lugar: la ubicación va en el QR
        gps: normalizarGps(get(row, "punto gps", "gps", "ubicacion", "ubicación", "link maps", "maps")),
        deposito,
        items: [],
        totalCantidad: 0,
        totalKilos: 0,
      };
    }
    const c = clientesMap[clave];
    const kilos = Math.round((Number(get(row, "kilos")) || 0) * 1000) / 1000;
    let calibre = "";
    let pesoBolsa = null;
    let semillas = null;

    let producto = "";
    let presentacion = "";
    let loteOc = "";
    let extra = "";
    if (isMaiz) {
      producto = String(get(row, "hibrido", "híbrido")).trim();
      calibre = String(get(row, "calibre") || "").trim().toUpperCase();
      pesoBolsa = Number(String(get(row, "peso bolsa", "peso por bolsa", "peso")).replace(",", ".")) || null;
      semillas = Number(get(row, "semillas por bolsa", "semillas x bolsa", "semillas")) || null;
      const partida = get(row, "partida", "lote");
      // En el stock, el lote de maíz se carga como "CALIBRE - PARTIDA" (igual que en el sistema administrativo).
      const part = String(partida || "").trim().toUpperCase();
      loteOc = !part ? "" : calibre && !part.replace(/\s*-\s*/, "-").startsWith(`${calibre}-`) ? `${calibre} - ${part}` : part.replace(/^([^\s-]+)\s*-\s*/, "$1 - ");
      extra = [calibre ? `CALIBRE ${calibre}` : ""].filter(Boolean).join(" · ");
    } else if (isSoja) {
      producto = String(get(row, "variedad")).trim();
      presentacion = String(get(row, "presentacion", "presentación")).trim();
      loteOc = String(get(row, "pilote /lote", "pilote/lote", "lote")).trim();
      const precinto = limpio(get(row, "precinto"));
      extra = precinto ? `PRECINTO ${precinto}` : "";
    } else {
      producto = String(get(row, "descripcion", "descripción", "producto")).trim();
    }

    c.items.push({ id: uid(), fila: i, cantidad, kilos, producto, presentacion, loteOc, extra, calibre, pesoBolsa, semillas, ov: limpio(get(row, "o/v", "ov")) });
    c.totalCantidad += cantidad;
    c.totalKilos += kilos;
  }

  // "PALLET APROX:" del encabezado (el valor está a la derecha o debajo del rótulo)
  let palletsAprox = null;
  for (let i = 0; i < headerRowIdx && palletsAprox == null; i++) {
    (rows[i] || []).forEach((c, j) => {
      if (palletsAprox != null || !/pallet/i.test(String(c)) || !/aprox/i.test(String(c))) return;
      const cand = [(rows[i] || [])[j + 1], (rows[i] || [])[j + 2], (rows[i + 1] || [])[j]];
      const v = cand.map((x) => Number(String(x ?? "").replace(",", "."))).find((n) => Number.isFinite(n) && n > 0);
      if (v != null) palletsAprox = v;
    });
  }
  return { modalidadDetectada, ordenCarga, fechaCarga, palletsAprox, clientes: Object.values(clientesMap) };
}

// Cruza un ítem del Excel con el catálogo. Devuelve el producto o null.
export function matchProducto(item, productos, categoria) {
  const n = norm(item.producto);
  if (!n) return null;
  let cands = productos.filter(
    (p) =>
      (!categoria || p.categoria === categoria) &&
      (norm(p.nombre) === n || (p.alias || []).some((a) => norm(a) === n))
  );
  // Maíz: el producto del catálogo lleva las semillas por bolsa en el nombre ("ST9939-20 80M", "ST9939-20 X 80.000").
  // Si el nombre de la orden no coincide exacto, se busca el que empieza igual y solo agrega la cantidad de semillas.
  const miles = item.semillas ? String(Math.round(Number(item.semillas) / 1000)) : "";
  const soloSemillas = (resto) => resto.replace(/\b(semillas?|sem|bolsas?|bls|mil|x|de|por)\b/g, " ").replace(/[^a-z0-9]/g, "");
  const marcaSemillas = (resto) => { const t = soloSemillas(resto); return !!miles && [miles, `${miles}m`, `${miles}k`, `${miles}000`].includes(t); };
  if (!cands.length && miles) {
    const porPrefijo = productos.filter((p) => (!categoria || p.categoria === categoria) && norm(p.nombre).startsWith(n) && marcaSemillas(`${norm(p.nombre).slice(n.length)} ${norm(p.presentacion)}`));
    if (porPrefijo.length === 1) return porPrefijo[0];
    return null;
  }
  if (cands.length > 1 && miles) {
    const porSem = cands.filter((p) => new RegExp(`(^|[^0-9])${miles}(\\.?000|m|k)?([^0-9]|$)`).test(`${norm(p.nombre)} ${norm(p.presentacion)}`));
    if (porSem.length) cands = porSem;
  }
  if (cands.length <= 1) return cands[0] || null;
  const pres = norm(item.presentacion);
  if (pres) {
    const porPres = cands.filter((p) => norm(p.presentacion) === pres || norm(p.presentacion).includes(pres) || pres.includes(norm(p.presentacion)));
    if (porPres.length) cands = porPres;
  }
  if (cands.length > 1 && item.cantidad > 0 && item.kilos > 0) {
    const kgu = item.kilos / item.cantidad;
    const porKg = cands.filter((p) => p.kg_por_unidad && Math.abs(Number(p.kg_por_unidad) - kgu) < 0.5);
    if (porKg.length) cands = porKg;
  }
  return cands[0];
}

// Cruza el depósito de la orden con una planta de la plataforma (por nombre, sin "Planta" ni acentos).
// Si el mismo depósito existe como dos plantas (una por empresa), decide la orden: maíz → Stine Seed, soja → MS Technologies.
export function matchPlanta(deposito, plantas, categoria) {
  const quitar = (t) => norm(t).replace(/^planta\s+/, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
  const d = quitar(deposito);
  if (!d) return null;
  // Solo plantas que despachan ese producto (Administración → Plantas → Despacha)
  const habil = plantas.filter((p) => !categoria || (categoria !== "soja" && categoria !== "maiz") || !p.despacha || p.despacha === "ambos" || p.despacha === categoria);
  const exactas = habil.filter((p) => quitar(p.nombre) === d);
  const cands = exactas.length ? exactas : habil.filter((p) => quitar(p.nombre) && (quitar(p.nombre).includes(d) || d.includes(quitar(p.nombre))));
  if (cands.length <= 1) return cands[0] || null;
  const empresa = categoria === "maiz" ? "stine" : categoria === "soja" ? "ms" : null;
  return (empresa && cands.find((p) => p.empresa === empresa)) || cands[0];
}
