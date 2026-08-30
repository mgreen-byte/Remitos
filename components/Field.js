"use client";

export default function Field({ coords, offset, fontSize, value, onChange, textarea, align, readOnly }) {
  const style = {
    position: "absolute",
    left: `${coords.left + offset.offsetX}mm`,
    top: `${coords.top + offset.offsetY}mm`,
    width: `${coords.width}mm`,
    height: `${coords.height}mm`,
    fontSize: `${fontSize}pt`,
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "#111",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: 0,
    lineHeight: 1.15,
    resize: "none",
    textAlign: align || "left",
  };
  if (readOnly) {
    return (
      <div style={style} className="whitespace-pre-wrap overflow-hidden">
        {value}
      </div>
    );
  }
  return textarea ? (
    <textarea style={style} value={value} onChange={onChange} />
  ) : (
    <input style={style} value={value} onChange={onChange} />
  );
}
