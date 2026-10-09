"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function NavBar({ profile }) {
  const pathname = usePathname();
  const router = useRouter();

  const tabs = [
    ["/generar", "Generar remito"],
    ["/stock", "Stock"],
    ["/historial", "Historial"],
    ...(profile?.rol === "admin" ? [["/admin", "Admin"]] : []),
  ];

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="no-print">
      <div className="bg-emerald-900 text-emerald-50 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <span className="font-semibold tracking-wide text-lg">Remitos</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-emerald-200">
            {profile?.nombre}
            {profile?.planta ? ` · ${profile.planta.nombre}` : profile?.rol === "admin" ? " · Admin" : ""}
          </span>
          <button onClick={logout} className="bg-emerald-800 hover:bg-emerald-700 px-3 py-1.5 rounded">
            Cerrar sesión
          </button>
        </div>
      </div>
      <div className="bg-white border-b border-stone-200 px-6 flex gap-1 overflow-x-auto">
        {tabs.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              pathname === href ? "border-emerald-700 text-emerald-800" : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
