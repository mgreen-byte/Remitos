"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { MODALIDADES } from "@/lib/fieldCoords";

const up = (s) => (s || "").toString().toUpperCase();

export default function AdminPage() {
  return <AuthGuard adminOnly>{(profile) => <AdminInner profile={profile} />}</AuthGuard>;
}

function AdminInner({ profile }) {
  const [ivaOptions, setIvaOptions] = useState([]);
  const [transportistas, setTransportistas] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [nuevoIva, setNuevoIva] = useState("");
  const [formTransp, setFormTransp] = useState({ nombre: "", cuit: "", domicilio: "", chasis: "", acoplado: "" });
  const [formChofer, setFormChofer] = useState({ nombre: "", dni: "" });
  const [errorChofer, setErrorChofer] = useState("");

  const cargar = async () => {
    const { data: cfg } = await supabase.from("configuracion").select("*").eq("clave", "iva_options").maybeSingle();
    setIvaOptions(cfg?.valor || []);
    const { data: trans } = await supabase.from("transportistas").select("*").order("nombre");
    setTransportistas(trans || []);
    const { data: chof } = await supabase.from("choferes").select("*").order("nombre");
    setChoferes(chof || []);
    const { data: users } = await supabase.from("profiles").select("*").order("nombre");
    setUsuarios(users || []);
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guardarIva = async (lista) => {
    setIvaOptions(lista);
    await supabase.from("configuracion").upsert({ clave: "iva_options", valor: lista });
  };

  const agregarTransportista = async () => {
    if (!formTransp.nombre.trim()) return;
    const payload = {
      nombre: up(formTransp.nombre),
      cuit: formTransp.cuit,
      domicilio: up(formTransp.domicilio),
      chasis: up(formTransp.chasis),
      acoplado: up(formTransp.acoplado),
    };
    const { data } = await supabase.from("transportistas").insert(payload).select().single();
    if (data) setTransportistas((t) => [...t, data]);
    setFormTransp({ nombre: "", cuit: "", domicilio: "", chasis: "", acoplado: "" });
  };

  const borrarTransportista = async (id) => {
    await supabase.from("transportistas").delete().eq("id", id);
    setTransportistas((t) => t.filter((x) => x.id !== id));
  };

  const agregarChofer = async () => {
    setErrorChofer("");
    if (!formChofer.nombre.trim() || !formChofer.dni.trim()) {
      setErrorChofer("Completá nombre y CUIL/DNI.");
      return;
    }
    const { data, error } = await supabase
      .from("choferes")
      .insert({ nombre: up(formChofer.nombre), dni: formChofer.dni.trim() })
      .select()
      .single();
    if (error) {
      setErrorChofer(error.code === "23505" ? "Ese CUIL/DNI ya está cargado." : "No se pudo guardar el chofer.");
      return;
    }
    setChoferes((c) => [...c, data]);
    setFormChofer({ nombre: "", dni: "" });
  };

  const borrarChofer = async (id) => {
    await supabase.from("choferes").delete().eq("id", id);
    setChoferes((c) => c.filter((x) => x.id !== id));
  };

  const actualizarUsuario = async (id, cambios) => {
    setUsuarios((u) => u.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
    await supabase.from("profiles").update(cambios).eq("id", id);
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 flex flex-col">
      <NavBar profile={profile} />
      <div className="no-print p-6 space-y-6 max-w-3xl">
        <div className="bg-white rounded-lg border border-stone-200 p-4">
          <div className="text-sm font-semibold mb-3">Condiciones de IVA</div>
          <div className="space-y-2">
            {ivaOptions.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={it}
                  onChange={(e) => {
                    const copy = [...ivaOptions];
                    copy[i] = up(e.target.value);
                    guardarIva(copy);
                  }}
                  className="flex-1 border border-stone-300 rounded px-2 py-1.5 text-sm"
                />
                <button onClick={() => guardarIva(ivaOptions.filter((_, idx) => idx !== i))} className="text-stone-400 hover:text-red-500 px-1">
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={nuevoIva}
                onChange={(e) => setNuevoIva(e.target.value)}
                placeholder="Nueva condición de IVA"
                className="flex-1 border border-stone-300 rounded px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => {
                  if (!nuevoIva.trim()) return;
                  guardarIva([...ivaOptions, up(nuevoIva.trim())]);
                  setNuevoIva("");
                }}
                className="bg-emerald-700 text-white px-3 py-1.5 rounded text-sm"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-stone-200 p-4">
          <div className="text-sm font-semibold mb-1">Transportistas</div>
          <p className="text-xs text-stone-400 mb-3">
            Datos de la empresa/vehículo. El chofer se carga por separado, porque puede cambiar de
            transporte de un día para el otro.
          </p>
          <div className="space-y-3">
            {transportistas.map((t) => (
              <div key={t.id} className="flex items-center justify-between border border-stone-200 rounded px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{t.nombre}</div>
                  <div className="text-stone-400 text-xs">
                    {t.domicilio} · Chasis {t.chasis} · Acoplado {t.acoplado}
                  </div>
                </div>
                <button onClick={() => borrarTransportista(t.id)} className="text-stone-400 hover:text-red-500 px-1">
                  ✕
                </button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100">
              {[
                ["nombre", "Nombre / razón social"],
                ["cuit", "C.U.I.T."],
                ["domicilio", "Domicilio"],
                ["chasis", "Chasis"],
                ["acoplado", "Acoplado"],
              ].map(([key, label]) => (
                <input
                  key={key}
                  value={formTransp[key]}
                  onChange={(e) => setFormTransp((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={label}
                  className="border border-stone-300 rounded px-2 py-1.5 text-sm"
                />
              ))}
            </div>
            <button onClick={agregarTransportista} className="bg-emerald-700 text-white px-3 py-1.5 rounded text-sm">
              Agregar transportista
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-stone-200 p-4">
          <div className="text-sm font-semibold mb-1">Choferes</div>
          <p className="text-xs text-stone-400 mb-3">
            Compartidos entre todos los usuarios. El CUIL/DNI no se puede repetir — cualquier operador
            también puede agregar uno nuevo directamente desde "Generar remito".
          </p>
          <div className="space-y-3">
            {choferes.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-stone-200 rounded px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{c.nombre}</div>
                  <div className="text-stone-400 text-xs">{c.dni}</div>
                </div>
                <button onClick={() => borrarChofer(c.id)} className="text-stone-400 hover:text-red-500 px-1">
                  ✕
                </button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100">
              <input
                value={formChofer.nombre}
                onChange={(e) => setFormChofer((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del chofer"
                className="border border-stone-300 rounded px-2 py-1.5 text-sm"
              />
              <input
                value={formChofer.dni}
                onChange={(e) => setFormChofer((f) => ({ ...f, dni: e.target.value }))}
                placeholder="CUIL / DNI"
                className="border border-stone-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            {errorChofer && <div className="text-xs text-amber-700">{errorChofer}</div>}
            <button onClick={agregarChofer} className="bg-emerald-700 text-white px-3 py-1.5 rounded text-sm">
              Agregar chofer
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-stone-200 p-4">
          <div className="text-sm font-semibold mb-1">Usuarios</div>
          <p className="text-xs text-stone-400 mb-3">
            Para crear un usuario nuevo: Supabase → Authentication → Users → Invite user. Apenas acepta la
            invitación aparece acá para que le asignes rol y modalidades.
          </p>
          <div className="space-y-3">
            {usuarios.map((u) => (
              <div key={u.id} className="border border-stone-200 rounded px-3 py-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <input
                    value={u.nombre || ""}
                    onChange={(e) => actualizarUsuario(u.id, { nombre: up(e.target.value) })}
                    placeholder="Nombre"
                    className="border border-stone-300 rounded px-2 py-1 text-sm w-48"
                  />
                  <select
                    value={u.rol}
                    onChange={(e) => actualizarUsuario(u.id, { rol: e.target.value })}
                    className="border border-stone-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="operador">Operador</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-3 text-xs text-stone-500">
                  {MODALIDADES.map((m) => {
                    const checked = (u.modalidades || []).includes(m.id);
                    return (
                      <label key={m.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nuevas = e.target.checked
                              ? [...(u.modalidades || []), m.id]
                              : (u.modalidades || []).filter((x) => x !== m.id);
                            actualizarUsuario(u.id, { modalidades: nuevas });
                          }}
                        />
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
