-- =====================================================================
-- Migración 59: la ubicación (gps) acepta también coordenadas sueltas
--  * Plantas y líneas de órdenes de carga: link (https://…) o coordenadas "lat, lng" (ej. -33.74, -61.96).
-- =====================================================================
alter table public.plantas drop constraint if exists plantas_gps_check;
alter table public.plantas add constraint plantas_gps_check check (
  gps is null or (length(gps) <= 500 and (gps ~* '^https?://' or gps ~ '^\s*-?\d{1,2}([.,]\d+)?\s*[,;]\s*-?\d{1,3}([.,]\d+)?\s*$')));
alter table public.ordenes_carga_lineas drop constraint if exists ordenes_carga_lineas_gps_check;
alter table public.ordenes_carga_lineas add constraint ordenes_carga_lineas_gps_check check (
  gps is null or (length(gps) <= 500 and (gps ~* '^https?://' or gps ~ '^\s*-?\d{1,2}([.,]\d+)?\s*[,;]\s*-?\d{1,3}([.,]\d+)?\s*$')));
notify pgrst, 'reload schema';
