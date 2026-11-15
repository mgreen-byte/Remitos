-- =====================================================================
-- Migración 49: órdenes de carga de MAÍZ
--  * fijar_modalidad_orden(): marca una orden como de soja o de maíz (las que se suben por Excel
--    se marcan solas según el archivo). No aplica a órdenes de traslado.
-- =====================================================================
create or replace function public.fijar_modalidad_orden(p_numero text, p_modalidad text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype;
begin
  v_user := _usuario_activo();
  if v_user.rol = 'consulta' then raise exception 'Tu usuario no puede modificar órdenes'; end if;
  if p_modalidad not in ('soja', 'maiz') then raise exception 'Modalidad inválida'; end if;
  update ordenes_carga set modalidad = p_modalidad
  where upper(btrim(numero)) = upper(btrim(p_numero)) and modalidad in ('soja', 'maiz') and modalidad <> p_modalidad;
end $$;
revoke execute on function public.fijar_modalidad_orden(text, text) from public, anon;
grant execute on function public.fijar_modalidad_orden(text, text) to authenticated;
notify pgrst, 'reload schema';
