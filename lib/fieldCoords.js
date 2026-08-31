// Coordenadas del calco (en mm sobre una hoja A4 210x297), calibradas sobre
// el remito preimpreso. Se ajustan en tiempo real con el panel de calibración.
export const FIELD_COORDS = {
  fechaDD: { left: 127.0, top: 29.0, width: 20.0, height: 7 },
  fechaMM: { left: 148.0, top: 29.0, width: 16.5, height: 7 },
  fechaAA: { left: 165.0, top: 29.0, width: 18.0, height: 7 },
  destinatario: { left: 36.0, top: 51.8, width: 82.0, height: 5 },
  destCuit: { left: 137.0, top: 51.8, width: 58.0, height: 5 },
  domicilio: { left: 30.5, top: 58.8, width: 88.0, height: 5 },
  destIva: { left: 136.5, top: 58.8, width: 58.0, height: 5 },
  entregarEn: { left: 42.0, top: 75.3, width: 160.0, height: 5 },
  transportista: { left: 39.5, top: 73.8, width: 102.0, height: 5 },
  transpCuit: { left: 161.5, top: 73.8, width: 34.0, height: 5 },
  transpDomicilio: { left: 36.0, top: 78.6, width: 51.0, height: 5 },
  chasis: { left: 106.0, top: 78.6, width: 25.5, height: 5 },
  acoplado: { left: 144.5, top: 78.6, width: 58.0, height: 5 },
  chofer: { left: 42.5, top: 84.9, width: 76.0, height: 5 },
  choferDni: { left: 142.0, top: 84.9, width: 60.0, height: 5 },
  tablaTop: 99.9,
  tablaBottom: 209.5,
  colCantidadLeft: 19.5,
  colCantidadWidth: 18.5,
  colDescLeft: 41.5,
  colDescWidth: 159.0,
  totalUnidades: { left: 40.0, top: 216.0, width: 22.0, height: 5.5 },
  totalKgs: { left: 147.0, top: 216.0, width: 34.0, height: 5.5 },
  observaciones: { left: 21.0, top: 227.0, width: 179.0, height: 8 },
};

export const IVA_DEFAULT = [
  "IVA Responsable Inscripto",
  "Responsable Monotributo",
  "Exento",
  "Consumidor Final",
];

export const CALIBRACION_DEFAULT = { offsetX: 0, offsetY: 0, fontSize: 10 };

export const MODALIDADES = [
  { id: "soja", label: "OC · Soja" },
  { id: "maiz", label: "OC · Maíz" },
  { id: "generico", label: "Genérico" },
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
