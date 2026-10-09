"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, up } from "@/lib/util";

const inputCls = "border border-stone-300 rounded px-2 py-1 text-sm w-full";

// Tabla editable genérica.
// columns: [{key, label, type: text|number|select|bool|multi|list, options, upper, width, placeholder}]
export default function CrudTable({ table, columns, orderBy = "created_at", canAdd = true, canDelete = false, nuevoDefault = {}, select = "*", help }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null); // {id|null, data}
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const cargar = async () => {
    const { data, error } = await supabase.from(table).select(select).order(orderBy);
    setLoading(false);
    if (error) setMsg(friendlyError(error));
    setRows(data || []);
  };
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const vacio = () => {
    const d = { ...nuevoDefault };
    columns.forEach((c) => {
      if (d[c.key] === undefined) d[c.key] = c.type === "bool" ? true : c.type === "multi" || c.type === "list" ? [] : "";
    });
    return d;
  };

  const limpiar = (d) => {
    const out = {};
    columns.forEach((c) => {
      let v = d[c.key];
      if (c.type === "number") v = v === "" || v === null ? null : Number(String(v).replace(",", "."));
      else if (c.type === "text") v = c.upper ? up(v).trim() : (v ?? "").toString().trim();
      else if (c.type === "select" && c.nullable && v === "") v = null;
      out[c.key] = v;
    });
    return out;
  };

  const guardar = async () => {
    setMsg("");
    const payload = limpiar(edit.data);
    const req = edit.id ? supabase.from(table).update(payload).eq("id", edit.id) : supabase.from(table).insert(payload);
    const { error } = await req;
    if (error) return setMsg(friendlyError(error));
    setEdit(null);
    cargar();
  };

  const borrar = async (id) => {
    if (!window.confirm("¿Borrar este registro?")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return setMsg(friendlyError(error));
    cargar();
  };

  const celda = (c, d, set) => {
    const v = d[c.key];
    if (c.type === "bool")
      return <input type="checkbox" checked={!!v} onChange={(e) => set(c.key, e.target.checked)} />;
    if (c.type === "select")
      return (
        <select value={v ?? ""} onChange={(e) => set(c.key, e.target.value)} className={inputCls}>
          {c.nullable && <option value="">—</option>}
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    if (c.type === "multi")
      return (
        <div className="flex gap-2 flex-wrap">
          {c.options.map((o) => (
            <label key={o.value} className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={(v || []).includes(o.value)}
                onChange={(e) => set(c.key, e.target.checked ? [...(v || []), o.value] : (v || []).filter((x) => x !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    if (c.type === "list")
      return (
        <input
          value={Array.isArray(v) ? v.join(", ") : v ?? ""}
          onChange={(e) => set(c.key, e.target.value.split(",").map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1))}
          onBlur={(e) => set(c.key, e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
          placeholder={c.placeholder}
          className={inputCls}
        />
      );
    return (
      <input
        value={v ?? ""}
        onChange={(e) => set(c.key, c.upper ? up(e.target.value) : c.digits ? e.target.value.replace(/\D/g, "").slice(0, c.digits) : e.target.value)}
        inputMode={c.type === "number" || c.digits ? "decimal" : undefined}
        placeholder={c.placeholder}
        className={inputCls}
      />
    );
  };

  const mostrar = (c, r) => {
    const v = r[c.key];
    if (c.type === "bool") return v ? "Sí" : "No";
    if (c.type === "select") return c.options.find((o) => o.value === v)?.label ?? "—";
    if (c.type === "multi" || c.type === "list") return (v || []).join(", ") || "—";
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };

  const setField = (k, v) => setEdit((e) => ({ ...e, data: { ...e.data, [k]: v } }));

  return (
    <div className="space-y-3">
      {help && <div className="text-xs text-stone-500">{help}</div>}
      {msg && <div className="text-sm bg-red-50 border border-red-300 text-red-700 rounded p-2">{msg}</div>}
      <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-500 bg-stone-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="text-left p-2 first:pl-4">
                  {c.label}
                </th>
              ))}
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {canAdd && (
              <tr className="border-t border-stone-100">
                <td colSpan={columns.length + 1} className="p-2 pl-4">
                  {edit && !edit.id ? null : (
                    <button onClick={() => setEdit({ id: null, data: vacio() })} className="text-emerald-700 text-sm font-medium">
                      + Agregar
                    </button>
                  )}
                </td>
              </tr>
            )}
            {edit && !edit.id && (
              <tr className="border-t border-stone-100 bg-emerald-50">
                {columns.map((c) => (
                  <td key={c.key} className="p-2 first:pl-4 align-top">
                    {celda(c, edit.data, setField)}
                  </td>
                ))}
                <td className="p-2 whitespace-nowrap">
                  <button onClick={guardar} className="bg-emerald-700 text-white text-xs px-2 py-1 rounded mr-1">
                    Guardar
                  </button>
                  <button onClick={() => setEdit(null)} className="text-xs text-stone-500">
                    Cancelar
                  </button>
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={columns.length + 1} className="p-4 text-center text-stone-400">
                  Cargando…
                </td>
              </tr>
            )}
            {rows.map((r) =>
              edit?.id === r.id ? (
                <tr key={r.id} className="border-t border-stone-100 bg-amber-50">
                  {columns.map((c) => (
                    <td key={c.key} className="p-2 first:pl-4 align-top">
                      {c.readOnlyOnEdit ? mostrar(c, r) : celda(c, edit.data, setField)}
                    </td>
                  ))}
                  <td className="p-2 whitespace-nowrap">
                    <button onClick={guardar} className="bg-emerald-700 text-white text-xs px-2 py-1 rounded mr-1">
                      Guardar
                    </button>
                    <button onClick={() => setEdit(null)} className="text-xs text-stone-500">
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-t border-stone-100">
                  {columns.map((c) => (
                    <td key={c.key} className="p-2 first:pl-4">
                      {mostrar(c, r)}
                    </td>
                  ))}
                  <td className="p-2 whitespace-nowrap text-right">
                    <button onClick={() => setEdit({ id: r.id, data: { ...vacio(), ...r } })} className="text-xs text-emerald-700 hover:underline mr-2">
                      Editar
                    </button>
                    {canDelete && (
                      <button onClick={() => borrar(r.id)} className="text-xs text-red-600 hover:underline">
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
