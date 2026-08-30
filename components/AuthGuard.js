"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Protege una página: exige sesión iniciada y (opcionalmente) rol admin.
// Le pasa `profile` (nombre, rol, modalidades) al children vía render-prop.
export default function AuthGuard({ children, adminOnly }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, profile: null });

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
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (!active) return;
      if (error || !profile) {
        setState({ loading: false, profile: null, notice: "Tu usuario todavía no tiene un perfil configurado. Pedile al admin que te lo cree." });
        return;
      }
      if (adminOnly && profile.rol !== "admin") {
        router.replace("/generar");
        return;
      }
      setState({ loading: false, profile });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.loading) {
    return <div className="p-8 text-stone-400 text-sm">Cargando…</div>;
  }
  if (state.notice) {
    return <div className="p-8 text-stone-500 text-sm max-w-md">{state.notice}</div>;
  }
  return children(state.profile);
}
