// Coordenadas del calco (en mm sobre una hoja A4 210x297), calibradas sobre
// el remito preimpreso. Se ajustan en tiempo real con el panel de calibración.
export const FIELD_COORDS = {
  fechaDD: { left: 140.5, top: 29.1, width: 12.5, height: 6 },
  fechaMM: { left: 153.0, top: 29.1, width: 13.9, height: 6 },
  fechaAA: { left: 166.9, top: 29.1, width: 19.4, height: 6 },
  destinatario: { left: 40.5, top: 49.8, width: 80.0, height: 5 },
  destCuit: { left: 139.0, top: 49.8, width: 56.0, height: 5 },
  domicilio: { left: 36.5, top: 57.9, width: 84.0, height: 5 },
  destIva: { left: 139.0, top: 57.9, width: 56.0, height: 5 },
  entregarEn: { left: 44.0, top: 69.3, width: 152.0, height: 5 },
  transportista: { left: 44.3, top: 78.4, width: 91.0, height: 5 },
  transpCuit: { left: 150.5, top: 78.4, width: 45.0, height: 5 },
  transpDomicilio: { left: 36.7, top: 84.3, width: 54.0, height: 5 },
  chasis: { left: 105.0, top: 84.3, width: 35.0, height: 5 },
  acoplado: { left: 162.5, top: 84.3, width: 33.0, height: 5 },
  chofer: { left: 51.3, top: 90.0, width: 69.0, height: 5 },
  choferDni: { left: 144.0, top: 90.0, width: 52.0, height: 5 },
  tablaTop: 104.5,
  tablaBottom: 209.5, // las filas se reparten hasta acá; abajo queda el renglón de la orden de carga
  colCantidadLeft: 16.0,
  colCantidadWidth: 33.0,
  colDescLeft: 51.5,
  colDescWidth: 143.0,
  colKgWidth: 46.0,
  ordenCarga: { left: 50.0, top: 209.9, width: 120.0, height: 4.6 },
  totalUnidades: { left: 50.0, top: 220.2, width: 45.0, height: 5.5 },
  totalKgs: { left: 150.0, top: 220.2, width: 47.0, height: 5.5 },
  observaciones: { left: 50.0, top: 231.0, width: 146.0, height: 12.0 },
};

export const IVA_DEFAULT = [
  "IVA Responsable Inscripto",
  "Responsable Monotributo",
  "Exento",
  "Consumidor Final",
];

// v: versión de la calibración. offsetX/offsetY compensan el corrimiento propio de la impresora
// (medido en la primera prueba sobre papel: el texto salía ~4,8 mm a la derecha y ~2,2 mm abajo).
// Al cambiar v, se descartan las posiciones guardadas anteriormente.
export const CALIBRACION_DEFAULT = { v: 2, offsetX: -4.8, offsetY: -2.2, fontSize: 10 };

export const MODALIDADES = [
  { id: "soja", label: "OC · Soja" },
  { id: "maiz", label: "OC · Maíz" },
  { id: "generico", label: "Genérico" },
  { id: "traslado", label: "Traslado entre plantas" },
];

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function todayParts() {
  const d = new Date();
  return {
    dd: String(d.getDate()).padStart(2, "0"),
    mm: String(d.getMonth() + 1).padStart(2, "0"),
    aa: String(d.getFullYear()),
  };
}
