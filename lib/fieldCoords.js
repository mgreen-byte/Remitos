// Coordenadas del calco (en mm sobre una hoja A4 210x297), calibradas sobre
// el remito preimpreso. Se ajustan en tiempo real con el panel de calibración.
export const FIELD_COORDS = {
  fechaDD: { left: 120.0, top: 21.5, width: 15.5, height: 6 },
  fechaMM: { left: 137.0, top: 21.5, width: 18.0, height: 6 },
  fechaAA: { left: 156.0, top: 21.5, width: 12.5, height: 6 },
  destinatario: { left: 26.0, top: 49.3, width: 92.0, height: 5 },
  destCuit: { left: 127.0, top: 49.3, width: 75.0, height: 5 },
  domicilio: { left: 20.5, top: 56.3, width: 98.0, height: 5 },
  destIva: { left: 126.5, top: 56.3, width: 76.0, height: 5 },
  entregarEn: { left: 32.0, top: 73.3, width: 170.0, height: 5 },
  transportista: { left: 29.5, top: 80.3, width: 112.0, height: 5 },
  transpCuit: { left: 151.5, top: 80.3, width: 51.0, height: 5 },
  transpDomicilio: { left: 26.0, top: 87.1, width: 61.0, height: 5 },
  chasis: { left: 96.0, top: 87.1, width: 25.5, height: 5 },
  acoplado: { left: 134.5, top: 87.1, width: 68.0, height: 5 },
  chofer: { left: 32.5, top: 93.4, width: 86.0, height: 5 },
  choferDni: { left: 132.0, top: 93.4, width: 70.0, height: 5 },
  tablaTop: 105.4,
  tablaBottom: 215.0,
  colCantidadLeft: 9.5,
  colCantidadWidth: 18.5,
  colDescLeft: 31.5,
  colDescWidth: 169.0,
  totalUnidades: { left: 30.0, top: 222.5, width: 22.0, height: 5.5 },
  totalKgs: { left: 86.0, top: 222.5, width: 21.5, height: 5.5 },
  observaciones: { left: 11.0, top: 233.5, width: 189.0, height: 8 },
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
