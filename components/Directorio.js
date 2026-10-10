"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, up, norm, fmtCuit } from "@/lib/util";
import ImportarExcel from "@/components/ImportarExcel";

// Directorio compartido (transportes, choferes). Todos los usuarios ven, agregan y editan;
// solo el admin borra. columns: [{key, label, upper, digits, format, span, placeholder, required}]
export default function Directorio({ table, titulo, singular, ayuda, columns, profile, vacioTexto, claveUnica }) {
  const esAdmin = profile?.rol === "admin";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // {id|null, data}
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [importando, setImportando] = useState(false);

  const cargar = async () => {
    // Supabase devuelve como máximo 1000 filas por consulta: se piden de a tandas.
    let todo = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase.from(table).select("*").order("nombre").range(desde, desde + 999);
      if (error) {
        setError(friendlyError(error));
        break;
      }
      todo = todo.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    setLoading(false);
    setRows(todo);
  };
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const visibles = useMemo(() => {
    const n = norm(q);
    if (!n) return rows;
    return rows.filter((r) => columns.some((c) => norm(r[c.key]).includes(n) || String(r[c.key] ?? "").replace(/\D/g, "").includes(n.replace(/\D/g, "") || "§")));
  }, [rows, q, columns]);

  const vacio = () => Object.fromEntries(columns.map((c) => [c.key, ""]));

  const guardar = async () => {
    setError("");
    setAviso("");
    const payload = {};
    for (const c of columns) {
      let v = (form.data[c.key] ?? "").toString().trim();
      if (c.upper) v = up(v);
      if (c.compact) v = v.replace(/[\s.\-]/g, "");
      if (c.digits) v = v.replace(/\D/g, "");
      if (c.required && !v) return setError(`Completá: ${c.label}.`);
      if (c.digits && c.exact && v && v.length !== c.digits) return setError(`${c.label}: tienen que ser ${c.digits} dígitos, sin guiones.`);
      if (c.digits && c.exact && c.required && v.length !== c.digits) return setError(`${c.label}: tienen que ser ${c.digits} dígitos, sin guiones.`);
      payload[c.key] = v === "" ? null : v;
    }
    const req = form.id ? supabase.from(table).update(payload).eq("id", form.id) : supabase.from(table).insert(payload);
    const { error: err } = await req;
    if (err) return setError(friendlyError(err));
    setAviso(form.id ? "Cambios guardados." : `${singular} agregado.`);
    setForm(null);
    cargar();
  };

  const borrar = async (r) => {
    if (!window.confirm(`¿Borrar a ${r.nombre}? Los remitos ya emitidos no se modifican.`)) return;
    const { error: err } = await supabase.from(table).delete().eq("id", r.id);
    if (err) return setError(friendlyError(err));
    setAviso("Registro borrado.");
    cargar();
  };

  const mostrar = (c, r) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return <span className="text-stone-300">—</span>;
    return c.format === "cuit" ? fmtCuit(v) : v;
  };

  return (
    <div className="print-reset max-w-5xl mx-auto px-6 py-8 space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">{titulo}</h1>
          <p className="text-stone-500 text-[13.5px] max-w-xl">{ayuda}</p>
        </div>
        {!form && !importando && (
          <div className="flex gap-2">
            <button onClick={() => { setError(""); setAviso(""); setImportando(true); }} className="btn-secundario">
              Importar desde Excel
            </button>
            <button onClick={() => { setError(""); setAviso(""); setForm({ id: null, data: vacio() }); }} className="btn-primario">
              Agregar {singular.toLowerCase()}
            </button>
          </div>
        )}
      </header>

      {aviso && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13.5px] px-4 py-3">{aviso}</div>}

      {importando && (
        <ImportarExcel table={table} singular={singular} columns={columns} claveUnica={claveUnica} existentes={rows} onClose={() => setImportando(false)} onDone={cargar} />
      )}

      {form && (
        <section className="panel p-6">
          <h2 className="paso-titulo mb-4">{form.id ? `Editar ${singular.toLowerCase()}` : `Nuevo ${singular.toLowerCase()}`}</h2>
          <div className="grid gap-4 md:grid-cols-6">
            {columns.map((c) => (
              <div key={c.key} className={c.span === 2 ? "md:col-span-3" : c.span === 3 ? "md:col-span-6" : "md:col-span-2"}>
                <label className={"campo-etiqueta"}>
                  {c.label}
                  {c.required ? "" : " (opcional)"}
                </label>
                <input
                  value={form.data[c.key] ?? ""}
                  onChange={(e) => {
                    let v = e.target.value;
                    if (c.upper) v = up(v);
                    if (c.compact) v = v.replace(/[\s.\-]/g, "");
                    if (c.digits) v = v.replace(/\D/g, "").slice(0, c.digits);
                    setForm((f) => ({ ...f, data: { ...f.data, [c.key]: v } }));
                  }}
                  placeholder={c.placeholder}
                  inputMode={c.digits ? "numeric" : undefined}
                  className="w-full px-3 py-2 text-[14px]"
                />
              </div>
            ))}
          </div>
          {error && <div className="mt-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13.5px] px-4 py-3">{error}</div>}
          <div className="mt-5 flex gap-2">
            <button onClick={guardar} className="btn-primario">Guardar</button>
            <button onClick={() => { setForm(null); setError(""); }} className="btn text-stone-500 hover:text-stone-800">Cancelar</button>
          </div>
        </section>
      )}

      {!form && error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13.5px] px-4 py-3">{error}</div>}

      <section className="panel">
        <div className="p-4 flex items-center justify-between gap-3 flex-wrap border-b border-stone-200">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, CUIT/CUIL o patente…" className="px-3 py-2 text-[14px] w-full sm:w-80" />
          <span className="text-[12.5px] text-stone-400">
            {visibles.length} {visibles.length === 1 ? "registro" : "registros"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="text-[12px] text-stone-500 bg-stone-50">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="text-left font-medium px-4 py-2.5">{c.label}</th>
                ))}
                <th className="px-4 py-2.5 text-left font-medium">Cargado por</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length + 2} className="p-8 text-center text-stone-400">Cargando…</td>
                </tr>
              )}
              {!loading && visibles.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className="p-8 text-center text-stone-400">
                    {q ? "No hay resultados para esa búsqueda." : vacioTexto}
                  </td>
                </tr>
              )}
              {visibles.map((r) => (
                <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50/60">
                  {columns.map((c, i) => (
                    <td key={c.key} className={`px-4 py-3 ${i === 0 ? "font-medium text-stone-800" : "text-stone-600"}`}>{mostrar(c, r)}</td>
                  ))}
                  <td className="px-4 py-3 text-[12.5px] text-stone-400">
                    {r.creado_por_nombre || "—"}
                    {r.modificado_por_nombre && <div>Editado por {r.modificado_por_nombre}</div>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setError(""); setAviso(""); setForm({ id: r.id, data: { ...vacio(), ...Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? ""])) } }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-emerald-700 hover:underline text-[13px] mr-3">
                      Editar
                    </button>
                    {esAdmin && (
                      <button onClick={() => borrar(r)} className="text-stone-400 hover:text-red-600 text-[13px]">
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
