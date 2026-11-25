// Orden de traslado cargada desde Excel (mismo formato que la de clientes; número TRAS26-MOR-006).
import { matchProducto, matchPlanta } from "./parseOrdenDeCarga";
import { EMPRESAS_DEFAULT } from "./fieldCoords";
import { norm } from "./util";

const CUITS_PROPIOS = Object.values(EMPRESAS_DEFAULT).map((e) => e.cuit);
const soloDig = (x) => String(x ?? "").replace(/\D/g, "");

// Es traslado si el número empieza con TRAS o si todos los "clientes" son la propia empresa (Stine / MS).
export function esTraslado(parsed) {
  if (/^TRAS/i.test(parsed?.ordenCarga || "")) return true;
  const cs = parsed?.clientes || [];
  return cs.length > 0 && cs.every((c) => CUITS_PROPIOS.includes(soloDig(c.cuit)));
}

// Planta de destino: la que más palabras de su nombre comparte con "Entregar en" + dirección + localidad.
const VACIAS = new Set(["planta", "deposito", "depósito", "estancia", "establecimiento", "srl", "sa", "sas", "s.a.", "s.r.l.", "de", "la", "el", "del", "y"]);
export function plantaDestino(clientes, plantas, origenId) {
  const texto = ` ${norm(clientes.map((c) => [c.entregarEn, c.domicilio, c.localidad].join(" ")).join(" ")).replace(/[^a-z0-9]+/g, " ")} `;
  let mejor = null, puntos = 0, empate = false;
  for (const p of plantas) {
    if (p.id === origenId || p.activa === false) continue;
    const pal = norm(String(p.nombre || "").split("|").join(" ")).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !VACIAS.has(w));
    const n = pal.filter((w) => texto.includes(` ${w} `)).length;
    if (n > puntos) { mejor = p; puntos = n; empate = false; } else if (n && n === puntos) empate = true;
  }
  return puntos && !empate ? mejor : null;
}

export function armarTraslado(parsed, plantas, productos, categoria) {
  const cs = parsed?.clientes || [];
  const depositos = [...new Set(cs.map((c) => c.deposito).filter(Boolean))];
  const origen = depositos.length === 1 ? matchPlanta(depositos[0], plantas, categoria) : null;
  const destino = plantaDestino(cs, plantas, origen?.id);
  const sinCatalogo = new Set();
  const lineas = [];
  for (const c of cs)
    for (const it of c.items) {
      const prod = matchProducto(it, productos, categoria);
      if (!prod) sinCatalogo.add(it.producto);
      lineas.push({ producto_id: prod?.id || null, producto_texto: it.producto, producto_nombre: prod?.nombre || "", lote_texto: it.loteOc || "", cantidad: it.cantidad, kilos: it.kilos || null, _fila: it.fila ?? 0 });
    }
  lineas.sort((a, b) => a._fila - b._fila);
  const destinoTexto = [...new Set(cs.map((c) => [c.entregarEn, c.domicilio].filter(Boolean).join(" · ")).filter(Boolean))].join(" / ");
  return { origenId: origen?.id || "", destinoId: destino?.id || "", depositos, destinoTexto, lineas, sinCatalogo: [...sinCatalogo] };
}
