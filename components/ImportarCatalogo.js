"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, norm, up, fmtNum } from "@/lib/util";

const nh = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS = {
  grupo: ["grupo", "tipo", "rubro"],
  categoria: ["categoria", "cultivo", "especie"],
  nombre: ["nombre", "producto", "variedad", "hibrido", "variedad hibrido", "descripcion", "nombre variedad insumo ensamblaje"],
  presentacion: ["presentacion", "envase"],
  kg: ["kg por unidad", "kg unidad", "kg", "kg x unidad", "peso", "kg unitario", "kg por unidad kg"],
  alias: ["alias", "alias excel", "otros nombres", "sinonimos"],
  activo: ["activo", "habilitado"],
};
const GRUPOS = { semilla: "semilla", semillas: "semilla", insumo: "insumo", insumos: "insumo", ensamblaje: "ensamblaje", ensamblajes: "ensamblaje" };
const CATS = { soja: "soja", maiz: "maiz", otro: "otro", otros: "otro" };
const GRUPO_TXT = { semilla: "Semilla", insumo: "Insumo", ensamblaje: "Ensamblaje" };
const CAT_TXT = { soja: "Soja", maiz: "Maíz", otro: "Otro" };

const aNumero = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// Alta masiva del catálogo de productos desde Excel (solo admin).
export default function ImportarCatalogo({ existentes, onClose, onDone }) {
  const [filas, setFilas] = useState(null);
  const [archivo, setArchivo] = useState("");
  const [errorArchivo, setErrorArchivo] = useState("");
  const [actualizar, setActualizar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Grupo", "Categoría", "Nombre", "Presentación", "Kg por unidad", "Alias", "Activo"],
      ["Semilla", "Soja", "NOMBRE DE LA VARIEDAD", "BOLSA 40 KG", 40, "NOMBRE ALTERNATIVO 1, NOMBRE ALTERNATIVO 2", "Sí"],
      ["Semilla", "Maíz", "NOMBRE DEL HÍBRIDO", "BIG BAG 1000 KG", 1000, "", "Sí"],
      ["Insumo", "Otro", "NOMBRE DEL INSUMO", "BIDÓN 20 L", 20, "", "Sí"],
      ["Ensamblaje", "Otro", "NOMBRE DEL ENSAMBLAJE", "", "", "", "Sí"],
    ]);
    ws["!cols"] = [{ wch: 13 }, { wch: 11 }, { wch: 36 }, { wch: 22 }, { wch: 14 }, { wch: 40 }, { wch: 9 }];
    XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
    const wi = XLSX.utils.aoa_to_sheet([
      ["Cómo completar"],
      ["Una fila por producto y presentación. Si un producto viene en varias presentaciones (ej. Big Bag 800 / 1000 / 1089 kg), cargá una fila por cada una."],
      ["Grupo: Semilla, Insumo o Ensamblaje."],
      ["Categoría: Soja, Maíz u Otro. Si la dejás vacía, se usa Otro para insumos y ensamblajes (en semillas es obligatoria)."],
      ["Nombre: obligatorio. Se guarda en mayúsculas."],
      ["Presentación: opcional (BIG BAG 1000 KG, BOLSA 40 KG…)."],
      ["Kg por unidad: se usa para calcular el peso del remito. Con coma o punto decimal."],
      ["Alias: otros nombres con los que viene el producto en el Excel de la OC, separados por coma."],
      ["Activo: Sí / No. Si lo dejás vacío es Sí."],
      ["Los productos que ya existen (mismo grupo/categoría/nombre/presentación) se detectan y no se duplican; podés elegir actualizarlos."],
    ]);
    wi["!cols"] = [{ wch: 130 }];
    XLSX.utils.book_append_sheet(wb, wi, "Instrucciones");
    XLSX.writeFile(wb, "plantilla_catalogo.xlsx");
  };

  const procesar = (rows) => {
    let hIdx = -1;
    let mapa = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const m = {};
      (rows[i] || []).forEach((h, j) => {
        const k = nh(h);
        if (!k) return;
        const key = Object.keys(ALIAS).find((x) => ALIAS[x].includes(k));
        if (key && m[key] === undefined) m[key] = j;
      });
      if (m.nombre !== undefined) {
        hIdx = i;
        mapa = m;
        break;
      }
    }
    if (hIdx === -1) throw new Error("No encontré la columna Nombre en las primeras filas. Descargá la plantilla para ver el formato.");
    const get = (row, k) => (mapa[k] === undefined ? "" : row[mapa[k]]);

    const claveDe = (cat, nom, pres) => `${cat}|${norm(nom)}|${norm(pres)}`;
    const existentesPor = new Map(existentes.map((p) => [claveDe(p.categoria, p.nombre, p.presentacion || ""), p]));
    const vistos = new Set();
    const out = [];
    for (let i = hIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every((x) => String(x ?? "").trim() === "")) continue;
      const err = [];
      const grupoTxt = String(get(row, "grupo") ?? "").trim();
      const catTxt = String(get(row, "categoria") ?? "").trim();
      const nombre = up(String(get(row, "nombre") ?? "").trim());
      const presentacion = up(String(get(row, "presentacion") ?? "").trim());
      const kg = aNumero(get(row, "kg"));
      const alias = String(get(row, "alias") ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      const actTxt = nh(get(row, "activo"));

      let grupo = grupoTxt ? GRUPOS[nh(grupoTxt)] : "semilla";
      if (!grupo) err.push(`Grupo "${grupoTxt}" no válido (Semilla, Insumo o Ensamblaje)`);
      let categoria = catTxt ? CATS[nh(catTxt)] : grupo && grupo !== "semilla" ? "otro" : null;
      if (!categoria) err.push(catTxt ? `Categoría "${catTxt}" no válida (Soja, Maíz u Otro)` : "Falta la categoría (Soja, Maíz u Otro)");
      if (!nombre) err.push("Falta el nombre");
      if (Number.isNaN(kg) || (kg !== null && kg <= 0)) err.push("Kg por unidad no válido");
      let activo = true;
      if (actTxt) {
        if (["si", "s", "1", "true", "x"].includes(actTxt)) activo = true;
        else if (["no", "n", "0", "false"].includes(actTxt)) activo = false;
        else err.push(`Activo "${actTxt}" no válido (Sí o No)`);
      }

      let estado = "nuevo";
      let existente = null;
      if (!err.length) {
        const k = claveDe(categoria, nombre, presentacion);
        if (vistos.has(k)) err.push("Repetido en el archivo");
        else {
          vistos.add(k);
          existente = existentesPor.get(k) || null;
          if (existente) estado = "existe";
        }
      }
      out.push({ n: i + 1, grupo, categoria, nombre, presentacion, kg: Number.isFinite(kg) ? kg : null, alias, activo, err, estado, existente, grupoTxt, catTxt });
    }
    if (!out.length) throw new Error("El archivo no tiene filas con datos.");
    return out;
  };

  const leer = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArchivo(file.name);
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

  const nuevos = (filas || []).filter((f) => !f.err.length && f.estado === "nuevo");
  const yaExisten = (filas || []).filter((f) => !f.err.length && f.estado === "existe");
  const malas = (filas || []).filter((f) => f.err.length);
  const sinKg = nuevos.filter((f) => f.kg === null).length;

  const descargarErrores = () => {
    const ws = XLSX.utils.json_to_sheet(malas.map((f) => ({ Fila: f.n, Grupo: f.grupoTxt, Categoría: f.catTxt, Nombre: f.nombre, Presentación: f.presentacion, "Kg por unidad": f.kg ?? "", Motivo: f.err.join("; ") })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Con problemas");
    XLSX.writeFile(wb, "catalogo_con_problemas.xlsx");
  };

  const guardar = async () => {
    setGuardando(true);
    setResultado(null);
    const fallos = [];
    let creados = 0;
    let actualizados = 0;
    const payload = (f) => ({ grupo: f.grupo, categoria: f.categoria, nombre: f.nombre, presentacion: f.presentacion, kg_por_unidad: f.kg, alias: f.alias, activo: f.activo });
    for (let i = 0; i < nuevos.length; i += 200) {
      const lote = nuevos.slice(i, i + 200);
      const { error } = await supabase.from("productos").insert(lote.map(payload));
      if (!error) {
        creados += lote.length;
        continue;
      }
      for (const f of lote) {
        const { error: e1 } = await supabase.from("productos").insert(payload(f));
        if (e1) fallos.push(`Fila ${f.n}: ${friendlyError(e1)}`);
        else creados += 1;
      }
    }
    if (actualizar) {
      for (const f of yaExisten) {
        const upd = { grupo: f.grupo, activo: f.activo };
        if (f.kg !== null) upd.kg_por_unidad = f.kg;
        if (f.alias.length) upd.alias = f.alias;
        const { error } = await supabase.from("productos").update(upd).eq("id", f.existente.id);
        if (error) fallos.push(`Fila ${f.n}: ${friendlyError(error)}`);
        else actualizados += 1;
      }
    }
    setGuardando(false);
    setResultado({ creados, actualizados, fallos });
    setFilas(null);
    onDone();
  };

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-stone-900">Alta masiva del catálogo</div>
          <p className="text-[13px] text-stone-500 max-w-xl">Una fila por producto y presentación. Antes de guardar ves qué se crea, qué ya existe y qué tiene errores.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={descargarPlantilla} className="btn-secundario">Descargar plantilla</button>
          <button onClick={onClose} className="text-sm text-stone-500">Cerrar</button>
        </div>
      </div>

      <input type="file" accept=".xlsx,.xls,.csv" onChange={leer} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
      {errorArchivo && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{errorArchivo}</div>}
      {resultado && (
        <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-3 space-y-1">
          <div>Listo: {resultado.creados} producto(s) creado(s){resultado.actualizados ? `, ${resultado.actualizados} actualizado(s)` : ""}.</div>
          {resultado.fallos.length > 0 && <div className="text-red-700">No se pudieron guardar: {resultado.fallos.join(" · ")}</div>}
        </div>
      )}

      {filas && (
        <div className="space-y-3">
          <div className="text-[13px] flex gap-4 flex-wrap">
            <span className="text-emerald-800"><b>{nuevos.length}</b> nuevo(s)</span>
            <span className="text-stone-600"><b>{yaExisten.length}</b> ya existen</span>
            {malas.length > 0 && <span className="text-red-700"><b>{malas.length}</b> con problemas</span>}
            {sinKg > 0 && <span className="text-amber-700">{sinKg} sin kg por unidad (el remito no podrá calcular su peso)</span>}
          </div>
          <div className="max-h-[360px] overflow-auto border border-stone-200 rounded">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0">
                <tr>
                  <th className="text-left p-2">Fila</th>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Categoría</th>
                  <th className="text-left p-2">Nombre</th>
                  <th className="text-left p-2">Presentación</th>
                  <th className="text-right p-2">Kg/u</th>
                  <th className="text-left p-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 500).map((f) => (
                  <tr key={f.n} className={`border-t border-stone-100 ${f.err.length ? "bg-red-50/60" : ""}`}>
                    <td className="p-2">{f.n}</td>
                    <td className="p-2">{GRUPO_TXT[f.grupo] || f.grupoTxt}</td>
                    <td className="p-2">{CAT_TXT[f.categoria] || f.catTxt}</td>
                    <td className="p-2">{f.nombre}</td>
                    <td className="p-2">{f.presentacion || "—"}</td>
                    <td className="p-2 text-right">{f.kg !== null ? fmtNum(f.kg) : "—"}</td>
                    <td className="p-2">{f.err.length ? <span className="text-red-700">{f.err.join("; ")}</span> : f.estado === "existe" ? <span className="text-stone-500">ya existe</span> : <span className="text-emerald-700">nuevo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 500 && <div className="text-xs text-stone-400">Se muestran las primeras 500 filas; se cargan todas.</div>}
          <div className="flex items-center gap-4 flex-wrap text-[13px]">
            {malas.length > 0 && <button onClick={descargarErrores} className="underline text-stone-600">Descargar los problemas</button>}
            {yaExisten.length > 0 && (
              <label className="flex items-center gap-2 text-stone-600">
                <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} /> Actualizar los que ya existen (grupo, kg, alias y activo)
              </label>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={guardar} disabled={guardando || (!nuevos.length && !(actualizar && yaExisten.length))} className="btn-primario">
              {guardando ? "Guardando…" : `Cargar ${nuevos.length} producto(s)${malas.length ? " (se omiten las filas con problemas)" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
