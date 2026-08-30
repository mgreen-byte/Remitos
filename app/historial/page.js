"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabaseClient";

export default function HistorialPage() {
  return <AuthGuard>{(profile) => <HistorialInner profile={profile} />}</AuthGuard>;
}

function HistorialInner({ profile }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("remitos_generados")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (data) setRows(data);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 flex flex-col">
      <NavBar profile={profile} />
      <div className="no-print p-6">
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">N° remito</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-left px-4 py-2">Modalidad</th>
                <th className="text-left px-4 py-2">Usuario</th>
                <th className="text-left px-4 py-2">Unid.</th>
                <th className="text-left px-4 py-2">Kgs</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-stone-400">
                    Todavía no se generó ningún remito.
                  </td>
                </tr>
              )}
              {rows.map((h) => (
                <tr key={h.id} className="border-t border-stone-100">
                  <td className="px-4 py-2">{h.fecha}</td>
                  <td className="px-4 py-2">{h.numero}</td>
                  <td className="px-4 py-2">{h.cliente}</td>
                  <td className="px-4 py-2 capitalize">{h.modalidad}</td>
                  <td className="px-4 py-2">{h.usuario_nombre}</td>
                  <td className="px-4 py-2">{h.total_unidades}</td>
                  <td className="px-4 py-2">{h.total_kgs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
