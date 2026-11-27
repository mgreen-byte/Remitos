"use client";
// Movimientos: todos los viajes (órdenes a clientes, traslados y pedidos internos) para seguir los despachos
// y, más adelante, controlar la facturación de los transportes. Una fila por viaje.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";
import { fmtFecha, fmtNum, fmtDocChofer, friendlyError, norm } from "@/lib/util";
import { PEDIDOS_DESDE } from "@/lib/pedidosPortal";

export default function MovimientosPage() {
  return <AuthGuard roles={["admin", "logistica", "consulta"]}>{(profile) => <Movimientos profile={profile} />}</AuthGuard>;
}

const TIPO = { cliente: ["Cliente", "bg-emerald-100 text-emerald-800"], traslado: ["Traslado", "bg-violet-100 text-violet-800"], interno: ["Interno", "bg-teal-100 text-teal-800"] };
// Estado del viaje (mismo criterio que Pedidos de unidad)
function estadoMov(x) {
  const pu = x.pedido;
  if (x.k === "i") {
    if (x.interno_estado === "cancelado") return "cancelado";
    if (x.interno_estado === "pendiente") return "por_confirmar";
  } else {
    if (x.retira_cliente) return "retira";
    if (x.desestimado && !pu) return "desestimado";
  }
  if (pu?.entrega_at) return "finalizado";
  if (pu?.salida_at) return "en_ejecucion";
  if (x.k === "o" && x.orden_estado === "cerrada") return "despachada";
  if (!pu) return x.remitos?.length ? "remitida" : "sin_asignar";
  if (pu.estado === "aceptado") return pu.unidad_at || x.chasis ? "programado" : "falta_unidad";
  return pu.estado === "rechazado" ? "rechazado" : "asignado";
}
const ESTADO = {
  por_confirmar: ["Por confirmar", "bg-amber-100 text-amber-800"],
  sin_asignar: ["Sin asignar", "bg-orange-100 text-orange-800"],
  asignado: ["Esperando transporte", "bg-sky-100 text-sky-800"],
  rechazado: ["Rechazado", "bg-red-100 text-red-700"],
  falta_unidad: ["Falta la unidad", "bg-lime-100 text-lime-800"],
  programado: ["Programado", "bg-emerald-100 text-emerald-800"],
  en_ejecucion: ["En ejecución", "bg-indigo-100 text-indigo-800"],
  remitida: ["Con remitos (en curso)", "bg-emerald-50 text-emerald-800"],
  despachada: ["Despachada (orden cerrada)", "bg-stone-200 text-stone-700"],
  finalizado: ["Finalizado", "bg-stone-200 text-stone-700"],
  retira: ["Retira el cliente", "bg-stone-100 text-stone-600"],
  desestimado: ["Desestimado", "bg-stone-100 text-stone-500"],
  cancelado: ["Cancelado", "bg-stone-100 text-stone-500"],
};
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const cargaTxt = (x) => (x.k === "i"
  ? [x.carga?.tipo, x.carga?.kg ? `${fmtNum(x.carga.kg)} kg` : "", x.carga?.bolsas ? `${fmtNum(x.carga.bolsas)} bolsas` : "", x.carga?.pallets ? `${fmtNum(x.carga.pallets)} pallets` : ""].filter(Boolean).join(" · ")
  : [x.carga?.productos, x.carga?.unidades ? `${fmtNum(x.carga.unidades)} u.` : "", x.carga?.kg ? `${fmtNum(Math.round(x.carga.kg))} kg` : ""].filter(Boolean).join(" · "));
const remitosTxt = (x) => (x.remitos || []).map((r) => r.numero).join(", ");
// Camión: el de la orden / pedido; si no, el de los remitos
const camion = (x) => {
  const r = (x.remitos || []).find((y) => y.chasis) || {};
  return {
    transporte: x.transporte || x.pedido?.transporte || r.transporte || "",
    chofer: x.chofer?.nombre || r.chofer || "",
    doc: x.chofer?.dni ? fmtDocChofer(x.chofer.dni) : "",
    chasis: x.chasis || r.chasis || "",
    acoplado: x.acoplado || r.acoplado || "",
  };
};

function Movimientos({ profile }) {
  const [f, setF] = useState({ desde: PEDIDOS_DESDE.slice(0, 10), hasta: hoy(), tipo: "", estado: "", texto: "", subsidiaria: "" });
  const [rows, setRows] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const { data, error: e } = await supabase.rpc("movimientos", { p_desde: f.desde || null, p_hasta: f.hasta || null });
    setCargando(false);
    if (e) return setError(/movimientos/.test(e.message || "") ? "Falta correr migration_76.sql en Supabase." : friendlyError(e));
    setRows(data || []);
  }, [f.desde, f.hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const conEstado = useMemo(() => rows.map((x) => ({ ...x, est: estadoMov(x), cam: camion(x) })), [rows]);
  const subsidiarias = [...new Set(rows.map((x) => x.subsidiaria).filter(Boolean))].sort();
  const visibles = conEstado.filter((x) =>
    (!f.tipo || x.tipo === f.tipo) && (!f.estado || x.est === f.estado) && (!f.subsidiaria || (f.subsidiaria === "__sin" ? !x.subsidiaria : x.subsidiaria === f.subsidiaria)) &&
    (!f.texto || [x.numero, x.origen, x.destino, x.clientes, x.cam.transporte, x.cam.chofer, x.cam.chasis, x.cam.acoplado, remitosTxt(x), x.cuenta, x.categoria, x.area].some((t) => norm(t).includes(norm(f.texto)))));
  const cuentaEst = (e) => conEstado.filter((x) => (!f.tipo || x.tipo === f.tipo) && x.est === e).length;

  const exportar = () => {
    const filas = visibles.map((x) => ({
      Tipo: TIPO[x.tipo][0], Número: x.numero, "Fecha de carga": x.fecha ? fmtFecha(x.fecha) : "", Estado: ESTADO[x.est][0],
      Origen: x.origen || "", Destino: x.destino || "", Clientes: x.clientes || "", Área: x.area || "",
      Carga: cargaTxt(x), Unidades: x.carga?.unidades != null ? Number(x.carga.unidades) : "", Kg: x.carga?.kg != null ? Number(x.carga.kg) : "",
      "Kg descargados": x.carga?.kg_descargados != null ? Number(x.carga.kg_descargados) : "",
      Transporte: x.cam.transporte, Chofer: x.cam.chofer, "CUIL/DNI": x.cam.doc, Chasis: x.cam.chasis, Acoplado: x.cam.acoplado,
      "Tipo de equipo": x.pedido?.tipo_equipo || "",
      Remitos: remitosTxt(x), CPE: x.cpe || "", Km: x.km != null ? Number(x.km) : "",
      Salida: x.pedido?.salida_at ? new Date(x.pedido.salida_at).toLocaleString("es-AR") : "", Entrega: x.pedido?.entrega_at ? new Date(x.pedido.entrega_at).toLocaleString("es-AR") : "",
      Subsidiaria: x.subsidiaria || "", Cuenta: x.cuenta || "", Categoría: x.categoria || "", Departamento: x.departamento || "",
      Empresa: x.empresa === "ms" ? "MS Technologies" : x.empresa === "stine" ? "Stine Seed" : "",
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = Object.keys(filas[0] || { a: 1 }).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
    XLSX.writeFile(wb, `movimientos_${f.desde || "inicio"}_a_${f.hasta || hoy()}.xlsx`);
  };

  const inp = "border border-stone-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white";
  const lab = "block text-[11.5px] text-stone-500 mb-0.5";
  return (
    <NavBar profile={profile}>
      <div className="max-w-[1500px] mx-auto px-4 md:px-6 py-6 space-y-4">
        <header>
          <h1 className="text-[22px] font-semibold text-stone-900">Movimientos</h1>
          <p className="text-stone-500 text-[13.5px]">Todos los viajes (órdenes a clientes, traslados y pedidos internos) desde el {fmtFecha(PEDIDOS_DESDE.slice(0, 10))}: estado, recorrido, carga, camión, remitos y datos contables. Una fila por viaje. Base para el control de facturación de los transportes.</p>
        </header>

        <div className="panel p-3 flex flex-wrap items-end gap-3">
          <div><label className={lab}>Carga desde</label><input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={inp} /></div>
          <div><label className={lab}>Hasta</label><input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className={inp} /></div>
          <div><label className={lab}>Tipo</label>
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={inp}>
              <option value="">Todos</option><option value="cliente">Clientes</option><option value="traslado">Traslados</option><option value="interno">Internos</option>
            </select>
          </div>
          <div><label className={lab}>Estado</label>
            <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} className={inp}>
              <option value="">Todos</option>
              {Object.entries(ESTADO).map(([k, [t]]) => <option key={k} value={k}>{t} ({cuentaEst(k)})</option>)}
            </select>
          </div>
          <div><label className={lab}>Subsidiaria</label>
            <select value={f.subsidiaria} onChange={(e) => setF({ ...f, subsidiaria: e.target.value })} className={inp}>
              <option value="">Todas</option>{subsidiarias.map((s) => <option key={s} value={s}>{s}</option>)}<option value="__sin">Sin subsidiaria</option>
            </select>
          </div>
          <div className="flex-1 min-w-[220px]"><label className={lab}>Buscar</label><input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Número, cliente, destino, transporte, patente, remito…" className={`${inp} w-full`} /></div>
          <button onClick={exportar} disabled={!visibles.length} className="border border-emerald-700 text-emerald-800 text-[13px] px-3 py-1.5 rounded disabled:opacity-40">Exportar Excel ({visibles.length})</button>
        </div>

        {error && <div className="text-sm rounded p-3 border bg-red-50 border-red-200 text-red-700">{error}</div>}
        {cargando && <div className="text-sm text-stone-500">Cargando…</div>}

        <div className="panel overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200 bg-stone-50">
                <th className="p-2">Tipo</th><th className="p-2">Número</th><th className="p-2">Fecha de carga</th><th className="p-2">Estado</th>
                <th className="p-2">Origen → Destino</th><th className="p-2">Carga</th><th className="p-2">Transporte · chofer · patentes</th>
                <th className="p-2">Remitos</th><th className="p-2">Subsidiaria · Cuenta · Categoría</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((x) => {
                const [tt, tc] = TIPO[x.tipo];
                const [et, ec] = ESTADO[x.est];
                const ab = abierto === x.id;
                return (
                  <tr key={x.id} onClick={() => setAbierto(ab ? null : x.id)} className={`border-b border-stone-100 align-top cursor-pointer hover:bg-stone-50 ${ab ? "bg-sky-50/50" : ""}`}>
                    <td className="p-2"><span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${tc}`}>{tt}</span></td>
                    <td className="p-2 font-medium whitespace-nowrap">
                      {x.k === "o" ? <a href={`/ordenes?oc=${encodeURIComponent(x.numero)}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{x.numero}</a> : x.numero}
                      {x.area && <div className="text-[11px] text-stone-500 font-normal">{x.area}</div>}
                    </td>
                    <td className="p-2 whitespace-nowrap">{x.fecha ? fmtFecha(x.fecha) : "—"}</td>
                    <td className="p-2"><span className={`text-[11px] font-medium rounded px-1.5 py-0.5 whitespace-nowrap ${ec}`}>{et}</span></td>
                    <td className="p-2 max-w-[280px]">
                      <div>{x.origen || "—"} <span className="text-stone-400">→</span> {x.destino || "—"}</div>
                      {x.clientes && <div className="text-[11.5px] text-stone-500">{ab ? x.clientes : String(x.clientes).slice(0, 80) + (String(x.clientes).length > 80 ? "…" : "")}</div>}
                    </td>
                    <td className="p-2 max-w-[240px]">{cargaTxt(x) || "—"}{x.carga?.kg_descargados ? <div className="text-[11.5px] text-stone-500">descargados: {fmtNum(x.carga.kg_descargados)} kg</div> : null}</td>
                    <td className="p-2 max-w-[260px]">
                      <div>{x.cam.transporte || <span className="text-stone-400">sin transporte</span>}</div>
                      {(x.cam.chofer || x.cam.chasis) && <div className="text-[11.5px] text-stone-600">{x.cam.chofer}{x.cam.doc ? ` (${x.cam.doc})` : ""}{x.cam.chasis ? ` · ${x.cam.chasis}` : ""}{x.cam.acoplado ? ` / ${x.cam.acoplado}` : ""}</div>}
                      {x.pedido?.tipo_equipo && <div className="text-[11px] text-stone-400">{x.pedido.tipo_equipo}</div>}
                    </td>
                    <td className="p-2 font-mono text-[11.5px]">{(x.remitos || []).length ? (x.remitos || []).map((r, i) => <div key={i} className="whitespace-nowrap">{r.numero}{r.fecha ? <span className="text-stone-400 font-sans"> {fmtFecha(r.fecha)}</span> : null}</div>) : <span className="text-stone-400 font-sans">—</span>}{x.cpe && <div className="font-sans text-stone-500">CPE {x.cpe}</div>}</td>
                    <td className="p-2 max-w-[220px]">
                      {[x.subsidiaria, x.cuenta, x.categoria].some(Boolean) ? <>{x.subsidiaria && <div>{x.subsidiaria}</div>}<div className="text-[11.5px] text-stone-500">{[x.cuenta, x.categoria].filter(Boolean).join(" · ")}</div></> : <span className="text-amber-700 text-[11.5px]">sin datos contables</span>}
                    </td>
                  </tr>
                );
              })}
              {!cargando && !visibles.length && <tr><td colSpan={9} className="p-4 text-stone-500">No hay movimientos con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="text-[12px] text-stone-500">Subsidiaria, Cuenta y Categoría: los internos usan las del pedido; órdenes y traslados, las de Administración → Reglas contables (según la empresa de la planta). La tarifa y la factura del transporte se suman en la próxima etapa.</div>
      </div>
    </NavBar>
  );
}
