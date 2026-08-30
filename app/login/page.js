"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    router.replace("/generar");
  };

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-stone-200 p-8 w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <div className="text-xl font-semibold text-emerald-800">Remitos</div>
          <div className="text-sm text-stone-400">Iniciá sesión para continuar</div>
        </div>
        <label className="block text-xs text-stone-500">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-stone-300 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs text-stone-500">
          Contraseña
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-stone-300 rounded px-3 py-2 text-sm"
          />
        </label>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-2.5 rounded-lg transition"
        >
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
        <div className="text-xs text-stone-400 text-center pt-2">
          ¿No tenés cuenta? Pedile al admin que te invite desde el panel de Supabase.
        </div>
      </form>
    </div>
  );
}
