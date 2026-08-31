"use client";

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
}) {
  const style = {
    position: "absolute",
    left: `${coords.left + offset.offsetX}mm`,
    top: `${coords.top + offset.offsetY}mm`,
    width: `${coords.width}mm`,
    height: `${coords.height}mm`,
    fontSize: `${fontSize}pt`,
    fontFamily: "Arial, Helvetica, sans-serif",
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
