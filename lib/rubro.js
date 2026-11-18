"use client";
// Selector global de rubro (Todo / Soja / Maíz). Se recuerda en este navegador y
// todas las pantallas que lo usan se actualizan al cambiarlo desde la franja superior.
import { useEffect, useState } from "react";

export const RUBROS = [["", "Todo"], ["soja", "Soja"], ["maiz", "Maíz"]];
const KEY = "rubroGlobal";
const EVT = "rubro-cambio";

export function leerRubro() {
  try { const v = localStorage.getItem(KEY) || ""; return v === "soja" || v === "maiz" ? v : ""; } catch { return ""; }
}

export function fijarRubro(v) {
  try { localStorage.setItem(KEY, v || ""); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: v || "" })); } catch {}
}

export function useRubro() {
  const [rubro, setRubro] = useState("");
  useEffect(() => {
    setRubro(leerRubro());
    const f = (e) => setRubro(e.detail || "");
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, []);
  return [rubro, fijarRubro];
}

// ¿La categoría de un producto pasa el filtro? (otros materiales: solo con "Todo")
export const pasaCat = (rubro, cat) => !rubro || cat === rubro;
// ¿La planta despacha ese rubro?
export const plantaPasa = (rubro, p) => !rubro || !p?.despacha || p.despacha === "ambos" || p.despacha === rubro;
