import { generarRemitoPdf, descargarBlob, EMPRESA_FISCAL } from "@/lib/remitoPdf";
import { observacionesImpresas, ordenCargaImpresa } from "@/lib/util";
import { gpsDeRemito, normalizarGps } from "@/lib/qr";

// Arma y descarga el PDF de un remito ya registrado (fila de `remitos` con `remito_items`).
// `leyenda`: texto chico al pie (ej. "REIMPRESIÓN DIGITAL"); vacío al emitir.
export async function descargarPdfDeRemito(supabase, r, { leyenda = "", gps = "" } = {}) {
  const [{ data: planta }, { data: tal }] = await Promise.all([
    supabase.from("plantas").select("nombre, empresa, domicilio_fiscal, punto_venta").eq("id", r.planta_id).single(),
    r.talonario_id ? supabase.from("talonarios").select("*").eq("id", r.talonario_id).single() : Promise.resolve({ data: null }),
  ]);
  // Autoimpresión: el remito no tiene talonario con rango ni imprenta; lleva la leyenda del CAI.
  let auto = null;
  if (r.talonario_auto_id) {
    const { data } = await supabase.from("talonarios_autoimpresion").select("*").eq("id", r.talonario_auto_id).single();
    auto = data;
  }
  if (!planta) throw new Error("No se pudo leer la planta del remito.");
  if (!EMPRESA_FISCAL[planta.empresa]) throw new Error("La planta no tiene empresa asignada (MS Technologies o Stine Seed): completá el campo Empresa en Administración → Plantas.");
  if (!planta.domicilio_fiscal && !EMPRESA_FISCAL[planta.empresa].domicilioFiscal) throw new Error(`Falta la dirección fiscal de la planta ${planta.nombre}: cargala en Administración → Plantas.`);
  if (r.talonario_auto_id && !auto) throw new Error("No se pudo leer el talonario de autoimpresión del remito.");
  if (auto && !String(auto.leyenda || "").trim()) throw new Error("Falta la leyenda del CAI en el talonario de autoimpresión: cargala en Talonarios → Autoimpresión.");
  if (!auto && (!tal || !r.cai)) throw new Error("Este remito no tiene talonario ni CAI asociado (se emitió con el control de talonarios apagado), no se puede armar el PDF.");
  if (!auto && !tal.imprenta_nombre) throw new Error("Faltan los datos de la imprenta del talonario: completalos en Talonarios → Editar.");

  const items = [...(r.remito_items || [])].sort((a, b) => a.orden - b.orden).map((i) => ({ cantidad: i.cantidad, unidad: i.unidad, descripcion: i.descripcion, kgTotal: i.kg_total }));
  const d = {
    fecha: r.fecha,
    destinatario: r.cliente_nombre,
    cuit: r.cliente_cuit,
    domicilio: r.cliente_domicilio,
    iva: r.cliente_iva,
    entregarEn: r.entregar_en,
    transportista: r.transportista_nombre,
    transpCuit: r.transportista_cuit,
    transpDomicilio: r.transportista_domicilio,
    chasis: r.chasis,
    acoplado: r.acoplado,
    chofer: r.chofer_nombre,
    choferDni: r.chofer_cuil,
    items,
    totalUnidades: r.total_unidades,
    totalKgs: r.total_kgs,
    observaciones: observacionesImpresas({ cot: r.cot, observaciones: r.observaciones }),
    ordenCarga: ordenCargaImpresa(r.orden_carga, r.orden_salida),
    gps: normalizarGps(gps) || gpsDeRemito(r),
  };
  const blob = await generarRemitoPdf(d, {
    pv: r.punto_venta,
    numero: r.numero,
    empresa: planta.empresa,
    domicilioFiscal: planta.domicilio_fiscal,
    cai: r.cai || tal?.cai || auto?.cai,
    caiVencimiento: r.cai_vencimiento || tal?.cai_vencimiento || auto?.cai_vencimiento,
    desde: tal?.desde,
    hasta: tal?.hasta,
    imprenta: tal ? { nombre: tal.imprenta_nombre, domicilio: tal.imprenta_domicilio, cuit: tal.imprenta_cuit, habilitacion: tal.imprenta_habilitacion, fechaImpresion: tal.fecha_impresion } : {},
    leyendaCai: auto ? String(auto.leyenda).trim() : "",
    leyenda,
  });
  descargarBlob(blob, `Remito_${r.punto_venta}-${r.numero}.pdf`);
}
