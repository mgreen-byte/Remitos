"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Protege una página: exige sesión y (opcionalmente) rol admin.
// Entrega `profile` con la planta asignada (profile.planta).
export default function AuthGuard({ children, adminOnly }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, profile: null, notice: "" });

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*, planta:plantas(id, nombre, punto_venta, activa)")
        .eq("id", session.user.id)
        .single();
      if (!active) return;
      if (error || !profile) {
        setState({ loading: false, profile: null, notice: "Tu usuario todavía no tiene un perfil configurado. Pedile al administrador que lo revise." });
        return;
      }
      if (!profile.activo) {
        setState({ loading: false, profile: null, notice: "Tu usuario está desactivado. Consultá con el administrador." });
        return;
      }
      if (adminOnly && profile.rol !== "admin") {
        router.replace("/generar");
        return;
      }
      setState({ loading: false, profile, notice: "" });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.loading) return <div className="p-8 text-stone-400 text-sm">Cargando…</div>;
  if (state.notice) return <div className="p-8 text-stone-500 text-sm max-w-md">{state.notice}</div>;
  return children(state.profile);
}
