"use client";

import Field from "@/components/Field";
import { FIELD_COORDS } from "@/lib/fieldCoords";
import { fmtNum } from "@/lib/util";

// Hoja A4 con los datos posicionados sobre el remito preimpreso.
// Se alimenta de un objeto plano `d` (el mismo que se registra), así lo que
// se imprime es exactamente lo que queda guardado.
export default function RemitoSheet({ d, calibracion, visible = true }) {
  const offset = { offsetX: calibracion.offsetX, offsetY: calibracion.offsetY };
  const fs = calibracion.fontSize;
  const [yy, mm, dd] = (d.fecha || "").split("-");
  const items = (d.items || []).slice(0, 15);
  const rowH = (FIELD_COORDS.tablaBottom - FIELD_COORDS.tablaTop - 3) / Math.max(items.length, 6);
  const F = (key, value, extra = {}) => (
    <Field coords={FIELD_COORDS[key]} offset={offset} fontSize={fs} value={value ?? ""} readOnly {...extra} />
  );
  return (
    <div
      className="print-page bg-white shadow-lg relative"
      style={{ width: "210mm", height: "297mm", flexShrink: 0, display: visible ? "block" : "none" }}
    >
      {F("fechaDD", dd, { align: "center", uppercase: false })}
      {F("fechaMM", mm, { align: "center", uppercase: false })}
      {F("fechaAA", yy, { align: "center", uppercase: false })}
      {F("destinatario", d.destinatario)}
      {F("destCuit", d.cuit)}
      {F("domicilio", d.domicilio)}
      {F("destIva", d.iva)}
      {F("entregarEn", d.entregarEn)}
      {F("transportista", d.transportista)}
      {F("transpCuit", d.transpCuit)}
      {F("transpDomicilio", d.transpDomicilio)}
      {F("chasis", d.chasis)}
      {F("acoplado", d.acoplado)}
      {F("chofer", d.chofer)}
      {F("choferDni", d.choferDni)}
      {items.map((it, idx) => {
        const top = FIELD_COORDS.tablaTop + 2 + idx * rowH;
        return (
          <div key={idx}>
            <Field
              coords={{ left: FIELD_COORDS.colCantidadLeft, top, width: FIELD_COORDS.colCantidadWidth, height: rowH }}
              offset={offset}
              fontSize={fs}
              align="center"
              uppercase={false}
              value={fmtNum(it.cantidad)}
              readOnly
            />
            <Field
              coords={{ left: FIELD_COORDS.colDescLeft, top, width: FIELD_COORDS.colDescWidth - FIELD_COORDS.colKgWidth, height: rowH }}
              offset={offset}
              fontSize={Math.round(fs * Math.max(0.7, Math.min(1, 46 / String(it.descripcion || "").length)) * 10) / 10}
              value={it.descripcion}
              readOnly
            />
            {Number(it.kgUnidad) > 0 && (
              <Field
                coords={{ left: FIELD_COORDS.colDescLeft + FIELD_COORDS.colDescWidth - FIELD_COORDS.colKgWidth, top, width: FIELD_COORDS.colKgWidth, height: rowH }}
                offset={offset}
                fontSize={fs}
                align="right"
                uppercase={false}
                value={`${fmtNum(it.cantidad * it.kgUnidad)} kg`}
                readOnly
              />
            )}
          </div>
        );
      })}
      {F("totalUnidades", fmtNum(d.totalUnidades), { align: "center", uppercase: false })}
      {F("totalKgs", fmtNum(d.totalKgs), { align: "center", uppercase: false })}
      {F("observaciones", d.observaciones)}
    </div>
  );
}
