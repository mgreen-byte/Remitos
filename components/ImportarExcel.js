"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, norm, up, fmtCuit } from "@/lib/util";

const normHeader = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

function limpiar(c, valor) {
  let v = valor;
  if (typeof v === "number") v = Number.isInteger(v) ? String(v) : String(Math.round(v));
  v = (v ?? "").toString().trim();
  if (c.upper) v = up(v);
  if (c.compact) v = v.replace(/[\s.\-]/g, "");
  if (c.digits) v = v.replace(/\D/g, "");
  return v;
}

// Importación masiva desde Excel o CSV. Valida todo antes de guardar.
export default function ImportarExcel({ table, singular, columns, claveUnica, existentes, onClose, onDone }) {
  const [filas, setFilas] = useState(null); // [{n, datos, estado, motivo, existenteId}]
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [errorArchivo, setErrorArchivo] = useState("");
  const [actualizar, setActualizar] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [resultado, setResultado] = useState(null);
  const claveCol = columns.find((c) => c.key === claveUnica);
  const plural = singular.toLowerCase() + "s";

  const descargarPlantilla = () => {
    const encabezados = columns.map((c) => c.label.replace(/ \(.*\)$/, ""));
    const ejemplo = columns.map((c) => c.ejemplo || "");
    const ws = XLSX.utils.aoa_to_sheet([encabezados, ejemplo]);
    ws["!cols"] = columns.map(() => ({ wch: 28 }));
    // columnas de CUIT/CUIL como texto para no perder dígitos
    columns.forEach((c, i) => {
      if (c.digits) {
        const ref = XLSX.utils.encode_cell({ r: 1, c: i });
        if (ws[ref]) ws[ref].t = "s";
      }
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, singular);
    XLSX.writeFile(wb, `plantilla_${table}.xlsx`);
  };

  const leerArchivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNombreArchivo(file.name);
    setErrorArchivo("");
    setFilas(null);
    setResultado(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array", raw: true });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
        setFilas(procesar(rows));
      } catch (err) {
        setErrorArchivo(err.message || "No pude leer el archivo.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const procesar = (rows) => {
    // 1) encabezados: primera fila con al menos una columna reconocida
    const aliasDe = (c) => [c.label, c.key, ...(c.aliases || [])].map(normHeader);
    let hIdx = -1;
    let mapa = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const m = {};
      (rows[i] || []).forEach((h, j) => {
        const nh = normHeader(h);
        if (!nh) return;
        const col = columns.find((c) => aliasDe(c).includes(nh));
        if (col && m[col.key] === undefined) m[col.key] = j;
      });
      if (Object.keys(m).length >= 2 || (Object.keys(m).length === 1 && m.nombre !== undefined)) {
        hIdx = i;
        mapa = m;
        break;
      }
    }
    if (hIdx === -1 || mapa.nombre === undefined) {
      throw new Error(`No encontré los encabezados. La primera fila tiene que incluir al menos: ${columns.filter((c) => c.required).map((c) => c.label).join(", ")}. Descargá la plantilla para ver el formato.`);
    }

    const porClave = new Map();
    existentes.forEach((r) => {
      const k = claveUnica && r[claveUnica] ? String(r[claveUnica]) : "n:" + norm(r.nombre);
      porClave.set(k, r.id);
    });
    const vistos = new Set();
    const out = [];
    for (let i = hIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every((x) => String(x ?? "").trim() === "")) continue;
      const datos = {};
      columns.forEach((c) => {
        datos[c.key] = mapa[c.key] === undefined ? "" : limpiar(c, row[mapa[c.key]]);
      });
      const n = i + 1; // número de fila en el Excel
      let estado = "nuevo";
      let motivo = "";
      for (const c of columns) {
        if (c.required && !datos[c.key]) {
          estado = "error";
          motivo = `Falta ${c.label.toLowerCase()}`;
          break;
        }
        if (c.digits && c.exact && datos[c.key] && datos[c.key].length !== c.digits) {
          estado = "error";
          motivo = `${c.label} con ${datos[c.key].length} dígitos (tienen que ser ${c.digits})`;
          break;
        }
      }
      let existenteId = null;
      if (estado !== "error") {
        const k = claveUnica && datos[claveUnica] ? datos[claveUnica] : "n:" + norm(datos.nombre);
        if (vistos.has(k)) {
          estado = "repetido";
          motivo = "Repetido en el archivo";
        } else {
          vistos.add(k);
          existenteId = porClave.get(k) || null;
          if (existenteId) estado = "existe";
        }
      }
      out.push({ n, datos, estado, motivo, existenteId });
    }
    return out;
  };

  const cuentas = useMemo(() => {
    const c = { nuevo: 0, existe: 0, error: 0, repetido: 0 };
    (filas || []).forEach((f) => (c[f.estado] += 1));
    return c;
  }, [filas]);

  const descargarErrores = () => {
    const malas = filas.filter((f) => f.estado === "error" || f.estado === "repetido");
    const ws = XLSX.utils.json_to_sheet(
      malas.map((f) => ({ Fila: f.n, ...Object.fromEntries(columns.map((c) => [c.label, f.datos[c.key]])), Motivo: f.motivo }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Con errores");
    XLSX.writeFile(wb, `errores_${table}.xlsx`);
  };

  const importar = async () => {
    setResultado(null);
    const payloadDe = (d, soloLlenos) => {
      const o = {};
      columns.forEach((c) => {
        if (soloLlenos && !d[c.key]) return;
        o[c.key] = d[c.key] === "" ? null : d[c.key];
      });
      return o;
    };
    const nuevos = filas.filter((f) => f.estado === "nuevo");
    const aActualizar = actualizar ? filas.filter((f) => f.estado === "existe") : [];
    let creados = 0;
    let actualizados = 0;
    const fallos = [];

    for (let i = 0; i < nuevos.length; i += 200) {
      const lote = nuevos.slice(i, i + 200);
      setProgreso(`Creando ${Math.min(i + 200, nuevos.length)} de ${nuevos.length}…`);
      const { error } = await supabase.from(table).insert(lote.map((f) => payloadDe(f.datos, false)));
      if (!error) {
        creados += lote.length;
        continue;
      }
      // si falla el lote, probar fila por fila para saber cuáles
      for (const f of lote) {
        const { error: e1 } = await supabase.from(table).insert(payloadDe(f.datos, false));
        if (e1) fallos.push({ n: f.n, motivo: friendlyError(e1) });
        else creados += 1;
      }
    }
    for (let i = 0; i < aActualizar.length; i += 10) {
      const grupo = aActualizar.slice(i, i + 10);
      setProgreso(`Actualizando ${Math.min(i + 10, aActualizar.length)} de ${aActualizar.length}…`);
      const res = await Promise.all(grupo.map((f) => supabase.from(table).update(payloadDe(f.datos, true)).eq("id", f.existenteId)));
      res.forEach((r, j) => {
        if (r.error) fallos.push({ n: grupo[j].n, motivo: friendlyError(r.error) });
        else actualizados += 1;
      });
    }
    setProgreso("");
    setResultado({ creados, actualizados, fallos });
    onDone();
  };

  const chip = {
    nuevo: "bg-emerald-50 text-emerald-700",
    existe: "bg-stone-100 text-stone-600",
    error: "bg-red-50 text-red-700",
    repetido: "bg-amber-50 text-amber-700",
  };
  const etiqueta = { nuevo: "Nuevo", existe: "Ya existe", error: "Error", repetido: "Repetido" };
  const importables = cuentas.nuevo + (actualizar ? cuentas.existe : 0);

  return (
    <section className="panel p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="paso-titulo">Importar {plural} desde Excel</h2>
          <p className="paso-ayuda">Subí un Excel o CSV con una fila por {singular.toLowerCase()}. Antes de guardar vas a ver qué se va a crear y qué tiene errores.</p>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none" aria-label="Cerrar">×</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 items-end">
        <div>
          <span className="campo-etiqueta">1. Descargá la plantilla (opcional)</span>
          <button onClick={descargarPlantilla} className="btn-secundario">Descargar plantilla</button>
          <p className="text-[12px] text-stone-400 mt-1.5">Columnas: {columns.map((c) => c.label.replace(/ \(.*\)$/, "")).join(", ")}. Si tu archivo ya tiene encabezados parecidos, se reconocen solos.</p>
        </div>
        <div>
          <span className="campo-etiqueta">2. Elegí tu archivo</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={leerArchivo} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
          {errorArchivo && <div className="text-[13px] text-red-600 mt-2">{errorArchivo}</div>}
        </div>
      </div>

      {filas && (
        <>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className={`px-3 py-1 rounded-full ${chip.nuevo}`}>{cuentas.nuevo} nuevos</span>
            <span className={`px-3 py-1 rounded-full ${chip.existe}`}>{cuentas.existe} ya existen</span>
            <span className={`px-3 py-1 rounded-full ${chip.repetido}`}>{cuentas.repetido} repetidos en el archivo</span>
            <span className={`px-3 py-1 rounded-full ${chip.error}`}>{cuentas.error} con errores</span>
            {(cuentas.error > 0 || cuentas.repetido > 0) && (
              <button onClick={descargarErrores} className="text-emerald-700 hover:underline ml-1">Descargar filas con problemas</button>
            )}
          </div>

          <div className="border border-stone-200 rounded-lg overflow-auto max-h-80">
            <table className="w-full text-[12.5px]">
              <thead className="bg-stone-50 text-stone-500 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Fila</th>
                  {columns.map((c) => (
                    <th key={c.key} className="text-left font-medium px-3 py-2">{c.label.replace(/ \(.*\)$/, "")}</th>
                  ))}
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 300).map((f) => (
                  <tr key={f.n} className="border-t border-stone-100">
                    <td className="px-3 py-1.5 text-stone-400">{f.n}</td>
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-1.5">{c.format === "cuit" ? fmtCuit(f.datos[c.key]) : f.datos[c.key] || <span className="text-stone-300">—</span>}</td>
                    ))}
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11.5px] ${chip[f.estado]}`}>{etiqueta[f.estado]}</span>
                      {f.motivo && <span className="text-stone-500 ml-2">{f.motivo}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 300 && <div className="text-[12px] text-stone-400">Se muestran las primeras 300 filas; se importan todas.</div>}

          {cuentas.existe > 0 && (
            <label className="flex items-start gap-2 text-[13.5px] text-stone-700">
              <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} className="mt-1" />
              <span>
                Actualizar los {cuentas.existe} que ya existen con los datos del archivo
                <span className="block text-[12px] text-stone-400">Solo se cambian los campos que vengan completos en el Excel. Si no lo tildás, se omiten.</span>
              </span>
            </label>
          )}

          <div className="flex items-center gap-3">
            <button onClick={importar} disabled={!importables || !!progreso} className="btn-primario">
              {progreso || `Importar ${importables} ${importables === 1 ? singular.toLowerCase() : plural}`}
            </button>
            <button onClick={onClose} className="btn text-stone-500 hover:text-stone-800">Cerrar</button>
          </div>
        </>
      )}

      {resultado && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13.5px] px-4 py-3 space-y-1">
          <div className="font-medium">
            Importación terminada: {resultado.creados} creados{resultado.actualizados ? `, ${resultado.actualizados} actualizados` : ""}.
          </div>
          {resultado.fallos.length > 0 && (
            <div className="text-red-700">
              No se pudieron guardar {resultado.fallos.length}: {resultado.fallos.slice(0, 5).map((f) => `fila ${f.n} (${f.motivo})`).join("; ")}
              {resultado.fallos.length > 5 ? "…" : ""}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
