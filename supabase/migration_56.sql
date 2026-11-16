-- =====================================================================
-- Migración 56: qué despacha cada planta (Soja / Maíz / Ambos)
--  * plantas.despacha: 'soja' | 'maiz' | 'ambos' (todas arrancan en 'ambos').
--  * Remitos a clientes: una planta de solo maíz no emite remitos OC · Soja, y viceversa.
--    Traslados entre plantas y remitos genéricos no cambian.
-- Requiere la migración 55.
-- =====================================================================
alter table public.plantas add column if not exists despacha text not null default 'ambos';
alter table public.plantas drop constraint if exists plantas_despacha_check;
alter table public.plantas add constraint plantas_despacha_check check (despacha in ('soja', 'maiz', 'ambos'));

create or replace function public.emitir_remito(p_remito jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare e jsonb; l lotes%rowtype; v_est text; v_cant numeric; v_rol text; v_planta_user uuid; v_prod productos%rowtype;
        v_mod text := coalesce(p_remito->>'modalidad', ''); v_planta plantas%rowtype;
begin
  select rol, planta_id into v_rol, v_planta_user from profiles where id = auth.uid();
  -- La planta tiene que despachar ese producto (soja / maíz)
  if v_mod in ('soja', 'maiz') then
    select * into v_planta from plantas
    where id = case when v_rol = 'admin' and nullif(p_remito->>'planta_id', '') is not null then (p_remito->>'planta_id')::uuid else v_planta_user end;
    if found and v_planta.despacha not in ('ambos', v_mod) then
      raise exception 'La planta % despacha solo %: no puede emitir remitos de %.', v_planta.nombre,
        case v_planta.despacha when 'maiz' then 'maíz' else 'soja' end, case v_mod when 'maiz' then 'maíz' else 'soja' end;
    end if;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    -- Semilla sin orden de carga: bloqueado para el despacho de planta
    if v_rol = 'operador' and v_mod <> 'traslado' and nullif(e->>'orden_linea_id', '') is null then
      v_prod := null;
      select p.* into v_prod from productos p
      where p.id = coalesce(nullif(e->>'producto_id', '')::uuid, (select producto_id from lotes where id = nullif(e->>'lote_id', '')::uuid));
      if v_prod.id is not null and coalesce(v_prod.grupo, 'semilla') = 'semilla' then
        raise exception 'La semilla solo se puede despachar desde una orden de carga (%). Elegí la orden en "Orden de carga guardada"; si no está cargada, pedísela a Logística.', v_prod.nombre;
      end if;
    end if;
    if nullif(e->>'lote_id','') is null then continue; end if;
    select * into l from lotes where id = (e->>'lote_id')::uuid;
    if not found then continue; end if;
    v_cant := coalesce(nullif(e->>'cantidad','')::numeric, 0);
    if v_mod <> 'traslado' then
      v_est := _calidad_de(l.producto_id, l.lote);
      if v_est <> 'aprobado' then
        raise exception 'El lote % está NO DISPONIBLE (estado de calidad: %)', l.lote,
          case v_est when 'pre_inspeccion' then 'PRE INSPECCIÓN' when 'pre_inspeccion_datos' then 'PRE INSPECCIÓN c/datos' else 'NO APROBADO CALIDAD' end;
      end if;
    end if;
    if l.danado > 0 and l.stock - l.danado < v_cant then
      raise exception 'El lote % tiene % unidades dañadas: solo hay % disponibles para despachar', l.lote, l.danado, l.stock - l.danado;
    end if;
  end loop;
  return _emitir_remito_base45(p_remito, p_items);
end $$;
grant execute on function public.emitir_remito(jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
