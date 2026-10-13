"use client";

// Boceto del formulario preimpreso (solo se ve en pantalla, nunca se imprime).
// Sirve para ver cómo cae cada dato en su casillero. No incluye logo, encabezado
// izquierdo, CAI ni firmas.
//
// Las medidas están tomadas del formulario real (mm, origen arriba a la izquierda).
// Las posiciones de los datos ya traen compensado el corrimiento propio de la impresora,
// así que el boceto se dibuja corrido en sentido contrario: si en pantalla el dato
// cae sobre el casillero, en el papel también.
const dx = (x, y) => 1.843 - 0.00759 * x + 0.00448 * y;
const dy = (x, y) => -0.2213 - 0.002319 * x + 0.001753 * y;
const P = ([x, y]) => [x - dx(x, y), y - dy(x, y)];
const pts = (arr) => arr.map((p) => P(p).map((n) => n.toFixed(2)).join(",")).join(" ");

const COLOR = "#7d93a6";
const COLOR_TEXTO = "#8a9aa8";

// Líneas completas
const LINEAS = [
  [[15.7, 44.7], [197.6, 44.7]],
  [[15.7, 65.3], [197.6, 65.3]],
  [[15.7, 75.9], [197.6, 75.9]],
  [[15.7, 95.8], [197.6, 95.8]],
  [[15.7, 103.5], [197.6, 103.5]],
  [[15.7, 215.1], [197.6, 215.1]],
  [[15.7, 44.7], [15.7, 215.1]],
  [[197.6, 44.7], [197.6, 215.1]],
  [[49.9, 95.8], [49.9, 215.1]],
  // renglones de escritura
  [[40.1, 53.8], [121.5, 53.8]],
  [[137.2, 54.1], [195.1, 54.1]],
  [[42.9, 61.9], [122.4, 61.9]],
  [[134.6, 62.1], [195.1, 62.1]],
  [[55.1, 82.4], [136.3, 82.4]],
  [[149.9, 82.8], [195.7, 82.8]],
  [[37.2, 88.1], [92.0, 88.1]],
  [[105.7, 88.4], [142.0, 88.4]],
  [[161.9, 88.5], [195.7, 88.5]],
  [[55.9, 94.0], [114.9, 94.0]],
  [[144.4, 94.2], [194.6, 94.2]],
];

// Cajas
const CAJAS = [
  [[140.5, 27.2], [186.2, 27.2], [186.2, 35.3], [140.5, 35.3]], // fecha
  [[49.0, 217.4], [96.3, 217.4], [96.3, 227.5], [49.0, 227.5]], // total unidades
  [[150.4, 217.7], [197.5, 217.7], [197.5, 227.6], [150.4, 227.6]], // total kgs
  [[15.7, 230.4], [198.1, 230.4], [198.1, 243.1], [15.7, 243.1]], // observaciones
];
const DIV_FECHA = [153.0, 166.9];

// Rótulos: [x, y (línea de base), texto, opciones]
const RO = [
  [123.5, 32.6, "FECHA:", { s: 3.8, b: 1 }],
  [146.8, 17.0, "REMITO", { s: 5.2, b: 1, c: 1 }],
  [18.5, 54.2, "DESTINATARIO:", { s: 2.8, b: 1 }],
  [125.5, 54.2, "C.U.I.T.:", { s: 2.8, b: 1 }],
  [18.5, 62.1, "DOMICILIO:", { s: 2.8, b: 1 }],
  [125.5, 62.1, "I.V.A.:", { s: 2.8, b: 1 }],
  [18.5, 72.4, "ENTREGAR EN:", { s: 2.8, b: 1 }],
  [18.5, 82.6, "TRANSPORTISTA:", { s: 2.8, b: 1 }],
  [139.0, 82.6, "C.U.I.T.:", { s: 2.8, b: 1 }],
  [18.5, 88.4, "DOMICILIO:", { s: 2.8, b: 1 }],
  [94.0, 88.4, "CHASIS:", { s: 2.8, b: 1 }],
  [138.0, 88.4, "ACOPLADO:", { s: 2.8, b: 1 }],
  [18.5, 93.8, "NOMBRE DEL CHOFER:", { s: 2.8, b: 1 }],
  [116.5, 93.8, "C.U.I.L. / D.N.I.:", { s: 2.8, b: 1 }],
  [32.5, 101.0, "CANTIDAD", { s: 3.0, b: 1, c: 1 }],
  [122.0, 101.0, "DESCRIPCION", { s: 3.0, b: 1, c: 1 }],
  [17.5, 223.6, "TOTAL UNIDADES", { s: 3.2, b: 1 }],
  [123.0, 223.6, "TOTAL KGS./LTS.", { s: 3.2, b: 1 }],
  [17.5, 235.4, "OBSERVACIONES", { s: 3.2, b: 1 }],
];

export default function GuiaFormulario() {
  return (
    <svg
      className="no-print"
      viewBox="0 0 210 297"
      width="210mm"
      height="297mm"
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <g stroke={COLOR} strokeWidth="0.3" fill="none" strokeLinecap="square">
        {LINEAS.map((l, i) => (
          <polyline key={`l${i}`} points={pts(l)} />
        ))}
        {CAJAS.map((c, i) => (
          <polygon key={`c${i}`} points={pts(c)} />
        ))}
        {DIV_FECHA.map((x) => (
          <polyline key={x} points={pts([[x, 27.2], [x, 35.3]])} />
        ))}
      </g>
      <g fill={COLOR_TEXTO} fontFamily="Arial, sans-serif">
        {RO.filter((r) => r[2]).map(([x, y, t, o], i) => {
          const [px, py] = P([x, y]);
          return (
            <text
              key={i}
              x={px}
              y={py}
              fontSize={o.s || 3.2}
              fontWeight={o.b ? 700 : 400}
              textAnchor={o.c ? "middle" : "start"}
            >
              {t}
            </text>
          );
        })}
        {[["día", 146.8], ["mes", 159.9], ["año", 176.5]].map(([t, x]) => {
          const [px, py] = P([x, 34.4]);
          return (
            <text key={t} x={px} y={py} fontSize="2.2" textAnchor="middle">
              {t}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
