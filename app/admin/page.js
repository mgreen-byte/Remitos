"use client";

import { useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import CrudTable from "@/components/CrudTable";
import ExportarTodo from "@/components/ExportarTodo";
import { supabase } from "@/lib/supabaseClient";
import { MODALIDADES, IVA_DEFAULT } from "@/lib/fieldCoords";
import { PROVINCIAS, fmtFecha, hoyISO, friendlyError, fmtMonto } from "@/lib/util";

const TABS = [
  ["plantas", "Plantas"],
  ["usuarios", "Usuarios"],
  ["catalogo", "Catálogo"],
  ["precios", "Precios"],
  ["config", "Configuración"],
  ["respaldo", "Respaldo"],
];

export default function AdminPage() {
  return <AuthGuard adminOnly>{(profile) => <AdminInner profile={profile} />}</AuthGuard>;
}

function AdminInner({ profile }) {
  const [tab, setTab] = useState("plantas");
  const [plantas, setPlantas] = useState([]);

  useEffect(() => {
    supabase.from("plantas").select("id, nombre").order("nombre").then(({ data }) => setPlantas(data || []));
  }, [tab]);

  return (
    <NavBar profile={profile}>
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex gap-1 flex-wrap">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "plantas" && (
          <CrudTable
            key="plantas"
            table="plantas"
            orderBy="nombre"
            help="Cada planta tiene su propio punto de venta (4 dígitos) y es el que se usa en sus remitos. No se puede repetir."
            columns={[
              { key: "nombre", label: "Planta", type: "text", upper: true },
              { key: "punto_venta", label: "Punto de venta", type: "text", digits: 4, placeholder: "0001" },
              { key: "domicilio", label: "Domicilio (para traslados)", type: "text", upper: true },
              { key: "provincia", label: "Provincia", type: "select", nullable: true, options: PROVINCIAS.map((p) => ({ value: p, label: p })) },
              { key: "activa", label: "Activa", type: "bool" },
            ]}
          />
        )}

        {tab === "usuarios" && (
          <CrudTable
            key="usuarios"
            table="profiles"
            orderBy="nombre"
            canAdd={false}
            help={
              <>
                Para crear un usuario nuevo: Supabase → Authentication → Users → Add user (con “Auto Confirm User”). Después aparece acá y le asignás planta y permisos.
                Operador: emite remitos y trabaja en su planta. Solo consulta: ve todas las plantas y descarga a Excel, pero no reimprime ni modifica nada (no necesita planta). Admin: todo.
              </>
            }
            columns={[
              { key: "nombre", label: "Nombre", type: "text", upper: true },
              { key: "rol", label: "Rol", type: "select", options: [{ value: "operador", label: "Operador" }, { value: "consulta", label: "Solo consulta" }, { value: "admin", label: "Admin" }] },
              { key: "planta_id", label: "Planta", type: "select", nullable: true, options: plantas.map((p) => ({ value: p.id, label: p.nombre })) },
              { key: "modalidades", label: "Modalidades", type: "multi", options: MODALIDADES.map((m) => ({ value: m.id, label: m.label })) },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "catalogo" && (
          <CrudTable
            key="catalogo"
            table="productos"
            orderBy="nombre"
            canDelete
            importarCatalogo
            nuevoDefault={{ categoria: "soja", grupo: "semilla" }}
            help="Todo lo que se remite: semillas, insumos y ensamblajes. Para insumos y ensamblajes elegí Categoría “Otro” y completá el Grupo. Podés editar o eliminar un producto; si ya tiene lotes cargados no se puede eliminar: desactivalo en “Activo”. Variedades/híbridos y su presentación. Los kg por unidad se usan para calcular el peso del remito (ej. Big Bag 800 / 1000 / 1089 kg: cargá una fila por cada presentación). En “Alias” poné otros nombres con los que viene el producto en el Excel de la OC, separados por coma, para que se reconozca solo."
            columns={[
              { key: "grupo", label: "Grupo", type: "select", options: [{ value: "semilla", label: "Semilla" }, { value: "insumo", label: "Insumo" }, { value: "ensamblaje", label: "Ensamblaje" }] },
              { key: "categoria", label: "Categoría", type: "select", options: [{ value: "soja", label: "Soja" }, { value: "maiz", label: "Maíz" }, { value: "otro", label: "Otro" }] },
              { key: "nombre", label: "Nombre (variedad / insumo / ensamblaje)", type: "text", upper: true },
              { key: "presentacion", label: "Presentación", type: "text", upper: true, placeholder: "BIG BAG 1000 KG" },
              { key: "kg_por_unidad", label: "Kg por unidad", type: "number" },
              { key: "alias", label: "Alias (Excel)", type: "list", placeholder: "nombre 1, nombre 2" },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "precios" && <Precios profile={profile} />}

        {tab === "config" && <Config />}

        {tab === "respaldo" && <ExportarTodo />}
      </div>
    </NavBar>
  );
}

function Config() {
  const [iva, setIva] = useState(IVA_DEFAULT.join("\n"));
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("configuracion").select("*").eq("clave", "iva_options").maybeSingle().then(({ data }) => {
      if (data?.valor) setIva(data.valor.join("\n"));
    });
  }, []);
  const guardar = async () => {
    const valor = iva.split("\n").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const { error } = await supabase.from("configuracion").upsert({ clave: "iva_options", valor });
    setMsg(error ? error.message : "Guardado.");
  };
  return (
    <div className="panel p-4 space-y-2 max-w-md">
      <div className="text-xs font-semibold text-stone-500 uppercase">Condiciones de IVA (una por línea)</div>
      <textarea value={iva} onChange={(e) => setIva(e.target.value)} rows={6} className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm uppercase" />
      <button onClick={guardar} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">
        Guardar
      </button>
      {msg && <span className="text-xs text-stone-500 ml-2">{msg}</span>}
      <div className="text-xs text-stone-400 pt-2">La calibración de impresión predeterminada se guarda desde la pantalla “Generar remito”.</div>
    </div>
  );
}

// Precio del kg de soja. Cada remito usa el precio vigente a su fecha (el más reciente que ya rige).
function Precios({ profile }) {
  const [rows, setRows] = useState([]);
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState(hoyISO());
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const { data } = await supabase.from("precios").select("*").eq("categoria", "soja").order("vigente_desde", { ascending: false });
    setRows(data || []);
  };
  useEffect(() => {
    cargar();
  }, []);
  const guardar = async () => {
    const n = Number(String(precio).replace(",", "."));
    if (!(n > 0)) return setMsg("Cargá un precio mayor a cero.");
    if (!desde) return setMsg("Elegí desde qué fecha rige.");
    const { error } = await supabase
      .from("precios")
      .upsert({ categoria: "soja", precio_kg: n, vigente_desde: desde, creado_por: profile.id, creado_por_nombre: profile.nombre }, { onConflict: "categoria,vigente_desde" });
    if (error) return setMsg(friendlyError(error));
    setPrecio("");
    setMsg("Precio guardado.");
    cargar();
  };
  const borrar = async (id) => {
    if (!confirm("¿Borrar este precio?")) return;
    const { error } = await supabase.from("precios").delete().eq("id", id);
    if (error) return setMsg(friendlyError(error));
    cargar();
  };
  const vigente = rows.find((r) => r.vigente_desde <= hoyISO());
  return (
    <div className="panel p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="paso-titulo">Precio del kg de soja</h2>
        <p className="text-[13px] text-stone-500 mt-1">
          Se usa en la pantalla COT para calcular el monto de cada remito (kg de soja × precio). Cada remito toma el precio vigente a su fecha. Por ahora solo soja.
        </p>
      </div>
      <div className="flex gap-2 items-end flex-wrap">
        <label className="text-[12px] text-stone-500">
          Precio por kg ($)
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0,00" className="block border border-stone-300 rounded px-2 py-1.5 text-sm w-36" />
        </label>
        <label className="text-[12px] text-stone-500">
          Rige desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="block border border-stone-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <button onClick={guardar} className="btn-primario">Guardar precio</button>
      </div>
      {msg && <div className="text-[13px] text-stone-600">{msg}</div>}
      {vigente && <div className="text-[13px]">Precio vigente hoy: <b>{fmtMonto(vigente.precio_kg)}</b> por kg (desde {fmtFecha(vigente.vigente_desde)})</div>}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-stone-500">
            <th className="py-1.5 font-medium">Rige desde</th>
            <th className="py-1.5 font-medium text-right">Precio por kg</th>
            <th className="py-1.5 font-medium pl-4">Cargó</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-stone-100">
              <td className="py-1.5">{fmtFecha(r.vigente_desde)}</td>
              <td className="py-1.5 text-right">{fmtMonto(r.precio_kg)}</td>
              <td className="py-1.5 pl-4 text-stone-500">{r.creado_por_nombre || ""}</td>
              <td className="py-1.5 text-right">
                <button onClick={() => borrar(r.id)} className="text-[12px] text-red-600 hover:underline">Borrar</button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-stone-400">Todavía no hay precios cargados.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
