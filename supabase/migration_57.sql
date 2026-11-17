-- =====================================================================
-- Migración 57: pedido de unidad al transporte
--  * Plantas: contacto del depósito (nombre, teléfono) y horario de atención. La ubicación ya existe (gps).
--  * Órdenes de carga: tipo de unidad pedida (chasis, chasis y acoplado, semirremolque…).
-- =====================================================================
alter table public.plantas add column if not exists contacto_nombre text;
alter table public.plantas add column if not exists contacto_telefono text;
alter table public.plantas add column if not exists horario_atencion text;
alter table public.ordenes_carga add column if not exists tipo_unidad text;

create or replace function public.fijar_tipo_unidad(p_orden uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo el administrador arma el pedido de unidad'; end if;
  update ordenes_carga set tipo_unidad = nullif(btrim(coalesce(p_tipo, '')), '') where id = p_orden;
end $$;
revoke execute on function public.fijar_tipo_unidad(uuid, text) from public, anon;
grant execute on function public.fijar_tipo_unidad(uuid, text) to authenticated;
notify pgrst, 'reload schema';
