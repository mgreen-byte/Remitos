"use client";

import { useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import CrudTable from "@/components/CrudTable";
import { supabase } from "@/lib/supabaseClient";
import { MODALIDADES, IVA_DEFAULT } from "@/lib/fieldCoords";

const TABS = [
  ["plantas", "Plantas"],
  ["usuarios", "Usuarios"],
  ["catalogo", "Catálogo"],
  ["config", "Configuración"],
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
                Un usuario sin planta solo puede ver (no puede emitir). Los admin pueden operar en cualquier planta.
              </>
            }
            columns={[
              { key: "nombre", label: "Nombre", type: "text", upper: true },
              { key: "rol", label: "Rol", type: "select", options: [{ value: "operador", label: "Operador" }, { value: "admin", label: "Admin" }] },
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
            nuevoDefault={{ categoria: "soja" }}
            help="Variedades/híbridos y su presentación. Los kg por unidad se usan para calcular el peso del remito (ej. Big Bag 800 / 1000 / 1089 kg: cargá una fila por cada presentación). En “Alias” poné otros nombres con los que viene el producto en el Excel de la OC, separados por coma, para que se reconozca solo."
            columns={[
              { key: "categoria", label: "Categoría", type: "select", options: [{ value: "soja", label: "Soja" }, { value: "maiz", label: "Maíz" }, { value: "otro", label: "Otro" }] },
              { key: "nombre", label: "Variedad / Híbrido", type: "text", upper: true },
              { key: "presentacion", label: "Presentación", type: "text", upper: true, placeholder: "BIG BAG 1000 KG" },
              { key: "kg_por_unidad", label: "Kg por unidad", type: "number" },
              { key: "alias", label: "Alias (Excel)", type: "list", placeholder: "nombre 1, nombre 2" },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "config" && <Config />}
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
