"use client";
// Portal de transportistas: sus pedidos de unidad. Aceptan (o rechazan) y, cuando la tienen, cargan la unidad:
// chofer, patentes y tipo de equipo (completa el camión de la orden).
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import PedidoUnidad from "@/components/PedidoUnidad";
import RecorridoInterno from "@/components/RecorridoInterno";
import { nombrePunto, lugarTexto, cargaTexto, horaTexto, detalleParada } from "@/lib/pedidosInternos";
import { supabase } from "@/lib/supabaseClient";
import { fmtFecha, fmtNum, friendlyError, fmtDocChofer } from "@/lib/util";
import { TIPOS_UNIDAD } from "@/lib/pedidoUnidad";
import { tieneUnidad, lineasConDestino } from "@/lib/pedidosPortal";

export default function MisPedidosPage() {
  return <AuthGuard roles={["transportista"]}>{(profile) => <MisPedidos profile={profile} />}</AuthGuard>;
}

const pat = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const lugar = (l) => [l.localidad, l.provincia].filter(Boolean).join(", ") || l.domicilio || "";
const corto = (n) => String(n || "").split("|")[0].replace(/^(DEP[OÓ]SITO|PLANTA|ESTANCIA)\s+/i, "").replace(/["“”]/g, "").trim();
const ORDENES = { carga: "Fecha de carga", carga_desc: "Fecha de carga (últimas primero)", numero: "Número de orden", estado: "Pendientes primero", transporte: "Transporte" };
const PESO = { asignado: 0, falta: 1, aceptado: 2, en_viaje: 3, rechazado: 4, finalizado: 5, cancelado: 6 };
const inp = "w-full border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";

function MisPedidos({ profile }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null); // { id, modo: "aceptar"|"rechazar", ... }
  const [ver, setVer] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [plantasD, setPlantasD] = useState([]);
  const [misT, setMisT] = useState([]); // razones sociales del usuario
  useEffect(() => { supabase.rpc("mis_transportes").then(({ data }) => setMisT(data || [])); }, []);
  const eligeRS = misT.length > 1;
  const [orden, setOrden] = useState(() => { try { return localStorage.getItem("misPedidosOrden") || "carga"; } catch { return "carga"; } });

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("mis_pedidos");
    setCargando(false);
    if (e) return setError(friendlyError(e));
    setLista(data || []);
    // Traslados: datos de la planta de destino (para mostrar a dónde va)
    const ids = [...new Set((data || []).map((x) => x.orden?.planta_destino_id).filter(Boolean))];
    if (ids.length) supabase.from("plantas").select("*").in("id", ids).then(({ data: pl }) => setPlantasD(pl || []));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const est = (x) => (x.orden.estado === "cancelada" ? "cancelado" : x.pedido.entrega_at ? "finalizado" : x.pedido.salida_at ? "en_viaje"
    : x.pedido.estado === "aceptado" ? (tieneUnidad(x.pedido, x.orden) ? "aceptado" : "falta") : x.pedido.estado);
  const [cierre, setCierre] = useState(null); // { id, remito, cpe, km, kg_descargados } (internos, al marcar "Entregué")
  const viaje = async (id, paso, datos) => {
    setError("");
    setGuardando(true);
    const { error: e } = await supabase.rpc("marcar_viaje", { p_pedido: id, p_paso: paso, p_datos: datos || {} });
    setGuardando(false);
    if (e) return setError(friendlyError(e));
    setCierre(null);
    cargar();
  };
  const varios = new Set(lista.map((x) => x.pedido.transportista_id)).size > 1;
  // Tablero: cantidades por estado y próximas cargas
  const [filtro, setFiltro] = useState(null); // null | estado | "hoy" | "manana" | "atrasadas" | id de razón social
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const manana = new Date(new Date(`${hoy}T12:00:00-03:00`).getTime() + 864e5).toISOString().slice(0, 10);
  const activos = (x) => !["rechazado", "cancelado", "finalizado"].includes(est(x));
  const pasa = (x, f) =>
    !f ? true
    : f === "hoy" ? activos(x) && x.orden.fecha_carga === hoy
    : f === "manana" ? activos(x) && x.orden.fecha_carga === manana
    : f === "atrasadas" ? ["asignado", "falta"].includes(est(x)) && x.orden.fecha_carga && x.orden.fecha_carga < hoy
    : f.startsWith("t:") ? x.pedido.transportista_id === f.slice(2)
    : est(x) === f;
  const cuenta = (f) => lista.filter((x) => pasa(x, f)).length;
  const porRS = useMemo(() => {
    const m = new Map();
    for (const x of lista) {
      const k = x.pedido.transportista_id;
      if (!m.has(k)) m.set(k, { id: k, nombre: x.transporte, total: 0, pend: 0 });
      const o = m.get(k); o.total++; if (["asignado", "falta"].includes(est(x))) o.pend++;
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [lista]);
  const ordenada = useMemo(() => {
    const num = (v) => String(v || "").replace(/\d+/g, (d) => d.padStart(8, "0"));
    const k = (x) => orden === "numero" ? num(x.orden.numero) : orden === "estado" ? `${PESO[est(x)]}${x.orden.fecha_carga || "9999"}` : orden === "transporte" ? `${x.transporte || ""}${x.orden.fecha_carga || "9999"}` : x.orden.fecha_carga || "9999";
    const out = [...lista].sort((a, b) => k(a).localeCompare(k(b)) || num(a.orden.numero).localeCompare(num(b.orden.numero)));
    const f = orden === "carga_desc" ? out.reverse() : out;
    return f.filter((x) => pasa(x, filtro));
  }, [lista, orden, filtro]);
  const cambiarOrden = (v) => { setOrden(v); try { localStorage.setItem("misPedidosOrden", v); } catch {} };

  const abrirUnidad = (x) => setForm({ id: x.pedido.id, modo: "unidad", nombre: x.orden.chofer?.nombre || "", doc: x.orden.chofer?.dni || "", soloDni: /^\d{7,8}$/.test(x.orden.chofer?.dni || ""), chasis: x.orden.chasis || "", acoplado: x.orden.acoplado || "", tipo: x.pedido.tipo_equipo || x.orden.tipo_unidad || "", rs: x.pedido.transportista_id });
  const responder = async (args) => {
    setError("");
    setGuardando(true);
    const { error: e } = await supabase.rpc("responder_pedido", args);
    setGuardando(false);
    if (e) return setError(friendlyError(e));
    setForm(null);
    cargar();
  };
  const aceptar = (x) => (eligeRS ? setForm({ id: x.pedido.id, modo: "aceptar", rs: x.pedido.transportista_id }) : responder({ p_pedido: x.pedido.id, p_acepta: true }));
  const enviar = () =>
    form.modo === "rechazar"
      ? responder({ p_pedido: form.id, p_acepta: false, p_motivo: form.motivo || "" })
      : form.modo === "aceptar"
      ? responder({ p_pedido: form.id, p_acepta: true, p_transportista: form.rs || null })
      : responder({ p_pedido: form.id, p_acepta: true, p_chofer_nombre: form.nombre, p_chofer_doc: form.doc, p_chasis: form.chasis, p_acoplado: form.acoplado, p_tipo_equipo: form.tipo, ...(eligeRS ? { p_transportista: form.rs || null } : {}) });
  const selRS = (f) => eligeRS && (
    <div className="sm:col-span-2">
      <label className="campo-etiqueta">Razón social con la que hacés el viaje</label>
      <select value={f.rs || ""} onChange={(e) => setForm({ ...f, rs: e.target.value })} className={inp}>
        {misT.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.cuit ? ` · CUIT ${t.cuit}` : ""}</option>)}
      </select>
    </div>
  );

  return (
    <NavBar profile={profile}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">Mis pedidos de unidad</h1>
          <p className="text-stone-500 text-[13px] sm:text-[13.5px]">Revisá el recorrido y la carga, y <b>aceptá</b> o <b>rechazá</b> (con motivo). El chofer, las patentes y el tipo de equipo los podés cargar al aceptar o más tarde.</p>
        </header>
        {lista.length > 0 && (
          <section className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                ["asignado", "Para responder", "Aceptá o rechazá", "border-amber-300 bg-amber-50 text-amber-900"],
                ["falta", "Falta la unidad", "Cargá chofer y patentes", "border-lime-300 bg-lime-50 text-lime-900"],
                ["aceptado", "Programados", "Con unidad · marcá “Salí”", "border-emerald-300 bg-emerald-50 text-emerald-900"],
                ["en_viaje", "En viaje", "Marcá “Entregué”", "border-indigo-300 bg-indigo-50 text-indigo-900"],
                ["finalizado", "Entregados", "Últimos 7 días", "border-stone-300 bg-white text-stone-700"],
                ["rechazado", "Rechazados", "Por vos", "border-stone-300 bg-white text-stone-700"],
              ].map(([k, t, sub, cls]) => (
                <button key={k} onClick={() => setFiltro(filtro === k ? null : k)} className={`text-left rounded-lg border px-3 py-2.5 ${cls} ${filtro === k ? "ring-2 ring-offset-1 ring-stone-700" : ""}`}>
                  <div className="text-[26px] leading-none font-semibold">{cuenta(k)}</div>
                  <div className="text-[13px] font-medium mt-1">{t}</div>
                  <div className="text-[11.5px] opacity-75">{sub}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-[13px]">
              {[["atrasadas", "Atrasados sin resolver", "border-red-300 text-red-700"], ["hoy", "Cargan hoy", "border-stone-300 text-stone-700"], ["manana", "Cargan mañana", "border-stone-300 text-stone-700"]].map(([k, t, cls]) => (
                <button key={k} onClick={() => setFiltro(filtro === k ? null : k)} className={`rounded-full border bg-white px-3 py-1 ${cls} ${filtro === k ? "ring-2 ring-stone-700" : ""}`}>{t}: <b>{cuenta(k)}</b></button>
              ))}
              {porRS.length > 1 && porRS.map((t) => (
                <button key={t.id} onClick={() => setFiltro(filtro === `t:${t.id}` ? null : `t:${t.id}`)} className={`rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-stone-700 ${filtro === `t:${t.id}` ? "ring-2 ring-stone-700" : ""}`}>{t.nombre}: <b>{t.total}</b>{t.pend ? <span className="text-amber-700"> · {t.pend} pendientes</span> : null}</button>
              ))}
              {filtro && <button onClick={() => setFiltro(null)} className="px-2 py-1 text-sky-700 underline">Ver todos ({lista.length})</button>}
            </div>
          </section>
        )}
        {filtro && !ordenada.length && <div className="panel p-4 text-sm text-stone-500">No hay pedidos con ese filtro.</div>}
        {lista.length > 1 && (
          <label className="text-[13px] text-stone-500 flex items-center gap-1.5">Ordenar por
            <select value={orden} onChange={(e) => cambiarOrden(e.target.value)} className="border border-stone-300 rounded-md px-2 py-1.5 text-[14px] sm:text-[13px] bg-white text-stone-800">
              {Object.entries(ORDENES).filter(([k]) => k !== "transporte" || varios).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
        )}
        {error && <div className="text-sm rounded p-3 border bg-red-50 border-red-200 text-red-700">{error}</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}
        {!cargando && !lista.length && !error && <div className="panel p-5 text-sm text-stone-500">No tenés pedidos pendientes.</div>}

        <div className="space-y-3">
          {ordenada.map((x) => {
            const { pedido: p, orden: o } = x;
            const pi = x.tipo === "interno" ? x.interno : null;
            const ls = lineasConDestino(o, x.lineas, plantasD);
            const base = ls.some((l) => Number(l.saldo) > 0) ? ls.filter((l) => Number(l.saldo) > 0) : ls;
            const u = base.reduce((a, l) => a + Number(l.cantidad || 0), 0);
            const kg = base.reduce((a, l) => a + Number(l.kilos || 0), 0);
            const deps = [...new Set(base.map((l) => corto(l.planta_nombre)).filter(Boolean))];
            const dest = [...new Set(base.map(lugar).filter(Boolean))];
            const e = est(x);
            const etq = { aceptado: ["Programado", "bg-emerald-100 text-emerald-800"], falta: ["Aceptado · falta cargar la unidad", "bg-lime-100 text-lime-800"], rechazado: ["Rechazado", "bg-red-100 text-red-700"],
              en_viaje: ["En viaje", "bg-indigo-100 text-indigo-800"], finalizado: ["Entregado", "bg-stone-200 text-stone-700"], cancelado: ["CANCELADO por Stine", "bg-red-600 text-white"] }[e] || ["Pendiente de respuesta", "bg-amber-100 text-amber-800"];
            const cerrado = ["en_viaje", "finalizado", "cancelado"].includes(e);
            const f = form?.id === p.id ? form : null;
            return (
              <div key={p.id} className={`panel p-3 sm:p-4 space-y-2 ${e === "asignado" ? "border-l-4 border-l-amber-400" : e === "falta" ? "border-l-4 border-l-lime-500" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-[16px]">{o.numero}</span>
                  <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${etq[1]}`}>{etq[0]}</span>
                  {o.fecha_carga && <span className="text-[13px] text-stone-700">Carga: <b>{fmtFecha(o.fecha_carga)}{pi ? horaTexto(pi) : ""}</b></span>}
                  <span className="text-[13px] text-stone-500">{o.tipo_unidad || "unidad a definir"}</span>
                  {pi && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-teal-100 text-teal-800">Movimiento interno</span>}
                  {o.modalidad === "traslado" && <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-violet-100 text-violet-800">Traslado</span>}
                  {(varios || eligeRS) && <span className="text-[12px] text-stone-600 bg-stone-100 rounded px-1.5 py-0.5">{p.estado === "aceptado" ? "Viaja con: " : ""}{x.transporte}</span>}
                </div>
                {pi ? (
                  <>
                    <div className="text-[13.5px]"><span className="text-stone-500">Carga en:</span> {nombrePunto(pi.carga)} <span className="text-stone-500">({lugarTexto(pi.carga)})</span></div>
                    {(pi.paradas || []).map((pa, i) => <div key={i} className="text-[13.5px]"><span className="text-stone-500">Parada {i + 1}{pa.accion ? ` (${pa.accion})` : ""}:</span> {nombrePunto(pa)} <span className="text-stone-500">({lugarTexto(pa)})</span>{detalleParada(pa) ? <span className="text-stone-600"> · {detalleParada(pa)}</span> : null}</div>)}
                    <div className="text-[13.5px]"><span className="text-stone-500">Descarga en:</span> {nombrePunto(pi.descarga)} <span className="text-stone-500">({lugarTexto(pi.descarga)})</span></div>
                    <div className="text-[13px] text-stone-700">{cargaTexto(pi) || "—"}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[13.5px]"><span className="text-stone-500">Carga en:</span> {deps.join(" · ")}</div>
                    <div className="text-[13.5px]"><span className="text-stone-500">Destinos:</span> {dest.join(" · ")}</div>
                    <div className="text-[13px] text-stone-700">{fmtNum(u)} unidades{kg ? ` · ${fmtNum(Math.round(kg))} kg` : ""}</div>
                  </>
                )}
                {o.observaciones_deposito && <div className="text-[13px] bg-sky-50 border border-sky-200 rounded px-2 py-1">{o.observaciones_deposito}</div>}
                {["aceptado", "en_viaje", "finalizado"].includes(e) && (
                  <div className="text-[13px] text-emerald-800">✓ Unidad: {o.chofer?.nombre || "—"}{o.chofer?.dni ? ` (${fmtDocChofer(o.chofer.dni)})` : ""} · {o.chasis || "—"} / {o.acoplado || "—"}{p.tipo_equipo ? ` · ${p.tipo_equipo}` : ""}</div>
                )}
                {e === "falta" && <div className="text-[13px] text-lime-800">Aceptado. Cuando tengas la unidad, cargá el chofer y las patentes.</div>}
                {p.estado === "rechazado" && <div className="text-[13px] text-red-700">Rechazado: {p.motivo_rechazo}</div>}

                {e === "cancelado" && <div className="text-[13px] text-red-700">Stine canceló este pedido{pi?.motivo_cancelacion ? `: ${pi.motivo_cancelacion}` : ""}. No hace falta hacer el viaje.</div>}
                {p.salida_at && <div className="text-[12.5px] text-indigo-800">Salió {new Date(p.salida_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{p.entrega_at ? ` · entregado ${new Date(p.entrega_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</div>}
                {!f && !cierre && ["aceptado", "en_viaje"].includes(e) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {e === "aceptado" && <button disabled={guardando} onClick={() => viaje(p.id, "salida")} className="px-3 py-2 rounded-md bg-indigo-700 text-white text-[14px] font-medium disabled:opacity-60">Salí (en viaje)</button>}
                    {e === "en_viaje" && <button disabled={guardando} onClick={() => (pi ? setCierre({ id: p.id, remito: pi.remito || "", cpe: pi.cpe || "", km: pi.km ?? "", kg_descargados: pi.kg_descargados ?? "" }) : viaje(p.id, "entrega"))} className="px-3 py-2 rounded-md bg-indigo-700 text-white text-[14px] font-medium disabled:opacity-60">Entregué</button>}
                    {e === "en_viaje" && <button disabled={guardando} onClick={() => viaje(p.id, "deshacer")} className="px-3 py-2 text-[13px] text-stone-500 underline">Deshacer “Salí”</button>}
                  </div>
                )}
                {cierre?.id === p.id && (
                  <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                    <div className="text-[13px] text-stone-700">Datos del viaje (si los tenés; se pueden pasar después a Logística).</div>
                    <div className="grid gap-2 grid-cols-2">
                      <div><label className="campo-etiqueta">Remito</label><input value={cierre.remito} onChange={(ev) => setCierre({ ...cierre, remito: ev.target.value.toUpperCase() })} className={inp} /></div>
                      <div><label className="campo-etiqueta">CPE</label><input value={cierre.cpe} onChange={(ev) => setCierre({ ...cierre, cpe: ev.target.value.toUpperCase() })} className={inp} /></div>
                      <div><label className="campo-etiqueta">Km</label><input inputMode="decimal" value={cierre.km} onChange={(ev) => setCierre({ ...cierre, km: ev.target.value.replace(/[^\d.,]/g, "") })} className={inp} /></div>
                      <div><label className="campo-etiqueta">Kg descargados</label><input inputMode="decimal" value={cierre.kg_descargados} onChange={(ev) => setCierre({ ...cierre, kg_descargados: ev.target.value.replace(/[^\d.,]/g, "") })} className={inp} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={guardando} onClick={() => viaje(p.id, "entrega", { remito: cierre.remito, cpe: cierre.cpe, km: String(cierre.km), kg_descargados: String(cierre.kg_descargados) })} className="px-3 py-2 rounded-md bg-indigo-700 text-white text-[14px] font-medium disabled:opacity-60">Confirmar entrega</button>
                      <button onClick={() => setCierre(null)} className="px-3 py-2 text-[14px] text-stone-500">Cancelar</button>
                    </div>
                  </div>
                )}
                {!f && !cerrado && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {p.estado !== "aceptado" && <button disabled={guardando} onClick={() => aceptar(x)} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium disabled:opacity-60">Aceptar</button>}
                    <button onClick={() => abrirUnidad(x)} className={`px-3 py-2 rounded-md text-[14px] font-medium ${e === "falta" ? "bg-emerald-700 text-white" : "border border-emerald-600 text-emerald-800 bg-white"}`}>{e === "aceptado" ? "Cambiar la unidad" : p.estado === "aceptado" ? "Cargar la unidad" : "Aceptar y cargar la unidad"}</button>
                    {p.estado !== "rechazado" && <button onClick={() => setForm({ id: p.id, modo: "rechazar", motivo: "" })} className="px-3 py-2 rounded-md border border-stone-300 bg-white text-[14px]">Rechazar</button>}
                    <button onClick={() => setVer(ver === p.id ? null : p.id)} className="px-3 py-2 text-[13.5px] text-sky-700 underline">{ver === p.id ? "Ocultar recorrido" : "Ver recorrido y carga"}</button>
                  </div>
                )}
                {f?.modo === "unidad" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selRS(f)}
                      <div><label className="campo-etiqueta">Chofer (nombre y apellido)</label><input value={f.nombre} onChange={(e) => setForm({ ...f, nombre: e.target.value.toUpperCase() })} className={inp} /></div>
                      <div>
                        <label className="campo-etiqueta">{f.soloDni ? "DNI del chofer" : "CUIL del chofer"}</label>
                        <input value={f.doc} inputMode="numeric" onChange={(e) => setForm({ ...f, doc: e.target.value.replace(/\D/g, "").slice(0, f.soloDni ? 8 : 11) })} placeholder={f.soloDni ? "7 u 8 dígitos" : "11 dígitos"} className={inp} />
                        <label className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-600"><input type="checkbox" checked={f.soloDni} onChange={(e) => setForm({ ...f, soloDni: e.target.checked, doc: f.doc.slice(0, e.target.checked ? 8 : 11) })} /> Solo tengo el DNI</label>
                      </div>
                      <div><label className="campo-etiqueta">Patente chasis</label><input value={f.chasis} onChange={(e) => setForm({ ...f, chasis: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                      <div><label className="campo-etiqueta">Patente acoplado</label><input value={f.acoplado} onChange={(e) => setForm({ ...f, acoplado: pat(e.target.value) })} className={`${inp} font-mono`} /></div>
                      <div className="sm:col-span-2">
                        <label className="campo-etiqueta">Tipo de equipo</label>
                        <select value={f.tipo} onChange={(e) => setForm({ ...f, tipo: e.target.value })} className={inp}>
                          <option value="">Elegir…</option>
                          {f.tipo && !TIPOS_UNIDAD.includes(f.tipo) && <option value={f.tipo}>{f.tipo}</option>}
                          {TIPOS_UNIDAD.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={guardando} onClick={enviar} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium disabled:opacity-60">{guardando ? "Guardando…" : "Confirmar"}</button>
                      <button onClick={() => setForm(null)} className="px-3 py-2 text-[14px] text-stone-500">Cancelar</button>
                    </div>
                  </div>
                )}
                {f?.modo === "aceptar" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">{selRS(f)}</div>
                    <div className="flex gap-2">
                      <button disabled={guardando} onClick={enviar} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px] font-medium disabled:opacity-60">{guardando ? "Guardando…" : "Aceptar"}</button>
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
                {cerrado && <button onClick={() => setVer(ver === p.id ? null : p.id)} className="px-1 text-[13px] text-sky-700 underline">{ver === p.id ? "Ocultar recorrido" : "Ver recorrido"}</button>}
                {ver === p.id && (pi ? <RecorridoInterno pi={{ ...pi, transporte: x.transporte }} onCerrar={() => setVer(null)} /> : <PedidoUnidad orden={o} lineas={x.lineas} plantas={plantasD} soloLectura onCerrar={() => setVer(null)} />)}
              </div>
            );
          })}
        </div>
      </div>
    </NavBar>
  );
}
