"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.replace("/login");
      const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", session.user.id).maybeSingle();
      router.replace(perfil?.rol === "admin" || perfil?.rol === "consulta" || perfil?.rol === "logistica" ? "/inicio" : "/generar");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="p-8 text-stone-400 text-sm">Cargando…</div>;
}
