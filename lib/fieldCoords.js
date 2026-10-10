// Coordenadas del calco (en mm sobre una hoja A4 210x297), calibradas sobre
// el remito preimpreso. Se ajustan en tiempo real con el panel de calibración.
export const FIELD_COORDS = {
  fechaDD: { left: 141.0, top: 27.8, width: 11.5, height: 7 },
  fechaMM: { left: 153.5, top: 27.8, width: 13.0, height: 7 },
  fechaAA: { left: 167.0, top: 27.8, width: 19.0, height: 7 },
  destinatario: { left: 41.5, top: 50.1, width: 78.0, height: 5 },
  destCuit: { left: 139.0, top: 50.1, width: 56.0, height: 5 },
  domicilio: { left: 36.0, top: 58.2, width: 84.0, height: 5 },
  destIva: { left: 139.0, top: 58.2, width: 56.0, height: 5 },
  entregarEn: { left: 42.0, top: 72.5, width: 154.0, height: 5 },
  transportista: { left: 44.5, top: 79.0, width: 93.0, height: 5 },
  transpCuit: { left: 151.0, top: 79.0, width: 44.0, height: 5 },
  transpDomicilio: { left: 36.0, top: 85.4, width: 49.0, height: 5 },
  chasis: { left: 106.0, top: 85.4, width: 30.0, height: 5 },
  acoplado: { left: 163.0, top: 85.4, width: 32.0, height: 5 },
  chofer: { left: 51.0, top: 90.5, width: 65.0, height: 5 },
  choferDni: { left: 139.0, top: 90.5, width: 56.0, height: 5 },
  tablaTop: 104.5,
  tablaBottom: 214.0,
  colCantidadLeft: 16.0,
  colCantidadWidth: 34.0,
  colDescLeft: 51.5,
  colDescWidth: 145.0,
  colKgWidth: 46.0,
  totalUnidades: { left: 50.0, top: 220.0, width: 45.0, height: 5.5 },
  totalKgs: { left: 150.0, top: 220.0, width: 47.0, height: 5.5 },
  observaciones: { left: 17.0, top: 237.0, width: 179.0, height: 6 },
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
