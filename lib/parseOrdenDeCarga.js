import { uid } from "./fieldCoords";
import { norm, normalizarProvincia } from "./util";

// En las órdenes las celdas sin dato vienen como 0 o "-": se tratan como vacías.
const limpio = (v) => {
  const t = String(v ?? "").trim();
  return t === "0" || t === "-" || t === "--" ? "" : t;
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
  // Número de la orden (ej. OC-SF-143 u OC-MI-182): está en las filas de arriba del encabezado.
  let ordenCarga = "";
  for (const r of rows) {
    for (const c of r || []) {
      const m = String(c ?? "").trim().match(/^OC-[A-Z]{1,4}-\d+/i);
      if (m) { ordenCarga = m[0].toUpperCase(); break; }
    }
    if (ordenCarga) break;
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
    const clave = `${cliente}||${deposito}`;
    if (!clientesMap[clave]) {
      const direccion = limpio(get(row, "direccion de entrega", "dirección de entrega"));
      const localidad = limpio(get(row, "localidad"));
      const domicilio = [direccion, localidad && !norm(direccion).includes(norm(localidad)) ? localidad : ""].filter(Boolean).join(", ");
      clientesMap[clave] = {
        clave,
        cliente,
        cuit: limpio(get(row, "cuit")),
        contacto: limpio(get(row, "contacto")),
        telefono: limpio(get(row, "telefono", "teléfono")),
        domicilio,
        provincia: normalizarProvincia(limpio(get(row, "provincia"))),
        entregarEn: limpio(get(row, "entregar en:", "entregar en")),
        deposito,
        items: [],
        totalCantidad: 0,
        totalKilos: 0,
      };
    }
    const c = clientesMap[clave];
    const kilos = Number(get(row, "kilos")) || 0;

    let producto = "";
    let presentacion = "";
    let loteOc = "";
    let extra = "";
    if (isMaiz) {
      producto = String(get(row, "hibrido", "híbrido")).trim();
      const calibre = get(row, "calibre");
      const partida = get(row, "partida");
      loteOc = String(partida || "").trim();
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

    c.items.push({ id: uid(), cantidad, kilos, producto, presentacion, loteOc, extra });
    c.totalCantidad += cantidad;
    c.totalKilos += kilos;
  }

  return { modalidadDetectada, ordenCarga, clientes: Object.values(clientesMap) };
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
export function matchPlanta(deposito, plantas) {
  const quitar = (t) => norm(t).replace(/^planta\s+/, "").replace(/\s+/g, "");
  const d = quitar(deposito);
  if (!d) return null;
  return (
    plantas.find((p) => quitar(p.nombre) === d) ||
    plantas.find((p) => quitar(p.nombre).includes(d) || d.includes(quitar(p.nombre))) ||
    null
  );
}
