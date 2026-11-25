"use client";
// Portal de transportistas: sus pedidos de unidad. Aceptar = cargar chofer y patentes (completa el camión de la orden).
import { useCallback, useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import PedidoUnidad from "@/components/PedidoUnidad";
import { supabase } from "@/lib/supabaseClient";
import { fmtFecha, fmtNum, friendlyError, fmtDocChofer } from "@/lib/util";

export default function MisPedidosPage() {
  return <AuthGuard roles={["transportista"]}>{(profile) => <MisPedidos profile={profile} />}</AuthGuard>;
}

const pat = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const lugar = (l) => [l.localidad, l.provincia].filter(Boolean).join(", ") || l.domicilio || "";
const corto = (n) => String(n || "").split("|")[0].replace(/^(DEP[OÓ]SITO|PLANTA|ESTANCIA)\s+/i, "").replace(/["“”]/g, "").trim();
const inp = "w-full border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";

function MisPedidos({ profile }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null); // { id, modo: "aceptar"|"rechazar", ... }
  const [ver, setVer] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("mis_pedidos");
    setCargando(false);
    if (e) return setError(friendlyError(e));
    setLista(data || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const abrirAceptar = (x) => setForm({ id: x.pedido.id, modo: "aceptar", nombre: x.orden.chofer?.nombre || "", doc: x.orden.chofer?.dni || "", soloDni: /^\d{7,8}$/.test(x.orden.chofer?.dni || ""), chasis: x.orden.chasis || "", acoplado: x.orden.acoplado || "" });
  const enviar = async () => {
    setError("");
    setGuardando(true);
    const acepta = form.modo === "aceptar";
    const { error: e } = await supabase.rpc("responder_pedido", {
      p_pedido: form.id, p_acepta: acepta, p_motivo: acepta ? null : form.motivo || "",
      p_chofer_nombre: acepta ? form.nombre : null, p_chofer_doc: acepta ? form.doc : null,
      p_chasis: acepta ? form.chasis : null, p_acoplado: acepta ? form.acoplado : null,
    });
    setGuardando(false);
    if (e) return setError(friendlyError(e));
    setForm(null);
    cargar();
  };

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Mis pedidos de unidad</h1>
          <p className="text-stone-500 text-[13px] sm:text-[13.5px]">Revisá el recorrido y la carga. <b>Aceptá</b> cargando el chofer y las patentes de la unidad, o <b>rechazá</b> indicando el motivo.</p>
        </header>
        {error && <div className="text-sm rounded p-3 border bg-red-50 border-red-200 text-red-700">{error}</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !lista.length && !error && <div className="panel p-5 text-sm text-stone-500">No tenés pedidos pendientes.</div>}

        <div className="space-y-3">
          {lista.map((x) => {
            const { pedido: p, orden: o, lineas: ls } = x;
            const base = ls.some((l) => Number(l.saldo) > 0) ? ls.filter((l) => Number(l.saldo) > 0) : ls;
            const u = base.reduce((a, l) => a + Number(l.cantidad || 0), 0);
            const kg = base.reduce((a, l) => a + Number(l.kilos || 0), 0);
            const deps = [...new Set(base.map((l) => corto(l.planta_nombre)).filter(Boolean))];
            const dest = [...new Set(base.map(lugar).filter(Boolean))];
            const est = p.estado === "aceptado" ? ["Aceptado", "bg-emerald-100 text-emerald-800"] : p.estado === "rechazado" ? ["Rechazado", "bg-red-100 text-red-700"] : ["Pendiente de respuesta", "bg-amber-100 text-amber-800"];
            const f = form?.id === p.id ? form : null;
            return (
              <div key={p.id} className={`panel p-3 sm:p-4 space-y-2 ${p.estado === "asignado" ? "border-l-4 border-l-amber-400" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-[16px]">{o.numero}</span>
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${est[1]}`}>{est[0]}</span>
                  {o.fecha_carga && <span className="text-[13px] text-stone-700">Carga: <b>{fmtFecha(o.fecha_carga)}</b></span>}
                  <span className="text-[13px] text-stone-500">{o.tipo_unidad || "unidad a definir"}</span>
                </div>
                <div className="text-[13.5px]"><span className="text-stone-500">Carga en:</span> {deps.join(" · ")}</div>
                <div className="text-[13.5px]"><span className="text-stone-500">Destinos:</span> {dest.join(" · ")}</div>
                <div className="text-[13px] text-stone-700">{fmtNum(u)} unidades{kg ? ` · ${fmtNum(Math.round(kg))} kg` : ""}</div>
                {o.observaciones_deposito && <div className="text-[13px] bg-sky-50 border border-sky-200 rounded px-2 py-1">{o.observaciones_deposito}</div>}
                {p.estado === "aceptado" && (
                  <div className="text-[13px] text-emerald-800">✓ Unidad: {o.chofer?.nombre || "—"}{o.chofer?.dni ? ` (${fmtDocChofer(o.chofer.dni)})` : ""} · {o.chasis || "—"} / {o.acoplado || "—"}</div>
                )}
                {p.estado === "rechazado" && <div className="text-[13px] text-red-700">Rechazado: {p.motivo_rechazo}</div>}

                {!f && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => abrirAceptar(x)} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium">{p.estado === "aceptado" ? "Cambiar chofer / patentes" : "Aceptar y cargar unidad"}</button>
                    {p.estado !== "rechazado" && <button onClick={() => setForm({ id: p.id, modo: "rechazar", motivo: "" })} className="px-3 py-2 rounded-md border border-stone-300 bg-white text-[14px]">Rechazar</button>}
                    <button onClick={() => setVer(ver === p.id ? null : p.id)} className="px-3 py-2 text-[13.5px] text-sky-700 underline">{ver === p.id ? "Ocultar recorrido" : "Ver recorrido y carga"}</button>
                  </div>
                )}
                {f?.modo === "aceptar" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><label className="campo-etiqueta">Chofer (nombre y apellido)</label><input value={f.nombre} onChange={(e) => setForm({ ...f, nombre: e.target.value.toUpperCase() })} className={inp} /></div>
                      <div>
                        <label className="campo-etiqueta">{f.soloDni ? "DNI del chofer" : "CUIL del chofer"}</label>
                        <input value={f.doc} inputMode="numeric" onChange={(e) => setForm({ ...f, doc: e.target.value.replace(/\D/g, "").slice(0, f.soloDni ? 8 : 11) })} placeholder={f.soloDni ? "7 u 8 dígitos" : "11 dígitos"} className={inp} />
                        <label className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-600"><input type="checkbox" checked={f.soloDni} onChange={(e) => setForm({ ...f, soloDni: e.target.checked, doc: f.doc.slice(0, e.target.checked ? 8 : 11) })} /> Solo tengo el DNI</label>
                      </div>
                      <div><label className="campo-etiqueta">Patente chasis</label><input value={f.chasis} onChange={(e) => setForm({ ...f, chasis: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                      <div><label className="campo-etiqueta">Patente acoplado</label><input value={f.acoplado} onChange={(e) => setForm({ ...f, acoplado: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={guardando} onClick={enviar} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium disabled:opacity-60">{guardando ? "Guardando…" : "Confirmar"}</button>
                      <button onClick={() => setForm(null)} className="px-3 py-2 text-[14px] text-stone-500">Cancelar</button>
                    </div>
                  </div>
                )}
                {f?.modo === "rechazar" && (
                  <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2">
                    <label className="campo-etiqueta">Motivo del rechazo</label>
                    <input value={f.motivo} onChange={(e) => setForm({ ...f, motivo: e.target.value })} placeholder="Ej.: sin unidad disponible para esa fecha" className={inp} />
                    <div className="flex gap-2">
                      <button disabled={guardando} onClick={enviar} className="px-3 py-2 rounded-md bg-red-600 text-white text-[14px] font-medium disabled:opacity-60">Rechazar pedido</button>
                      <button onClick={() => setForm(null)} className="px-3 py-2 text-[14px] text-stone-500">Cancelar</button>
                    </div>
                  </div>
                )}
                {ver === p.id && <PedidoUnidad orden={o} lineas={ls} plantas={[]} soloLectura onCerrar={() => setVer(null)} />}
              </div>
            );
          })}
        </div>
      </div>
    </NavBar>
  );
}
