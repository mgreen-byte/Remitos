import { uid } from "./fieldCoords";

function norm(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// El Excel nunca se guarda: se recibe como array-of-arrays (ya leído por
// SheetJS en el navegador del usuario) y se procesa entero en memoria.
export function parseOrdenDeCarga(rows) {
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || []).some((c) => norm(c) === "cliente")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error(
      "No encontré una columna 'Cliente' en el archivo. ¿Es una orden de carga válida?"
    );
  }
  const headers = (rows[headerRowIdx] || []).map((h) => (h || "").toString().trim());
  const hIndex = {};
  headers.forEach((h, i) => {
    if (h) hIndex[norm(h)] = i;
  });

  const get = (row, ...names) => {
    for (const n of names) {
      const idx = hIndex[norm(n)];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "")
        return row[idx];
    }
    return "";
  };

  const isMaiz = "hibrido" in hIndex;
  const isSoja = "variedad" in hIndex;
  const modalidadDetectada = isMaiz ? "maiz" : isSoja ? "soja" : "desconocida";

  const dataRows = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cliente = get(row, "cliente");
    if (!cliente) continue;
    dataRows.push(row);
  }

  const clientesMap = {};
  dataRows.forEach((row) => {
    const cliente = String(get(row, "cliente")).trim();
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

    let desc = "";
    if (isMaiz) {
      const hibrido = get(row, "hibrido", "híbrido");
      const calibre = get(row, "calibre");
      const partida = get(row, "partida");
      desc = [hibrido, calibre ? `Calibre ${calibre}` : "", partida ? `Partida ${partida}` : ""]
        .filter(Boolean)
        .join(" · ");
    } else if (isSoja) {
      const variedad = get(row, "variedad");
      const presentacion = get(row, "presentacion", "presentación");
      const lote = get(row, "pilote /lote", "pilote/lote", "lote");
      const precinto = get(row, "precinto");
      desc = [
        variedad,
        presentacion,
        lote ? `Lote ${lote}` : "",
        precinto ? `Precinto ${precinto}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      desc = get(row, "descripcion", "descripción", "producto");
    }

    c.items.push({ id: uid(), cantidad, descripcion: desc });
    c.totalCantidad += cantidad;
    c.totalKilos += kilos;
  });

  return { modalidadDetectada, clientes: Object.values(clientesMap) };
}
