import { uid } from "./fieldCoords";
import { norm } from "./util";

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
    const cliente = String(get(row, "cliente")).trim();
    if (!cliente) continue;
    if (!clientesMap[cliente]) {
      clientesMap[cliente] = {
        cliente,
        cuit: get(row, "cuit"),
        contacto: get(row, "contacto"),
        telefono: get(row, "telefono", "teléfono"),
        domicilio: get(row, "direccion de entrega", "dirección de entrega"),
        entregarEn: get(row, "entregar en:", "entregar en"),
        deposito: get(row, "deposito", "depósito"),
        items: [],
        totalCantidad: 0,
        totalKilos: 0,
      };
    }
    const c = clientesMap[cliente];
    const cantidad = Number(get(row, "cantidad")) || 0;
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
      const precinto = get(row, "precinto");
      extra = precinto ? `PRECINTO ${precinto}` : "";
    } else {
      producto = String(get(row, "descripcion", "descripción", "producto")).trim();
    }

    c.items.push({ id: uid(), cantidad, kilos, producto, presentacion, loteOc, extra });
    c.totalCantidad += cantidad;
    c.totalKilos += kilos;
  }

  return { modalidadDetectada, clientes: Object.values(clientesMap) };
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
