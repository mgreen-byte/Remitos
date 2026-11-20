"use client";
// Camión de la orden de carga: transportista, chofer y patentes. Lo cargan Admin, Logística y la planta.
// Nuevo remito lo trae precargado; si al remitir cambia, queda como el nuevo camión de la orden.
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BuscadorSelect from "@/components/BuscadorSelect";
import { friendlyError } from "@/lib/util";

let cache = null; // transportistas y choferes (una sola vez por visita)
export const listasTransporte = () => {
  if (!cache)
    cache = Promise.all([
      supabase.from("transportistas").select("id, nombre, cuit, domicilio").order("nombre"),
      supabase.from("choferes").select("id, nombre, dni, chasis, acoplado").order("nombre"),
    ]).then(([t, c]) => ({ transportistas: t.data || [], choferes: c.data || [] }));
  return cache;
};
const pat = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const inputCls = "border border-stone-300 rounded px-2 py-1.5 text-sm w-full";

export default function TransporteOrden({ orden, puede, onCambio }) {
  const [edit, setEdit] = useState(null); // { transp, chofer, chasis, acoplado }
  const [listas, setListas] = useState({ transportistas: [], choferes: [] });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const activa = orden.estado === "activa";
  const hay = orden.transportista_id || orden.chofer_id || orden.chasis;

  const abrir = async () => {
    setError("");
    setEdit({ transp: orden.transportista_id || "", chofer: orden.chofer_id || "", chasis: orden.chasis || "", acoplado: orden.acoplado || "" });
    setListas(await listasTransporte());
  };
  const elegirChofer = (id) => {
    const c = listas.choferes.find((x) => x.id === id);
    setEdit((e) => ({ ...e, chofer: id, chasis: c ? pat(c.chasis) : e.chasis, acoplado: c ? pat(c.acoplado) : e.acoplado }));
  };
  const guardar = async (vaciar = false) => {
    setGuardando(true);
    const v = vaciar ? { transp: "", chofer: "", chasis: "", acoplado: "" } : edit;
    const { error: e } = await supabase.rpc("fijar_transporte_orden", { p_orden: orden.id, p_transportista: v.transp || null, p_chofer: v.chofer || null, p_chasis: pat(v.chasis), p_acoplado: pat(v.acoplado) });
    setGuardando(false);
    if (e) return setError(friendlyError(e));
    setEdit(null);
    onCambio && onCambio();
  };

  return (
    <div className="rounded-md border border-stone-200">
      <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-[13px] flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-800">🚚 Camión de la orden</span>
        {orden.transporte_por_nombre && !edit && <span className="text-[11.5px] text-stone-400">· cargado por {orden.transporte_por_nombre}</span>}
        {puede && activa && !edit && (
          <button onClick={abrir} className="ml-auto text-[12.5px] px-2.5 py-1 rounded-md border border-stone-300 bg-white hover:bg-stone-50">
            {hay ? "Cambiar" : "Asignar transporte y chofer"}
          </button>
        )}
      </div>
      {!edit && (
        <div className="px-3 py-2 text-[13px]">
          {hay ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span><span className="text-stone-500">Transporte:</span> <b>{orden.transportista?.nombre || "—"}</b></span>
              <span><span className="text-stone-500">Chofer:</span> <b>{orden.chofer?.nombre || "—"}</b>{orden.chofer?.dni ? <span className="text-stone-500"> · CUIL {orden.chofer.dni}</span> : null}</span>
              <span><span className="text-stone-500">Chasis / Acoplado:</span> <b className="font-mono">{orden.chasis || "—"} / {orden.acoplado || "—"}</b></span>
            </div>
          ) : (
            <span className="text-stone-500">Sin asignar. Si lo cargás acá, Nuevo remito lo trae para todos los remitos de la orden (las dos plantas, si pasa por dos).</span>
          )}
        </div>
      )}
      {edit && (
        <div className="px-3 py-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="campo-etiqueta">Transportista</label>
              <BuscadorSelect
                value={edit.transp}
                onChange={(v) => setEdit((e) => ({ ...e, transp: v }))}
                options={listas.transportistas.map((t) => ({ value: t.id, label: t.nombre, sub: t.cuit || "", buscar: t.domicilio || "" }))}
                extras={[{ value: "", label: "— Sin transportista —" }]}
                placeholder="Buscar por nombre o CUIT…"
              />
            </div>
            <div>
              <label className="campo-etiqueta">Chofer</label>
              <BuscadorSelect
                value={edit.chofer}
                onChange={elegirChofer}
                options={listas.choferes.map((c) => ({ value: c.id, label: c.nombre, sub: c.dni || "", buscar: `${c.chasis || ""} ${c.acoplado || ""}` }))}
                extras={[{ value: "", label: "— Sin chofer —" }]}
                placeholder="Buscar por nombre, CUIL o patente…"
              />
            </div>
            <div>
              <label className="campo-etiqueta">Chasis</label>
              <input value={edit.chasis} onChange={(e) => setEdit({ ...edit, chasis: pat(e.target.value) })} className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className="campo-etiqueta">Acoplado</label>
              <input value={edit.acoplado} onChange={(e) => setEdit({ ...edit, acoplado: pat(e.target.value) })} className={`${inputCls} font-mono`} />
            </div>
          </div>
          <div className="text-[12px] text-stone-500">Si el transporte o el chofer no están en la lista, dalos de alta en Transportes / Choferes (o desde Nuevo remito).</div>
          {error && <div className="text-[12.5px] text-red-700">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <button disabled={guardando} onClick={() => guardar(false)} className="btn-primario">{guardando ? "Guardando…" : "Guardar"}</button>
            <button onClick={() => setEdit(null)} className="text-sm text-stone-500 px-2">Cancelar</button>
            {hay && <button disabled={guardando} onClick={() => guardar(true)} className="text-sm text-red-600 px-2 ml-auto">Quitar camión</button>}
          </div>
        </div>
      )}
    </div>
  );
}
