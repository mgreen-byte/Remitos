"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, norm, up, fmtNum } from "@/lib/util";

const nh = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS = {
  planta: ["planta", "deposito", "planta deposito"],
  producto: ["producto", "variedad", "hibrido", "variedad hibrido", "nombre", "descripcion", "insumo"],
  presentacion: ["presentacion"],
  lote: ["lote", "n de lote", "nro de lote", "numero de lote", "pilote", "partida"],
  cantidad: ["cantidad", "unidades", "stock", "cant", "cantidad unidades"],
  nota: ["nota", "motivo", "observaciones", "comentario"],
};

// Carga masiva de stock desde Excel. Valida todo, muestra el stock actual y el que quedará,
// y recién ahí guarda (en una sola operación).
export default function ImportarStock({ profile, plantas, productos, onClose, onDone }) {
  const esAdmin = profile.rol === "admin";
  const [filas, setFilas] = useState(null);
  const [archivo, setArchivo] = useState("");
  const [errorArchivo, setErrorArchivo] = useState("");
  const [omitir, setOmitir] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const prodsActivos = productos.filter((p) => p.activo !== false);

  const descargarPlantilla = () => {
    const ej = prodsActivos.slice(0, 2);
    const filasEj = [
      ["Planta", "Producto", "Presentación", "Lote", "Cantidad (unidades)", "Nota"],
      ...(ej.length
        ? ej.map((p, i) => [esAdmin ? plantas[0]?.nombre || "NOMBRE DE LA PLANTA" : profile.planta?.nombre || "", p.nombre, p.presentacion || "", `LOTE-${i + 1}`, 10, "Stock inicial"])
        : [[plantas[0]?.nombre || "NOMBRE DE LA PLANTA", "NOMBRE DEL PRODUCTO", "BIG BAG 1000 KG", "LOTE-1", 10, "Stock inicial"]]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(filasEj);
    ws["!cols"] = [{ wch: 24 }, { wch: 34 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    const wp = XLSX.utils.aoa_to_sheet([
      ["Grupo", "Producto", "Presentación", "Kg por unidad"],
      ...prodsActivos.map((p) => [p.grupo || "semilla", p.nombre, p.presentacion || "", p.kg_por_unidad ?? ""]),
    ]);
    wp["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 22 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wp, "Productos (referencia)");
    const wl = XLSX.utils.aoa_to_sheet([["Plantas"], ...plantas.map((p) => [p.nombre])]);
    XLSX.utils.book_append_sheet(wb, wl, "Plantas (referencia)");
    const wi = XLSX.utils.aoa_to_sheet([
      ["Cómo completar"],
      ["Una fila por lote. Cada fila SUMA la cantidad al stock del lote (si el lote ya existe, se agrega)."],
      ["Planta: el nombre tal cual figura en la hoja Plantas." + (esAdmin ? "" : " Podés dejarla vacía: se usa tu planta.")],
      ["Producto y Presentación: tal cual figuran en la hoja Productos. Si el producto tiene una sola presentación, la presentación puede ir vacía."],
      ["Lote: el número de lote. Se guarda en mayúsculas."],
      ["Cantidad: en unidades (bolsas / big bags / bidones), mayor a cero. Los kg se calculan solos con los kg por unidad del producto."],
      ["No repitas el mismo lote en la misma planta dentro del archivo: sumá las cantidades en una sola fila."],
      ["Si subís dos veces el mismo archivo, el stock se suma dos veces."],
    ]);
    wi["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wi, "Instrucciones");
    XLSX.writeFile(wb, "plantilla_stock.xlsx");
  };

  const leer = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArchivo(file.name);
    setErrorArchivo("");
    setResultado(null);
    setFilas(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames.find((n) => nh(n) === "stock") || wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      const hi = rows.findIndex((r) => (r || []).some((c) => ALIAS.lote.includes(nh(c))));
      if (hi < 0) throw new Error("No encontré la columna “Lote”. Usá la plantilla.");
      const idx = {};
      (rows[hi] || []).forEach((h, i) => {
        const k = nh(h);
        for (const [campo, als] of Object.entries(ALIAS)) if (idx[campo] === undefined && als.includes(k)) idx[campo] = i;
      });
      if (idx.producto === undefined || idx.cantidad === undefined) throw new Error("Faltan las columnas Producto y/o Cantidad. Usá la plantilla.");

      // stock actual de los lotes (para mostrar "queda en")
      const existentes = {};
      for (let d = 0; ; d += 1000) {
        const { data } = await supabase.from("lotes").select("planta_id, producto_id, lote, stock").range(d, d + 999);
        (data || []).forEach((l) => (existentes[`${l.planta_id}|${l.producto_id}|${l.lote}`] = Number(l.stock)));
        if (!data || data.length < 1000) break;
      }

      const vistos = {};
      const out = [];
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const g = (k) => (idx[k] === undefined ? "" : r[idx[k]]);
        if (![g("producto"), g("lote"), g("cantidad")].some((v) => String(v ?? "").trim())) continue;
        const f = { n: i + 1, plantaTxt: String(g("planta")).trim(), prodTxt: String(g("producto")).trim(), presTxt: String(g("presentacion")).trim(), lote: up(String(g("lote")).trim()), nota: String(g("nota")).trim() };
        const cant = typeof g("cantidad") === "number" ? g("cantidad") : Number(String(g("cantidad")).replace(/\./g, "").replace(",", "."));
        f.cantidad = cant;
        const err = [];
        // planta
        let planta = null;
        if (esAdmin) {
          if (!f.plantaTxt) err.push("falta la planta");
          else {
            planta = plantas.find((p) => nh(p.nombre) === nh(f.plantaTxt) || (p.punto_venta && String(p.punto_venta) === f.plantaTxt.replace(/\D/g, "")));
            if (!planta) err.push(`planta “${f.plantaTxt}” no existe`);
          }
        } else {
          planta = profile.planta;
          if (!planta) err.push("tu usuario no tiene planta");
          else if (f.plantaTxt && nh(f.plantaTxt) !== nh(planta.nombre)) err.push(`solo podés cargar stock de tu planta (${planta.nombre})`);
        }
        // producto
        let prod = null;
        if (!f.prodTxt) err.push("falta el producto");
        else {
          let c = prodsActivos.filter((p) => nh(p.nombre) === nh(f.prodTxt) || (p.alias || []).some((a) => nh(a) === nh(f.prodTxt)));
          if (c.length > 1 && f.presTxt) c = c.filter((p) => nh(p.presentacion) === nh(f.presTxt));
          if (c.length === 0) err.push(`producto “${f.prodTxt}${f.presTxt ? " " + f.presTxt : ""}” no está en el catálogo`);
          else if (c.length > 1) err.push(`“${f.prodTxt}” tiene ${c.length} presentaciones: indicá cuál`);
          else prod = c[0];
        }
        if (!f.lote) err.push("falta el lote");
        if (!(cant > 0)) err.push("la cantidad tiene que ser mayor a cero");
        if (planta && prod && f.lote) {
          const k = `${planta.id}|${prod.id}|${f.lote}`;
          if (vistos[k]) err.push(`lote repetido en el archivo (fila ${vistos[k]})`);
          else vistos[k] = f.n;
          f.actual = existentes[k] ?? null;
        }
        f.planta = planta;
        f.prod = prod;
        f.err = err;
        out.push(f);
      }
      if (!out.length) throw new Error("El archivo no tiene filas para cargar.");
      setFilas(out);
    } catch (err) {
      setErrorArchivo(err.message || "No pude leer el archivo.");
    }
  };

  const ok = (filas || []).filter((f) => !f.err.length);
  const malas = (filas || []).filter((f) => f.err.length);
  const totalU = ok.reduce((a, f) => a + f.cantidad, 0);
  const totalKg = ok.reduce((a, f) => a + f.cantidad * Number(f.prod?.kg_por_unidad || 0), 0);

  const guardar = async () => {
    setGuardando(true);
    setErrorArchivo("");
    const { data, error } = await supabase.rpc("cargar_stock_masivo", {
      p_filas: ok.map((f) => ({ planta_id: f.planta.id, producto_id: f.prod.id, lote: f.lote, cantidad: f.cantidad, motivo: f.nota || "Carga masiva" })),
    });
    setGuardando(false);
    if (error) return setErrorArchivo(friendlyError(error));
    setResultado(`Se cargaron ${data} lote(s): ${fmtNum(totalU)} unidades · ${fmtNum(totalKg)} kg.`);
    setFilas(null);
    onDone?.();
  };

  const descargarErrores = () => {
    const ws = XLSX.utils.json_to_sheet(malas.map((f) => ({ Fila: f.n, Planta: f.plantaTxt, Producto: f.prodTxt, Presentación: f.presTxt, Lote: f.lote, Cantidad: f.cantidad, Problema: f.err.join("; ") })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errores");
    XLSX.writeFile(wb, "errores_carga_stock.xlsx");
  };

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-stone-900">Carga masiva de stock</div>
          <p className="text-[13px] text-stone-500 max-w-xl">Una fila por lote. Cada fila suma las unidades al stock del lote. Antes de guardar vas a ver qué va a pasar con cada fila.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={descargarPlantilla} className="btn-secundario">Descargar plantilla</button>
          <button onClick={onClose} className="text-sm text-stone-500">Cerrar</button>
        </div>
      </div>

      <input type="file" accept=".xlsx,.xls,.csv" onChange={leer} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
      {archivo && !errorArchivo && !resultado && !filas && <div className="text-xs text-stone-400">Leyendo {archivo}…</div>}
      {errorArchivo && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{errorArchivo}</div>}
      {resultado && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-3">{resultado}</div>}

      {filas && (
        <div className="space-y-3">
          <div className="text-[13px] flex gap-4 flex-wrap">
            <span className="text-emerald-800"><b>{ok.length}</b> fila(s) correctas · {fmtNum(totalU)} unidades · {fmtNum(totalKg)} kg</span>
            {malas.length > 0 && <span className="text-red-700"><b>{malas.length}</b> con problemas</span>}
          </div>
          <div className="max-h-[360px] overflow-auto border border-stone-200 rounded">
            <table className="w-full text-[12.5px]">
              <thead className="bg-stone-50 text-stone-500 sticky top-0">
                <tr>
                  <th className="text-left p-2">Fila</th>
                  <th className="text-left p-2">Planta</th>
                  <th className="text-left p-2">Producto</th>
                  <th className="text-left p-2">Lote</th>
                  <th className="text-right p-2">Suma</th>
                  <th className="text-right p-2">Queda en</th>
                  <th className="text-left p-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 500).map((f) => (
                  <tr key={f.n} className={`border-t border-stone-100 ${f.err.length ? "bg-red-50/60" : ""}`}>
                    <td className="p-2">{f.n}</td>
                    <td className="p-2">{f.planta?.nombre || f.plantaTxt}</td>
                    <td className="p-2">{f.prod ? `${f.prod.nombre} ${f.prod.presentacion || ""}` : f.prodTxt}</td>
                    <td className="p-2 font-mono">{f.lote}</td>
                    <td className="p-2 text-right">{Number.isFinite(f.cantidad) ? fmtNum(f.cantidad) : "—"}</td>
                    <td className="p-2 text-right">{!f.err.length ? fmtNum((f.actual || 0) + f.cantidad) : ""}</td>
                    <td className="p-2">
                      {f.err.length ? <span className="text-red-700">{f.err.join("; ")}</span> : f.actual != null ? <span className="text-amber-700">lote existente (tenía {fmtNum(f.actual)})</span> : <span className="text-emerald-700">lote nuevo</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 500 && <div className="text-xs text-stone-400">Se muestran las primeras 500 filas; se cargan todas.</div>}
          {ok.length > 2000 && <div className="text-sm text-red-700">El máximo es 2000 filas por carga: dividí el archivo.</div>}

          {malas.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-[13px]">
              <button onClick={descargarErrores} className="underline text-stone-600">Descargar los problemas</button>
              <label className="flex items-center gap-2 text-stone-700">
                <input type="checkbox" checked={omitir} onChange={(e) => setOmitir(e.target.checked)} /> Cargar solo las filas correctas y omitir las que tienen problemas
              </label>
            </div>
          )}
          <button disabled={guardando || !ok.length || ok.length > 2000 || (malas.length > 0 && !omitir)} onClick={guardar} className="btn-primario">
            {guardando ? "Cargando…" : `Cargar ${ok.length} fila(s)`}
          </button>
          {malas.length > 0 && !omitir && <div className="text-xs text-stone-400">Corregí el archivo o tildá la opción de omitir las filas con problemas.</div>}
        </div>
      )}
    </div>
  );
}
