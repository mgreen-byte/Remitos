"use client";
// Dentro de una orden de carga: sus remitos y el conforme de salida de cada uno.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { conformesDe } from "@/lib/conformes";
import { fmtFecha } from "@/lib/util";
import ConformesRemito from "@/components/Conformes";

export default function ConformesOrden({ ordenId, lineaIds = [], profile, onCambio }) {
  const [remitos, setRemitos] = useState(null);
  const [archivos, setArchivos] = useState({});
  const clave = lineaIds.join(",");

  const cargar = useCallback(async () => {
    const SEL = "id, planta_id, punto_venta, numero, fecha, created_at, estado, tipo, cliente_nombre, chasis";
    const [a, b] = await Promise.all([
      supabase.from("remitos").select(SEL).eq("orden_id", ordenId),
      clave ? supabase.from("remito_items").select(`remito:remitos(${SEL})`).in("orden_linea_id", clave.split(",")) : Promise.resolve({ data: [] }),
    ]);
    const m = new Map();
    for (const r of [...(a.data || []), ...((b.data || []).map((x) => x.remito))]) if (r && !["anulado", "rechazado"].includes(r.estado)) m.set(r.id, r);
    const rs = [...m.values()].sort((x, y) => String(x.numero).localeCompare(String(y.numero)));
    setRemitos(rs);
    setArchivos(await conformesDe(rs.map((r) => r.id)));
  }, [ordenId, clave]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!remitos || !remitos.length) return null;
  const faltan = remitos.filter((r) => !(archivos[r.id] || []).length).length;
  return (
    <div className="rounded-md border border-stone-200">
      <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-[13px] flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-800">Remitos conformes</span>
        {faltan ? <span className="text-amber-700">· faltan {faltan} de {remitos.length}</span> : <span className="text-emerald-700">· completos</span>}
      </div>
      <div className="divide-y divide-stone-100">
        {remitos.map((r) => (
          <div key={r.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <span className="font-mono">{r.punto_venta}-{r.numero}</span>
            <span className="text-stone-500">{fmtFecha(r.fecha)}</span>
            <span className="text-stone-700 truncate max-w-[220px]">{r.cliente_nombre}</span>
            <div className="sm:ml-auto">
              <ConformesRemito compacto remito={r} archivos={archivos[r.id] || []} profile={profile} onCambio={() => { cargar(); onCambio && onCambio(); }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
