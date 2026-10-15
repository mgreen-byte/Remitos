// Coordenadas del calco (en mm sobre una hoja A4 210x297), calibradas sobre
// el remito preimpreso. Se ajustan en tiempo real con el panel de calibración.
export const FIELD_COORDS = {
  fechaDD: { left: 139.6, top: 29.6, width: 12.5, height: 6.0 },
  fechaMM: { left: 152.2, top: 29.6, width: 13.9, height: 6.0 },
  fechaAA: { left: 166.3, top: 29.7, width: 19.4, height: 6.0 },
  destinatario: { left: 39.0, top: 49.8, width: 80.0, height: 5.0 },
  destCuit: { left: 138.2, top: 50.0, width: 56.0, height: 5.0 },
  domicilio: { left: 35.0, top: 57.9, width: 84.0, height: 5.0 },
  destIva: { left: 138.2, top: 58.1, width: 56.0, height: 5.0 },
  entregarEn: { left: 42.7, top: 69.7, width: 152.0, height: 5.0 },
  transportista: { left: 42.8, top: 78.4, width: 91.0, height: 5.0 },
  transpCuit: { left: 149.6, top: 78.6, width: 45.0, height: 5.0 },
  transpDomicilio: { left: 35.0, top: 84.2, width: 54.0, height: 5.0 },
  chasis: { left: 103.7, top: 84.4, width: 35.0, height: 5.0 },
  acoplado: { left: 161.6, top: 84.5, width: 33.0, height: 5.0 },
  chofer: { left: 49.7, top: 90.0, width: 69.0, height: 5.0 },
  choferDni: { left: 143.0, top: 90.2, width: 52.0, height: 5.0 },
  tablaTop: 104.8,
  tablaBottom: 209.8, // las filas se reparten hasta acá; abajo queda el renglón de la orden de carga
  colCantidadLeft: 14.4,
  colCantidadWidth: 33.0,
  colDescLeft: 50.4,
  colDescWidth: 143.2,
  colKgWidth: 46.0,
  ordenCarga: { left: 50.1, top: 210.0, width: 120.0, height: 4.6 },
  totalUnidades: { left: 47.7, top: 220.2, width: 45.0, height: 5.5 },
  totalKgs: { left: 148.5, top: 220.4, width: 47.0, height: 5.5 },
  observaciones: { left: 48.0, top: 231.1, width: 146.0, height: 12.0 },
};

// Letra del remito impreso: Aptos Display si la computadora la tiene (viene con Microsoft 365);
// si no, Instrument Sans (la misma del sistema) y, por último, una sans-serif común.
export const FUENTE_REMITO = '"Aptos Display", "Aptos", "Instrument Sans", "Segoe UI", Arial, sans-serif';

// Empresas propias: el destinatario de un traslado entre depósitos es siempre la empresa de la planta de origen.
// (Se pueden editar en Administración → Configuración; esto es solo el valor inicial.)
export const EMPRESAS_DEFAULT = {
  ms: { nombre: "MS TECHNOLOGIES ARGENTINA S.R.L.", cuit: "30715468294", iva: "IVA Responsable Inscripto" },
  stine: { nombre: "STINE SEED ARGENTINA SRL", cuit: "30715863193", iva: "IVA Responsable Inscripto" },
};
export const EMPRESAS_ETIQUETA = { ms: "MS Technologies", stine: "Stine Seed" };

export const IVA_DEFAULT = [
  "IVA Responsable Inscripto",
  "Responsable Monotributo",
  "Exento",
  "Consumidor Final",
];

// v: versión de la calibración. Las coordenadas ya incluyen la compensación medida sobre
// la segunda prueba impresa (papel real); offsetX/offsetY quedan en 0 para ajuste fino por impresora.
// Al cambiar v, se descartan las posiciones guardadas anteriormente.
export const CALIBRACION_DEFAULT = { v: 3, offsetX: 0, offsetY: 0, fontSize: 10 };

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
