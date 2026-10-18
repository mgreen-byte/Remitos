"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError } from "@/lib/util";

// [tabla, nombre de la hoja, columna de orden]
const TABLAS = [
  ["remitos", "Remitos", "id"],
  ["remito_items", "Items de remitos", "id"],
  ["lotes", "Lotes y stock", "id"],
  ["movimientos_stock", "Movimientos de stock", "id"],
  ["talonarios", "Talonarios", "id"],
  ["talonario_justificaciones", "Justificaciones", "id"],
  ["plantas", "Plantas", "id"],
  ["productos", "Catalogo", "id"],
  ["choferes", "Choferes", "id"],
  ["transportistas", "Transportes", "id"],
  ["cots", "COT", "id"],
  ["precios", "Precios", "id"],
  ["ordenes_carga", "Ordenes de carga", "id"],
  ["ordenes_carga_lineas", "Ordenes - lineas", "id"],
  ["ordenes_carga_log", "Ordenes - cambios", "id"],
  ["profiles", "Usuarios", "id"],
  ["configuracion", "Configuracion", "clave"],
];

const plano = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && v.length > 32000) return v.slice(0, 32000);
  return v;
};

async function traerTodo(tabla, orden) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from(tabla).select("*").order(orden).range(desde, desde + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Respaldo completo: un Excel con todas las tablas. Solo admin.
export default function ExportarTodo() {
  const [estado, setEstado] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState("");

  const exportar = async () => {
    setTrabajando(true);
    setError("");
    setResumen(null);
    const wb = XLSX.utils.book_new();
    const filasResumen = [["Hoja", "Tabla", "Filas", "Estado"]];
    try {
      for (const [tabla, hoja, orden] of TABLAS) {
        setEstado(`Descargando ${hoja}…`);
        try {
          const rows = await traerTodo(tabla, orden);
          const cols = [];
          rows.forEach((r) => Object.keys(r).forEach((k) => !cols.includes(k) && cols.push(k)));
          const ws = XLSX.utils.aoa_to_sheet([cols, ...rows.map((r) => cols.map((c) => plano(r[c])))]);
          ws["!cols"] = cols.map(() => ({ wch: 18 }));
          XLSX.utils.book_append_sheet(wb, ws, hoja.slice(0, 31));
          filasResumen.push([hoja, tabla, rows.length, "OK"]);
        } catch (e) {
          filasResumen.push([hoja, tabla, 0, "ERROR: " + friendlyError(e)]);
        }
      }
      const fecha = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const sello = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}_${pad(fecha.getHours())}${pad(fecha.getMinutes())}`;
      filasResumen.unshift([`Respaldo de Remitos generado el ${fecha.toLocaleString("es-AR")}`], []);
      const wr = XLSX.utils.aoa_to_sheet(filasResumen);
      wr["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 10 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, wr, "Resumen");
      wb.SheetNames.unshift(wb.SheetNames.pop());
      setEstado("Armando el archivo…");
      XLSX.writeFile(wb, `respaldo_remitos_${sello}.xlsx`);
      setResumen(filasResumen.slice(3));
      setEstado("");
    } catch (e) {
      setError(friendlyError(e));
    }
    setTrabajando(false);
  };

  const conError = (resumen || []).filter((r) => String(r[3]).startsWith("ERROR"));

  return (
    <section className="panel p-6 space-y-4 max-w-2xl">
      <div>
        <h2 className="paso-titulo">Respaldo completo</h2>
        <p className="paso-ayuda">
          Descarga en un solo Excel todo lo que hay en la plataforma: remitos e ítems, stock por lote, movimientos, talonarios, plantas, catálogo, choferes, transportes y usuarios. Recomendamos hacerlo una vez por semana y guardar el archivo en un lugar seguro (por ejemplo, la nube de la empresa).
        </p>
      </div>
      <button onClick={exportar} disabled={trabajando} className="btn-primario">
        {trabajando ? estado || "Preparando…" : "Exportar todo a Excel"}
      </button>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}
      {resumen && (
        <div className="space-y-2">
          <div className={`text-sm rounded p-3 border ${conError.length ? "text-amber-800 bg-amber-50 border-amber-200" : "text-emerald-800 bg-emerald-50 border-emerald-200"}`}>
            {conError.length ? "El archivo se descargó, pero algunas hojas no se pudieron leer (ver abajo)." : "Listo: el archivo se descargó con todas las hojas."}
          </div>
          <table className="w-full text-[12.5px]">
            <tbody>
              {resumen.map((r) => (
                <tr key={r[1]} className="border-t border-stone-100">
                  <td className="py-1">{r[0]}</td>
                  <td className="py-1 text-right">{r[2]} filas</td>
                  <td className={`py-1 pl-3 ${String(r[3]).startsWith("ERROR") ? "text-red-700" : "text-emerald-700"}`}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-stone-400">Los remitos nunca se borran: este archivo es una copia de seguridad, no una forma de restaurar automáticamente. Si hiciera falta recuperar datos, el Excel conserva todo.</p>
    </section>
  );
}
