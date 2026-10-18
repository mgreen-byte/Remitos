import { matchProducto, matchPlanta } from "./parseOrdenDeCarga";
import { norm } from "./util";

// Convierte lo que leyó parseOrdenDeCarga (clientes con ítems) en renglones planos para guardar la orden.
// Devuelve además los avisos: depósitos que no se reconocen y variedades que no están en el catálogo.
export function armarLineas(parsed, plantas, productos, categoria = "soja") {
  const lineas = [];
  const depositosSinPlanta = new Set();
  const sinCatalogo = new Set();
  for (const c of parsed?.clientes || []) {
    const planta = matchPlanta(c.deposito, plantas);
    if (!planta && c.deposito) depositosSinPlanta.add(c.deposito);
    for (const it of c.items) {
      const prod = matchProducto(it, productos, categoria);
      if (!prod) sinCatalogo.add(it.producto);
      lineas.push({
        planta_id: planta?.id || null,
        deposito: c.deposito || "",
        cliente: c.cliente,
        cuit: c.cuit || "",
        contacto: c.contacto || "",
        telefono: c.telefono || "",
        domicilio: c.domicilio || "",
        provincia: c.provincia || "",
        entregar_en: c.entregarEn || "",
        ov: it.ov || "",
        producto_id: prod?.id || null,
        producto_texto: it.producto,
        presentacion: it.presentacion || "",
        lote_texto: it.loteOc || "",
        cantidad: it.cantidad,
        kilos: it.kilos || null,
      });
    }
  }
  return { lineas, depositosSinPlanta: [...depositosSinPlanta], sinCatalogo: [...sinCatalogo] };
}

// Renglones para mandar a la base (sin los campos auxiliares de la vista previa).
export const lineasParaGuardar = (lineas) =>
  lineas
    .filter((l) => l.planta_id)
    .map(({ deposito, ...resto }) => ({ ...resto, producto_id: resto.producto_id || null }));

// Agrupa las líneas por cliente + planta (un remito por grupo).
export function agruparPorCliente(lineas) {
  const m = new Map();
  for (const l of lineas) {
    const k = `${l.planta_id}||${norm(l.cliente)}`;
    if (!m.has(k)) m.set(k, { key: k, planta_id: l.planta_id, planta_nombre: l.planta_nombre, cliente: l.cliente, items: [] });
    m.get(k).items.push(l);
  }
  return [...m.values()];
}
