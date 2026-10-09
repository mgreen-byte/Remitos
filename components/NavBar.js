"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const ICONOS = {
  generar: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  stock: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  historial: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4",
  admin: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.8 7.3 4.8 7l-1 3 2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z",
};

function Icono({ d }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// Marco de la plataforma: menú lateral + contenido.
export default function NavBar({ profile, children }) {
  const pathname = usePathname();
  const router = useRouter();

  const items = [
    ["/generar", "Nuevo remito", "generar"],
    ["/stock", "Stock", "stock"],
    ["/historial", "Historial", "historial"],
    ...(profile?.rol === "admin" ? [["/admin", "Administración", "admin"]] : []),
  ];

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="print-reset min-h-screen md:flex bg-stone-100">
      <aside className="no-print md:w-60 md:flex-shrink-0 md:min-h-screen md:sticky md:top-0 md:h-screen bg-white border-b md:border-b-0 md:border-r border-stone-200 flex md:flex-col">
        <div className="px-5 py-4 md:py-6 flex-shrink-0">
          <div className="text-[17px] font-semibold tracking-tight text-emerald-800">Remitos</div>
          <div className="hidden md:block text-[12px] text-stone-400 mt-0.5">Gestión de despachos</div>
        </div>
        <nav className="flex md:flex-col gap-1 px-2 md:px-3 flex-1 items-center md:items-stretch overflow-x-auto">
          {items.map(([href, label, icono]) => {
            const activo = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] font-medium whitespace-nowrap transition ${
                  activo ? "bg-emerald-50 text-emerald-800" : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
                }`}
              >
                <Icono d={ICONOS[icono]} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block px-5 py-4 border-t border-stone-200 text-[13px]">
          <div className="font-medium text-stone-800 truncate">{profile?.nombre}</div>
          <div className="text-stone-400 text-[12px] mb-2">{profile?.planta ? profile.planta.nombre : profile?.rol === "admin" ? "Administrador" : "Sin planta"}</div>
          <button onClick={logout} className="text-stone-500 hover:text-stone-800 text-[12.5px]">
            Cerrar sesión
          </button>
        </div>
        <button onClick={logout} className="md:hidden px-4 text-[12.5px] text-stone-500 whitespace-nowrap">
          Salir
        </button>
      </aside>
      <main className="print-reset flex-1 min-w-0">{children}</main>
    </div>
  );
}
