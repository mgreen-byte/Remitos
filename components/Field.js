"use client";

import { FUENTE_REMITO } from "@/lib/fieldCoords";

export default function Field({
  coords,
  offset,
  fontSize,
  value,
  onChange,
  textarea,
  align,
  readOnly,
  uppercase = true,
  fit = false,
}) {
  const style = {
    position: "absolute",
    left: `${coords.left + offset.offsetX}mm`,
    top: `${coords.top + offset.offsetY}mm`,
    width: `${coords.width}mm`,
    height: `${coords.height}mm`,
    fontSize: `${fontSize}pt`,
    fontFamily: FUENTE_REMITO,
    color: "#111",
    background: readOnly ? "transparent" : "rgba(16, 185, 129, 0.04)",
    border: readOnly ? "none" : "1px dashed rgba(5, 150, 105, 0.35)",
    outline: "none",
    padding: "0 2px",
    lineHeight: 1.15,
    resize: "none",
    textAlign: align || "left",
    textTransform: uppercase ? "uppercase" : "none",
  };

  const handleChange = (e) => {
    if (!onChange) return;
    if (uppercase) {
      const upper = e.target.value.toUpperCase();
      onChange({ ...e, target: { ...e.target, value: upper } });
    } else {
      onChange(e);
    }
  };

  if (readOnly) {
    if (fit) {
      // Una sola línea: si el texto es largo, se achica la letra (hasta 60%) para que entre en el casillero.
      const largo = String(value ?? "").length;
      const mmDisponibles = coords.width - 1.4;
      const mmPorLetra = fontSize * 0.3528 * (uppercase ? 0.62 : 0.55);
      const escala = largo > 0 ? Math.max(0.6, Math.min(1, mmDisponibles / (largo * mmPorLetra))) : 1;
      style.fontSize = `${Math.round(fontSize * escala * 10) / 10}pt`;
      return (
        <div style={style} className="whitespace-nowrap overflow-hidden field-print">
          {value}
        </div>
      );
    }
    return (
      <div style={style} className="whitespace-pre-wrap overflow-hidden field-print">
        {value}
      </div>
    );
  }
  return textarea ? (
    <textarea style={style} value={value} onChange={handleChange} className="field-print" />
  ) : (
    <input style={style} value={value} onChange={handleChange} className="field-print" />
  );
}
