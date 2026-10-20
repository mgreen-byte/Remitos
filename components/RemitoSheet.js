"use client";

import Field from "@/components/Field";
import GuiaFormulario from "@/components/GuiaFormulario";
import { FIELD_COORDS, FUENTE_REMITO } from "@/lib/fieldCoords";
import { fmtNum } from "@/lib/util";

// CUIT / CUIL / DNI se imprimen solo con números, sin guiones ni puntos.
const soloDigitos = (v) => String(v ?? "").replace(/\D/g, "");

// Hoja A4 con los datos posicionados sobre el remito preimpreso.
// Se alimenta de un objeto plano `d` (el mismo que se registra), así lo que
// se imprime es exactamente lo que queda guardado.
export default function RemitoSheet({ d, calibracion, visible = true, guia = false, corte = false }) {
  const offset = { offsetX: calibracion.offsetX, offsetY: calibracion.offsetY };
  const fs = calibracion.fontSize;
  const [yy, mm, dd] = (d.fecha || "").split("-");
  const items = (d.items || []).slice(0, 15);
  // 15 renglones iguales; se completan de arriba hacia abajo (los que sobran quedan vacíos).
  const rowH = (FIELD_COORDS.tablaBottom - FIELD_COORDS.tablaTop - 3) / 15;
  const conUnidad = items.some((it) => String(it.unidad || "").trim());
  const conKg = items.some((it) => Number(it.kgTotal) > 0);
  const unW = FIELD_COORDS.colUnidadWidth;
  const rotulo = (texto, left, width, align) => (
    <div
      style={{ position: "absolute", left: `${left + offset.offsetX}mm`, top: `${FIELD_COORDS.rotuloTop + offset.offsetY}mm`, width: `${width}mm`, fontSize: "7pt", fontWeight: 700, fontFamily: FUENTE_REMITO, color: "#111", textAlign: align, lineHeight: 1.15, padding: "0 2px" }}
    >
      {texto}
    </div>
  );
  const F = (key, value, extra = {}) => (
    <Field coords={FIELD_COORDS[key]} offset={offset} fontSize={fs} value={value ?? ""} readOnly fit={key !== "observaciones"} {...extra} />
  );
  return (
    <div
      className="print-page bg-white shadow-lg relative"
      style={{ width: "210mm", height: "297mm", flexShrink: 0, display: visible ? "block" : "none", ...(corte ? { breakAfter: "page", pageBreakAfter: "always" } : {}) }}
    >
      {guia && <GuiaFormulario />}
      {F("fechaDD", dd, { align: "center", uppercase: false })}
      {F("fechaMM", mm, { align: "center", uppercase: false })}
      {F("fechaAA", yy, { align: "center", uppercase: false })}
      {F("destinatario", d.destinatario)}
      {F("destCuit", soloDigitos(d.cuit))}
      {F("domicilio", d.domicilio)}
      {F("destIva", d.iva)}
      {F("entregarEn", d.entregarEn)}
      {F("transportista", d.transportista)}
      {F("transpCuit", soloDigitos(d.transpCuit))}
      {F("transpDomicilio", d.transpDomicilio)}
      {F("chasis", d.chasis)}
      {F("acoplado", d.acoplado)}
      {F("chofer", d.chofer)}
      {F("choferDni", soloDigitos(d.choferDni))}
      {conUnidad && rotulo("UNIDAD", FIELD_COORDS.colDescLeft, unW, "left")}
      {conKg && rotulo("KGS", FIELD_COORDS.colDescLeft + FIELD_COORDS.colDescWidth - FIELD_COORDS.colKgWidth, FIELD_COORDS.colKgWidth, "right")}
      {items.map((it, idx) => {
        const top = FIELD_COORDS.tablaTop + 2 + idx * rowH;
        const descLeft = FIELD_COORDS.colDescLeft + (conUnidad ? unW + 1 : 0);
        const descW = FIELD_COORDS.colDescWidth - FIELD_COORDS.colKgWidth - (conUnidad ? unW + 1 : 0);
        return (
          <div key={idx}>
            <Field coords={{ left: FIELD_COORDS.colCantidadLeft, top, width: FIELD_COORDS.colCantidadWidth, height: rowH }} offset={offset} fontSize={fs} align="center" uppercase={false} value={fmtNum(it.cantidad)} readOnly />
            {conUnidad && (
              <Field coords={{ left: FIELD_COORDS.colDescLeft, top, width: unW, height: rowH }} offset={offset} fontSize={fs} value={it.unidad} readOnly fit />
            )}
            <Field
              coords={{ left: descLeft, top, width: descW, height: rowH }}
              offset={offset}
              fontSize={Math.round(fs * Math.max(0.7, Math.min(1, (descW / 3.1) / Math.max(1, String(it.descripcion || "").length))) * 10) / 10}
              value={it.descripcion}
              readOnly
            />
            {Number(it.kgTotal) > 0 && (
              <Field coords={{ left: FIELD_COORDS.colDescLeft + FIELD_COORDS.colDescWidth - FIELD_COORDS.colKgWidth, top, width: FIELD_COORDS.colKgWidth, height: rowH }} offset={offset} fontSize={fs} align="right" uppercase={false} value={fmtNum(it.kgTotal)} readOnly />
            )}
          </div>
        );
      })}
      {F("ordenCarga", d.ordenCarga, { uppercase: false })}
      {F("totalUnidades", fmtNum(d.totalUnidades), { align: "center", uppercase: false })}
      {F("totalKgs", fmtNum(d.totalKgs), { align: "center", uppercase: false })}
      {F("observaciones", d.observaciones)}
    </div>
  );
}
