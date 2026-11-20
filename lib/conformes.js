"use client";
// Remito conforme de salida: fotos o PDF guardados en Supabase Storage (carpeta privada "conformes"),
// ruta <remito_id>/<archivo>. Los permisos los controla la base (migration_62).
import { supabase } from "@/lib/supabaseClient";

export const BUCKET = "conformes";
const MAX_LADO = 1800; // px del lado mayor después de achicar la foto
const MAX_BYTES = 10 * 1024 * 1024;

// Achica una foto a JPEG (~200-400 KB). Si el navegador no la puede abrir (ej. HEIC en Chrome), devuelve el original.
export async function comprimirImagen(file) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = mal;
      i.src = url;
    });
    const k = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.78));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const ext = (f) => (f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : /hei[cf]/.test(f.type) ? "heic" : "jpg");

// Sube un archivo y lo registra. destino = { tipo: "orden", orden_id, planta_id } o { tipo: "remito", id }.
// Devuelve { error } con un texto para mostrar.
export async function subirConforme(destino, original) {
  if (!original) return { error: "No se eligió ningún archivo." };
  const okTipo = original.type === "application/pdf" || original.type.startsWith("image/");
  if (!okTipo) return { error: "Solo se aceptan fotos (JPG, PNG) o PDF." };
  const f = await comprimirImagen(original);
  if (f.size > MAX_BYTES) return { error: "El archivo pesa más de 10 MB. Sacá la foto de nuevo o achicá el PDF." };
  const archivo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext(f)}`;
  const esOrden = destino.tipo === "orden";
  const path = esOrden ? `o/${destino.orden_id}/${destino.planta_id}/${archivo}` : `${destino.id}/${archivo}`;
  const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
  if (up.error) return { error: "No se pudo subir el archivo: " + (up.error.message || "error de red") };
  const datos = { p_path: path, p_nombre: original.name || f.name || "", p_tipo: f.type || "", p_tamano: f.size };
  const { error } = esOrden
    ? await supabase.rpc("registrar_conforme_orden", { p_orden_id: destino.orden_id, p_planta_id: destino.planta_id, ...datos })
    : await supabase.rpc("registrar_conforme", { p_remito_id: destino.id, ...datos });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }
  return { ok: true };
}

export async function abrirConforme(path) {
  // Se abre la pestaña antes de pedir el link (si no, el celular la bloquea como ventana emergente).
  const w = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) {
    if (w) w.close();
    return { error: "No se pudo abrir el archivo." };
  }
  if (w) w.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
  return { ok: true };
}

// Primero el archivo (la regla de Storage mira el registro), después el registro.
export async function borrarConforme(c) {
  const r = await supabase.storage.from(BUCKET).remove([c.path]);
  if (r.error) return { error: "No se pudo borrar el archivo: " + r.error.message };
  const { error } = await supabase.rpc(c.orden_id ? "borrar_conforme_orden" : "borrar_conforme", { p_id: c.id });
  if (error) return { error: error.message };
  return { ok: true };
}

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
// Mismo criterio que la base: admin siempre; los demás, lo propio y del mismo día.
export const puedeBorrar = (c, profile) =>
  profile?.rol === "admin" || (profile?.rol !== "consulta" && c.subido_por === profile?.id && new Date(c.created_at).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) === hoyAR());

// Sube: Admin y Logística, cualquiera; la planta, solo lo suyo.
export const puedeSubir = (destino, profile) =>
  !!destino && !["anulado", "rechazado"].includes(destino.estado) &&
  (profile?.rol === "admin" || profile?.rol === "logistica" || (profile?.rol === "operador" && destino.planta_id === profile?.planta?.id));

export async function conformesDe(remitoIds) {
  if (!remitoIds.length) return {};
  const { data } = await supabase.from("remito_conformes").select("*").in("remito_id", remitoIds).order("created_at");
  const m = {};
  for (const c of data || []) (m[c.remito_id] ||= []).push(c);
  return m;
}

// Archivos de órdenes: { "<orden_id>|<planta_id>": [ ... ] }
export async function conformesDeOrdenes(ordenIds) {
  if (!ordenIds.length) return {};
  const { data } = await supabase.from("orden_conformes").select("*").in("orden_id", ordenIds).order("created_at");
  const m = {};
  for (const c of data || []) (m[`${c.orden_id}|${c.planta_id}`] ||= []).push(c);
  return m;
}

export async function marcarNA(remitoId, na, motivo) {
  const { error } = await supabase.rpc("marcar_conforme_na", { p_remito_id: remitoId, p_na: na, p_motivo: motivo || null });
  return error ? { error: error.message } : { ok: true };
}
