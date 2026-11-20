"use client";
// Dentro de una orden de carga: el conforme de salida de cada planta (un PDF o fotos con todos sus remitos).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { conformesDe, conformesDeOrdenes } from "@/lib/conformes";
import ConformesRemito from "@/components/Conformes";

export default function ConformesOrden({ ordenId, lineaIds = [], plantas = [], profile, onCambio }) {
  const [remitos, setRemitos] = useState(null);
  const [porOrden, setPorOrden] = useState({});
  const [porRemito, setPorRemito] = useState({});
  const clave = lineaIds.join(",");

  const cargar = useCallback(async () => {
    const SEL = "id, planta_id, punto_venta, numero, fecha, created_at, estado";
    const [a, b] = await Promise.all([
      supabase.from("remitos").select(SEL).eq("orden_id", ordenId),
      clave ? supabase.from("remito_items").select(`remito:remitos(${SEL})`).in("orden_linea_id", clave.split(",")) : Promise.resolve({ data: [] }),
    ]);
    const m = new Map();
    for (const r of [...(a.data || []), ...((b.data || []).map((x) => x.remito))]) if (r && !["anulado", "rechazado"].includes(r.estado)) m.set(r.id, r);
    const rs = [...m.values()].sort((x, y) => String(x.numero).localeCompare(String(y.numero)));
    const [po, pr] = await Promise.all([conformesDeOrdenes([ordenId]), conformesDe(rs.map((r) => r.id))]);
    setRemitos(rs);
    setPorOrden(po);
    setPorRemito(pr);
  }, [ordenId, clave]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!remitos || !remitos.length) return null;
  const nomPlanta = (id) => plantas.find((p) => p.id === id)?.nombre || "Planta";
  const plantasOrden = [...new Set(remitos.map((r) => r.planta_id))];
  // Un remito queda cubierto si hay un archivo de esa orden y planta subido después que él (o uno propio).
  const cubierto = (r) => (porRemito[r.id] || []).length > 0 || (porOrden[`${ordenId}|${r.planta_id}`] || []).some((c) => c.created_at >= r.created_at);

  return (
    <div className="rounded-md border border-stone-200">
      <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-[13px] font-semibold text-stone-800">Conforme de salida</div>
      <div className="divide-y divide-stone-100">
        {plantasOrden.map((pid) => {
          const rs = remitos.filter((r) => r.planta_id === pid);
          const faltan = rs.filter((r) => !cubierto(r));
          return (
            <div key={pid} className="px-3 py-2.5 space-y-1.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-2">
                {plantasOrden.length > 1 && <span className="font-medium text-stone-800">{nomPlanta(pid)}</span>}
                {faltan.length ? (
                  <span className="text-amber-700">Falta el conforme de {faltan.map((r) => `${r.punto_venta}-${r.numero}`).join(", ")}</span>
                ) : (
                  <span className="text-emerald-700">✓ Conforme cargado ({rs.length} remito{rs.length === 1 ? "" : "s"})</span>
                )}
              </div>
              <ConformesRemito compacto destino={{ tipo: "orden", orden_id: ordenId, planta_id: pid }} archivos={porOrden[`${ordenId}|${pid}`] || []} profile={profile} onCambio={() => { cargar(); onCambio && onCambio(); }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
