"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, norm, up, fmtNum, nombreConPresentacion } from "@/lib/util";

const nh = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS = {
  planta: ["planta", "deposito", "planta deposito", "proveedor"],
  categoria: ["categoria", "categoria semilla"],
  producto: ["producto", "variedad", "veriedad", "hibrido", "variedad hibrido", "nombre", "descripcion", "insumo"],
  presentacion: ["presentacion"],
  lote: ["lote", "pilote lote", "pilote", "n de lote", "nro de lote", "numero de lote", "partida"],
  peso: ["peso por unidad", "peso", "kg por unidad", "kg unidad"],
  prefijo: ["prefijo precinto", "prefijo", "prefijo de precinto"],
  cantidad: ["cantidad", "unidades", "stock", "cant", "cantidad unidades"],
  nota: ["nota", "motivo", "observaciones", "comentario"],
};
// "26mst-sta" y "26MST - STA" son el mismo prefijo; "-" significa sin prefijo.
const normPref = (v) => {
  const t = String(v ?? "").trim().toUpperCase().replace(/\s*-\s*/g, " - ").trim();
  return t === "-" ? "" : t;
};
const sinPlanta = (n) => nh(n).replace(/^planta /, "");

// Carga del reporte de stock inicial (Excel). Una fila por lote; el stock del reporte es el stock INICIAL del lote
// en la planta donde se produjo. Lotes nuevos: se dan de alta. Lotes ya cargados con otro stock inicial:
// se muestra la diferencia y el administrador decide si se aplica. Nada se guarda hasta confirmar.
export default function ImportarStock({ profile, plantas, productos, onClose, onDone }) {
  const esAdmin = profile.rol === "admin";
  const [grupos, setGrupos] = useState(null); // filas ya agrupadas por planta+variedad+peso+lote
  const [archivo, setArchivo] = useState("");
  const [errorArchivo, setErrorArchivo] = useState("");
  const [omitir, setOmitir] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [existentes, setExistentes] = useState({});
  const [pickPlanta, setPickPlanta] = useState({}); // textoPlanta -> id
  const [pickProd, setPickProd] = useState({}); // clave variedad|peso -> id | "__crear__"
  const [aplicar, setAplicar] = useState({}); // n -> true (aplicar diferencia)

  const prodsActivos = productos.filter((p) => p.activo !== false);

  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["ESTADO", "PLANTA", "CATEGORÍA", "VARIEDAD", "LOTE", "PESO POR UNIDAD", "PREFIJO PRECINTO", "STOCK"],
      ["INICIAL", plantas[0]?.nombre || "NOMBRE DE LA PLANTA", "Original", prodsActivos[0]?.nombre || "NOMBRE DE LA VARIEDAD", "LOTE-1", prodsActivos[0]?.kg_por_unidad || 800, "26MST - STA", 10],
    ]);
    ws["!cols"] = [{ wch: 10 }, { wch: 26 }, { wch: 22 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    const wi = XLSX.utils.aoa_to_sheet([
      ["Cómo completar"],
      ["Una fila por lote (si un lote tiene dos prefijos de precinto, van en dos filas: se suman las cantidades)."],
      ["STOCK es el stock inicial del lote en la planta donde se produjo (unidades: big bags / bolsas)."],
      ["Si volvés a subir un lote ya cargado con otro stock, la app te muestra la diferencia y vos decidís si se aplica."],
      ["Variedad: si no coincide con el catálogo, la app te deja elegir el producto o crearlo."],
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
    setGrupos(null);
    setPickPlanta({});
    setPickProd({});
    setAplicar({});
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames.find((n) => nh(n) === "stock") || wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      const hi = rows.findIndex((r) => (r || []).some((c) => ALIAS.lote.includes(nh(c))));
      if (hi < 0) throw new Error("No encontré la columna del lote. Usá la plantilla o el reporte con sus encabezados.");
      const idx = {};
      (rows[hi] || []).forEach((h, i) => {
        const k = nh(h).replace(/ii/g, "i"); // el reporte trae la Í de CATEGORÍA con un carácter extra
        for (const [campo, als] of Object.entries(ALIAS)) if (idx[campo] === undefined && als.includes(k)) idx[campo] = i;
      });
      if (idx.producto === undefined || idx.cantidad === undefined) throw new Error("Faltan las columnas Variedad y/o Stock.");

      const ex = {};
      for (let d = 0; ; d += 1000) {
        const { data } = await supabase.from("lotes").select("planta_id, producto_id, lote, stock, stock_inicial").range(d, d + 999);
        (data || []).forEach((l) => (ex[`${l.planta_id}|${l.producto_id}|${l.lote}`] = { stock: Number(l.stock), inicial: l.stock_inicial == null ? null : Number(l.stock_inicial) }));
        if (!data || data.length < 1000) break;
      }
      setExistentes(ex);

      const mapa = new Map();
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const g = (k) => (idx[k] === undefined ? "" : r[idx[k]]);
        if (![g("producto"), g("lote"), g("cantidad")].some((v) => String(v ?? "").trim())) continue;
        const cant = typeof g("cantidad") === "number" ? g("cantidad") : Number(String(g("cantidad")).replace(/\./g, "").replace(",", "."));
        const peso = Number(String(g("peso")).replace(",", ".")) || null;
        const f = { plantaTxt: String(g("planta")).trim(), prodTxt: String(g("producto")).trim(), presTxt: String(g("presentacion")).trim(), peso, lote: up(String(g("lote")).trim()), categoria: String(g("categoria")).trim() };
        const key = [nh(f.plantaTxt), nh(f.prodTxt), peso || "", f.lote].join("|");
        let gr = mapa.get(key);
        if (!gr) {
          gr = { n: i + 1, ...f, cantidad: 0, prefijos: [], filasOrig: [], err0: [] };
          mapa.set(key, gr);
        }
        gr.filasOrig.push(i + 1);
        if (!(cant > 0)) gr.err0.push(`fila ${i + 1}: el stock tiene que ser mayor a cero`);
        else gr.cantidad += cant;
        const pf = normPref(g("prefijo"));
        if (pf && !gr.prefijos.includes(pf)) gr.prefijos.push(pf);
        if (!gr.categoria && f.categoria) gr.categoria = f.categoria;
      }
      const out = [...mapa.values()];
      if (!out.length) throw new Error("El archivo no tiene filas para cargar.");
      setGrupos(out);
    } catch (err) {
      setErrorArchivo(err.message || "No pude leer el archivo.");
    }
  };

  // ---- resolución de planta y producto (automática; si no, la elige el administrador) ----
  const plantaAuto = (txt) => plantas.find((p) => sinPlanta(p.nombre) === sinPlanta(txt) || nh(p.nombre) === nh(txt)) || null;
  const candidatos = (f) => {
    let c = prodsActivos.filter((p) => nh(p.nombre) === nh(f.prodTxt) || (p.alias || []).some((a) => nh(a) === nh(f.prodTxt)));
    if (c.length > 1 && f.peso) {
      const w = c.filter((p) => Number(p.kg_por_unidad) === Number(f.peso));
      if (w.length) c = w;
    }
    if (c.length > 1 && f.presTxt) c = c.filter((p) => nh(p.presentacion) === nh(f.presTxt));
    if (c.length === 1 && f.peso && Number(c[0].kg_por_unidad) && Number(c[0].kg_por_unidad) !== Number(f.peso)) return [];
    return c;
  };
  const prodKey = (f) => `${nh(f.prodTxt)}|${f.peso || ""}`;

  const filas = (grupos || []).map((f) => {
    const err = [...f.err0];
    const planta = plantaAuto(f.plantaTxt) || plantas.find((p) => p.id === pickPlanta[nh(f.plantaTxt)]) || null;
    const cs = candidatos(f);
    const pk = pickProd[prodKey(f)];
    let prod = cs.length === 1 ? cs[0] : prodsActivos.find((p) => p.id === pk) || null;
    const crear = !prod && pk === "__crear__";
    if (!f.lote) err.push("falta el lote");
    if (!f.prodTxt) err.push("falta la variedad");
    if (!planta) err.push(f.plantaTxt ? `elegí la planta para “${f.plantaTxt}”` : "falta la planta");
    if (!prod && !crear && f.prodTxt) err.push(cs.length > 1 ? `“${f.prodTxt}” tiene varias presentaciones: elegí cuál` : `elegí el producto para “${f.prodTxt}” o creálo`);
    if (!(f.cantidad > 0)) err.push("sin stock");
    const ex = planta && prod ? existentes[`${planta.id}|${prod.id}|${f.lote}`] : null;
    const base = ex ? (ex.inicial ?? ex.stock) : null;
    let accion = "nuevo";
    if (ex) accion = base === f.cantidad ? "igual" : aplicar[f.n] ? "ajustar" : "omitir";
    return { ...f, err, planta, prod, crear, cs, ex, base, accion };
  });

  const ok = filas.filter((f) => !f.err.length);
  const malas = filas.filter((f) => f.err.length);
  const aCargar = ok.filter((f) => f.accion === "nuevo" || f.accion === "ajustar");
  const totalU = aCargar.filter((f) => f.accion === "nuevo").reduce((a, f) => a + f.cantidad, 0);
  const totalKg = aCargar.filter((f) => f.accion === "nuevo").reduce((a, f) => a + f.cantidad * Number(f.prod?.kg_por_unidad || f.peso || 0), 0);
  const conDif = ok.filter((f) => f.accion === "omitir" || f.accion === "ajustar");
  const sinReconocer = [...new Map(filas.filter((f) => f.cs.length !== 1).map((f) => [prodKey(f), f])).values()];
  const crearTodas = () => {
    const m = { ...pickProd };
    sinReconocer.forEach((f) => { if (!m[prodKey(f)]) m[prodKey(f)] = "__crear__"; });
    setPickProd(m);
  };
  const prefijosNuevos = [...new Set(ok.flatMap((f) => f.prefijos))];

  const guardar = async () => {
    setGuardando(true);
    setErrorArchivo("");
    try {
      // 1) productos a crear (una vez por variedad+peso) y alias de los elegidos a mano
      const creados = {};
      for (const f of aCargar) {
        if (f.crear && !creados[prodKey(f)]) {
          const { data, error } = await supabase
            .from("productos")
            .insert({ categoria: "soja", grupo: "semilla", nombre: up(f.prodTxt), presentacion: f.peso ? `BIG BAG ${f.peso} KG` : "", kg_por_unidad: f.peso || null, alias: [f.prodTxt] })
            .select()
            .single();
          if (error) throw error;
          creados[prodKey(f)] = data;
        }
      }
      for (const f of aCargar) {
        const elegido = pickProd[prodKey(f)];
        if (f.prod && elegido === f.prod.id && !f.cs.length && !(f.prod.alias || []).some((a) => nh(a) === nh(f.prodTxt)) && nh(f.prod.nombre) !== nh(f.prodTxt)) {
          const alias = [...(f.prod.alias || []), f.prodTxt];
          await supabase.from("productos").update({ alias }).eq("id", f.prod.id);
          f.prod.alias = alias;
        }
      }
      // 2) alta / ajuste de lotes (todo junto) y registro de los prefijos
      const filasRpc = aCargar.map((f) => ({
        planta_id: f.planta.id,
        producto_id: (f.prod || creados[prodKey(f)]).id,
        lote: f.lote,
        cantidad: f.cantidad,
        categoria: f.categoria || null,
        prefijo: f.prefijos[0] || null,
        accion: f.accion,
      }));
      const extra = [...new Set(ok.flatMap((f) => f.prefijos))].map((pf) => ({ prefijo: pf, accion: "omitir" }));
      const { data, error } = await supabase.rpc("cargar_stock_reporte", { p_filas: [...filasRpc, ...extra] });
      if (error) throw error;
      const nuevos = data?.nuevos ?? 0;
      const ajust = data?.ajustados ?? 0;
      setResultado(`Listo: ${nuevos} lote(s) nuevo(s) (${fmtNum(totalU)} unidades · ${fmtNum(totalKg)} kg)${ajust ? `, ${ajust} lote(s) con diferencia aplicada` : ""}. Prefijos registrados: ${prefijosNuevos.length}.`);
      setGrupos(null);
      onDone?.();
    } catch (e) {
      setErrorArchivo(friendlyError(e));
    }
    setGuardando(false);
  };

  const descargarErrores = () => {
    const ws = XLSX.utils.json_to_sheet(malas.map((f) => ({ Filas: f.filasOrig.join(","), Planta: f.plantaTxt, Variedad: f.prodTxt, Lote: f.lote, Stock: f.cantidad, Problema: f.err.join("; ") })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errores");
    XLSX.writeFile(wb, "errores_carga_stock.xlsx");
  };

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-stone-900">Cargar stock desde el reporte (Excel)</div>
          <p className="text-[13px] text-stone-500 max-w-xl">
            Subí el reporte tal cual. Cada lote se da de alta con su stock inicial en la planta indicada, y los prefijos de precinto se agregan a la lista. Antes de guardar vas a ver qué va a pasar con cada fila.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={descargarPlantilla} className="btn-secundario">Descargar plantilla</button>
          <button onClick={onClose} className="text-sm text-stone-500">Cerrar</button>
        </div>
      </div>

      <input type="file" accept=".xlsx,.xls,.csv" onChange={leer} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:font-medium" />
      {archivo && !errorArchivo && !resultado && !grupos && <div className="text-xs text-stone-400">Leyendo {archivo}…</div>}
      {errorArchivo && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{errorArchivo}</div>}
      {resultado && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-3">{resultado}</div>}

      {grupos && (
        <div className="space-y-3">
          <div className="text-[13px] flex gap-x-4 gap-y-1 flex-wrap">
            <span className="text-emerald-800"><b>{filas.filter((f) => f.accion === "nuevo" && !f.err.length).length}</b> lote(s) nuevo(s) · {fmtNum(totalU)} unidades · {fmtNum(totalKg)} kg</span>
            <span className="text-stone-500"><b>{ok.filter((f) => f.accion === "igual").length}</b> sin cambios</span>
            {conDif.length > 0 && <span className="text-amber-700"><b>{conDif.length}</b> con diferencia (ver abajo)</span>}
            {malas.length > 0 && <span className="text-red-700"><b>{malas.length}</b> con problemas</span>}
            <span className="text-stone-500">{prefijosNuevos.length} prefijo(s) de precinto</span>
          </div>
          {sinReconocer.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[13px] text-amber-900"><b>{sinReconocer.length}</b> variedad(es) no coinciden con el catálogo. Elegí a qué producto corresponde cada una (la app se acuerda el nombre) o creá productos nuevos.</div>
                <button type="button" onClick={crearTodas} className="btn-secundario">Crear todas como productos nuevos</button>
              </div>
              {sinReconocer.map((f) => (
                <div key={prodKey(f)} className="flex items-center gap-2 text-[12.5px] flex-wrap">
                  <span className="w-72 font-medium">{f.prodTxt}{f.peso ? ` · ${f.peso} kg` : ""}</span>
                  <select value={pickProd[prodKey(f)] || ""} onChange={(e) => setPickProd({ ...pickProd, [prodKey(f)]: e.target.value })} className="border border-stone-300 rounded px-1 py-1 text-[12px] max-w-[300px]">
                    <option value="">Elegir…</option>
                    <option value="__crear__">➕ Crear producto nuevo con este nombre</option>
                    {(f.cs.length > 1 ? f.cs : prodsActivos).map((p) => <option key={p.id} value={p.id}>{nombreConPresentacion(p.nombre, p.presentacion)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="max-h-[420px] overflow-auto border border-stone-200 rounded">
            <table className="w-full text-[12.5px]">
              <thead className="bg-stone-50 text-stone-500 sticky top-0">
                <tr>
                  <th className="text-left p-2">Planta</th>
                  <th className="text-left p-2">Variedad</th>
                  <th className="text-left p-2">Lote</th>
                  <th className="text-left p-2">Prefijo</th>
                  <th className="text-right p-2">Stock reporte</th>
                  <th className="text-left p-2">Qué pasa</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 500).map((f) => (
                  <tr key={f.n} className={`border-t border-stone-100 align-top ${f.err.length ? "bg-red-50/60" : ""}`}>
                    <td className="p-2">
                      {f.planta && plantaAuto(f.plantaTxt) ? f.planta.nombre : (
                        <select value={pickPlanta[nh(f.plantaTxt)] || ""} onChange={(e) => setPickPlanta({ ...pickPlanta, [nh(f.plantaTxt)]: e.target.value })} className="border border-stone-300 rounded px-1 py-1 text-[12px]">
                          <option value="">{f.plantaTxt || "Planta"} → elegir…</option>
                          {plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="p-2">
                      {f.prod ? nombreConPresentacion(f.prod.nombre, f.prod.presentacion) : f.crear ? <span className="text-emerald-700">{f.prodTxt}{f.peso ? ` (${f.peso} kg)` : ""} · nuevo</span> : <span className="text-red-700">{f.prodTxt}{f.peso ? ` (${f.peso} kg)` : ""}</span>}
                      {f.categoria && <div className="text-[11px] text-stone-400">{f.categoria}</div>}
                    </td>
                    <td className="p-2 font-mono">{f.lote}</td>
                    <td className="p-2 text-[12px]">{f.prefijos.length ? f.prefijos.join(" + ") : "—"}</td>
                    <td className="p-2 text-right">{fmtNum(f.cantidad)}</td>
                    <td className="p-2">
                      {f.err.length ? <span className="text-red-700">{f.err.join("; ")}</span>
                        : f.accion === "nuevo" ? <span className="text-emerald-700">lote nuevo{f.crear ? " (se crea el producto)" : ""}</span>
                        : f.accion === "igual" ? <span className="text-stone-400">ya cargado, sin cambios</span>
                        : (
                          <label className="text-amber-700 flex items-start gap-1.5">
                            <input type="checkbox" className="mt-0.5" checked={!!aplicar[f.n]} onChange={(e) => setAplicar({ ...aplicar, [f.n]: e.target.checked })} />
                            <span>Stock inicial cargado: {fmtNum(f.base)} · reporte: {fmtNum(f.cantidad)} ({f.cantidad - f.base > 0 ? "+" : ""}{fmtNum(f.cantidad - f.base)}). Tildar para aplicar la diferencia.</span>
                          </label>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 500 && <div className="text-xs text-stone-400">Se muestran las primeras 500 filas; se cargan todas.</div>}

          {malas.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-[13px]">
              <button onClick={descargarErrores} className="underline text-stone-600">Descargar los problemas</button>
              <label className="flex items-center gap-2 text-stone-700">
                <input type="checkbox" checked={omitir} onChange={(e) => setOmitir(e.target.checked)} /> Cargar solo las filas correctas y omitir las que tienen problemas
              </label>
            </div>
          )}
          <button disabled={guardando || (!aCargar.length && !prefijosNuevos.length) || aCargar.length > 2000 || (malas.length > 0 && !omitir)} onClick={guardar} className="btn-primario">
            {guardando ? "Cargando…" : `Confirmar carga (${aCargar.length} lote${aCargar.length === 1 ? "" : "s"})`}
          </button>
          {malas.length > 0 && !omitir && <div className="text-xs text-stone-400">Resolvé los problemas (elegí planta/producto) o tildá la opción de omitir las filas con problemas.</div>}
        </div>
      )}
    </div>
  );
}
