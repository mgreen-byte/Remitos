"use client";
// Alta masiva desde Excel para tablas simples de Administración (Áreas, Lugares, Tipos de carga, Listas contables).
// Usa las mismas columnas que la tabla: baja una plantilla, lee el Excel, muestra la vista previa y guarda.
import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, norm, up } from "@/lib/util";

const nh = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const SI = new Set(["si", "s", "x", "1", "true", "verdadero", "activo", "activa"]);
const NO = new Set(["no", "n", "0", "false", "falso", "inactivo", "inactiva"]);

// columns: las de CrudTable. clave: campos que identifican una fila (para detectar las que ya existen).
export default function ImportarTabla({ table, titulo, columns, clave = ["nombre"], existentes = [], ejemplo = [], onClose, onDone }) {
  const [filas, setFilas] = useState(null);
  const [archivo, setArchivo] = useState("");
  const [errorArchivo, setErrorArchivo] = useState("");
  const [actualizar, setActualizar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const cols = columns.filter((c) => ["text", "select", "bool", "number"].includes(c.type));
  const etiqueta = (c) => c.label.replace(/\s*\(.*\)\s*$/, "");
  const claveDe = (r) => clave.map((k) => nh(r[k])).join("|");
  const yaEstan = new Map(existentes.map((r) => [claveDe(r), r]));

  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new();
    const filasEj = ejemplo.map((e) => cols.map((c) => {
      const v = e[c.key];
      if (c.type === "bool") return v === false ? "No" : "Sí";
      if (c.type === "select") return c.options.find((o) => o.value === v)?.label ?? v ?? "";
      return v ?? "";
    }));
    const ws = XLSX.utils.aoa_to_sheet([cols.map(etiqueta), ...filasEj]);
    ws["!cols"] = cols.map((c) => ({ wch: Math.max(12, etiqueta(c).length + 4, c.type === "text" ? 24 : 12) }));
    XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 30));
    const ayuda = [["Cómo completar"], ["Una fila por registro. La primera fila son los títulos (no los cambies)."]];
    cols.forEach((c) => {
      if (c.type === "select") ayuda.push([`${etiqueta(c)}: ${c.options.map((o) => o.label).join(" / ")}${c.nullable ? " (opcional)" : ""}.`]);
      else if (c.type === "bool") ayuda.push([`${etiqueta(c)}: Sí o No (vacío = Sí).`]);
      else if (c.nullable) ayuda.push([`${etiqueta(c)}: opcional.`]);
    });
    ayuda.push([`Si ya existe uno con el mismo ${clave.map((k) => etiqueta(cols.find((c) => c.key === k) || { label: k })).join(" + ")}, se saltea (o se actualiza, si tildás esa opción al importar).`]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ayuda), "Instrucciones");
    XLSX.writeFile(wb, `Plantilla-${titulo.replace(/\s+/g, "-")}.xlsx`);
  };

  const leer = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErrorArchivo(""); setResultado(null); setArchivo(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
      const hi = rows.findIndex((r) => r.some((x) => cols.some((c) => nh(x) === nh(etiqueta(c)) || nh(x) === nh(c.label))));
      if (hi < 0) throw new Error("No encuentro los títulos de las columnas. Usá la plantilla.");
      const idx = {};
      rows[hi].forEach((x, i) => { const c = cols.find((c) => nh(x) === nh(etiqueta(c)) || nh(x) === nh(c.label)); if (c && idx[c.key] === undefined) idx[c.key] = i; });
      const falta = cols.filter((c) => !c.nullable && c.type !== "bool" && idx[c.key] === undefined && clave.includes(c.key));
      if (falta.length) throw new Error(`Falta la columna: ${falta.map(etiqueta).join(", ")}.`);
      const out = [];
      rows.slice(hi + 1).forEach((r, n) => {
        if (!r.some((x) => String(x).trim())) return;
        const d = {}; const errs = [];
        cols.forEach((c) => {
          const raw = idx[c.key] === undefined ? "" : String(r[idx[c.key]] ?? "").trim();
          if (c.type === "bool") { const k = nh(raw); d[c.key] = !raw ? true : SI.has(k) ? true : NO.has(k) ? false : (errs.push(`${etiqueta(c)}: “${raw}” (Sí o No)`), true); return; }
          if (c.type === "select") {
            if (!raw) { if (c.nullable) d[c.key] = null; else if (idx[c.key] === undefined) d[c.key] = c.options[0]?.value; else errs.push(`Falta ${etiqueta(c)}`); return; }
            const o = c.options.find((o) => nh(o.label) === nh(raw) || nh(o.value) === nh(raw)) || c.options.find((o) => nh(o.label).startsWith(nh(raw)));
            if (o) d[c.key] = o.value; else errs.push(`${etiqueta(c)}: “${raw}” no es una opción`);
            return;
          }
          if (c.type === "number") { if (!raw) { d[c.key] = null; return; } const v = Number(raw.replace(/\./g, "").replace(",", ".")); if (Number.isFinite(v)) d[c.key] = v; else errs.push(`${etiqueta(c)}: “${raw}” no es un número`); return; }
          const v = c.upper ? up(raw) : raw;
          if (!v && !c.nullable) { if (idx[c.key] !== undefined || clave.includes(c.key)) errs.push(`Falta ${etiqueta(c)}`); d[c.key] = ""; return; }
          d[c.key] = v || null;
        });
        out.push({ fila: hi + n + 2, d, errs });
      });
      // Repetidos dentro del mismo Excel
      const vistos = new Set();
      out.forEach((x) => { const k = claveDe(x.d); if (!x.errs.length && vistos.has(k)) x.errs.push("Repetido en el Excel"); vistos.add(k); });
      if (!out.length) throw new Error("El Excel no tiene filas para importar.");
      setFilas(out);
    } catch (err) { setFilas(null); setErrorArchivo(err.message || String(err)); }
  };

  const ok = (filas || []).filter((x) => !x.errs.length);
  const nuevas = ok.filter((x) => !yaEstan.has(claveDe(x.d)));
  const repetidas = ok.filter((x) => yaEstan.has(claveDe(x.d)));

  const guardar = async () => {
    setGuardando(true);
    let alta = 0, act = 0; const fallas = [];
    for (let i = 0; i < nuevas.length; i += 200) {
      const lote = nuevas.slice(i, i + 200).map((x) => x.d);
      const { error } = await supabase.from(table).insert(lote);
      if (error) { fallas.push(friendlyError(error)); break; }
      alta += lote.length;
    }
    if (actualizar) {
      for (const x of repetidas) {
        const { error } = await supabase.from(table).update(x.d).eq("id", yaEstan.get(claveDe(x.d)).id);
        if (error) { fallas.push(`Fila ${x.fila}: ${friendlyError(error)}`); continue; }
        act++;
      }
    }
    setGuardando(false);
    setResultado({ alta, act, fallas });
    setFilas(null);
    onDone && onDone();
  };

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/40 p-3 space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-800">Importar {titulo.toLowerCase()} desde Excel</span>
        <button onClick={onClose} className="ml-auto text-[12px] text-stone-500 underline">Cerrar</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={descargarPlantilla} className="btn-secundario">1. Bajar plantilla</button>
        <label className="btn-secundario cursor-pointer">2. Elegir el Excel completo<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={leer} className="hidden" /></label>
        {archivo && <span className="text-stone-500">{archivo}</span>}
      </div>
      {errorArchivo && <div className="text-red-700">{errorArchivo}</div>}
      {resultado && (
        <div className={resultado.fallas.length ? "text-red-700" : "text-emerald-700"}>
          Listo: {resultado.alta} nuevo(s){resultado.act ? `, ${resultado.act} actualizado(s)` : ""}.{resultado.fallas.length ? ` Problemas: ${resultado.fallas.join(" · ")}` : ""}
        </div>
      )}
      {filas && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><b>{nuevas.length}</b> nuevo(s)</span>
            <span><b>{repetidas.length}</b> ya existen</span>
            {filas.length - ok.length > 0 && <span className="text-red-700"><b>{filas.length - ok.length}</b> con errores (no se importan)</span>}
          </div>
          {repetidas.length > 0 && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} /> Actualizar los que ya existen con los datos del Excel (si no, se saltean)</label>
          )}
          <div className="max-h-80 overflow-auto rounded border border-stone-200 bg-white">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-stone-50"><tr className="text-left text-stone-500"><th className="p-1.5">Fila</th>{cols.map((c) => <th key={c.key} className="p-1.5">{etiqueta(c)}</th>)}<th className="p-1.5">Estado</th></tr></thead>
              <tbody>
                {filas.map((x) => {
                  const ya = !x.errs.length && yaEstan.has(claveDe(x.d));
                  return (
                    <tr key={x.fila} className={`border-t border-stone-100 ${x.errs.length ? "bg-red-50" : ""}`}>
                      <td className="p-1.5 text-stone-400">{x.fila}</td>
                      {cols.map((c) => <td key={c.key} className="p-1.5">{c.type === "bool" ? (x.d[c.key] ? "Sí" : "No") : c.type === "select" ? c.options.find((o) => o.value === x.d[c.key])?.label || "" : String(x.d[c.key] ?? "")}</td>)}
                      <td className="p-1.5">{x.errs.length ? <span className="text-red-700">{x.errs.join(" · ")}</span> : ya ? <span className="text-stone-500">{actualizar ? "se actualiza" : "ya existe"}</span> : <span className="text-emerald-700">nuevo</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button disabled={guardando || (!nuevas.length && !(actualizar && repetidas.length))} onClick={guardar} className="px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50">
              {guardando ? "Guardando…" : `Importar ${nuevas.length + (actualizar ? repetidas.length : 0)}`}
            </button>
            <button onClick={() => setFilas(null)} className="px-3 py-1.5 text-stone-500">Descartar</button>
          </div>
        </>
      )}
    </div>
  );
}
