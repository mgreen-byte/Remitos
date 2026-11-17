-- =====================================================================
-- Migración 58: traslados entre plantas SOLO con orden de traslado (despacho de planta)
--  * El operador de planta ya no puede hacer un traslado libre: cada renglón tiene que venir de una
--    orden de traslado activa (las crean Administración o Logística) que salga de su planta.
--  * El Administrador puede seguir haciendo traslados sin orden.
--  * Los traslados por pallets numerados no cambian (no usan órdenes).
-- =====================================================================
do $$ begin
  if exists (select 1 from pg_proc where proname = 'emitir_traslado' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = '_emitir_traslado_base58' and pronamespace = 'public'::regnamespace) then
    alter function public.emitir_traslado(jsonb, jsonb) rename to _emitir_traslado_base58;
  end if;
end $$;
revoke execute on function public._emitir_traslado_base58(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.emitir_traslado(p_remito jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; e jsonb; v_ok boolean;
begin
  select * into v_user from profiles where id = auth.uid();
  if v_user.rol = 'operador' then
    for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      -- pallets numerados: se trasladan sin orden
      if exists (select 1 from lotes where id = nullif(e->>'lote_id', '')::uuid and lote = 'PALLETS') then continue; end if;
      select exists (
        select 1 from ordenes_carga_lineas l join ordenes_carga o on o.id = l.orden_id
        where l.id = nullif(e->>'orden_linea_id', '')::uuid
          and o.modalidad = 'traslado' and o.estado = 'activa' and l.planta_id = v_user.planta_id
      ) into v_ok;
      if not v_ok then
        raise exception 'Los traslados entre plantas solo se hacen desde una orden de traslado. Elegí la orden en "Orden de traslado guardada"; si no está, pedísela a Logística o al administrador.';
      end if;
    end loop;
  end if;
  return _emitir_traslado_base58(p_remito, p_items);
end $$;
grant execute on function public.emitir_traslado(jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
