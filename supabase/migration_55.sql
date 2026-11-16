-- =====================================================================
-- Migración 55: la planta despacha semilla SOLO con orden de carga
--  * Despacho de planta (operador): en un remito a cliente, todo renglón de un producto del grupo
--    Semilla (soja o maíz) tiene que venir de una orden de carga guardada (orden_linea_id).
--  * El Administrador sigue pudiendo emitir sin orden. Los traslados entre plantas no cambian.
--  * Insumos y ensamblajes no se tocan.
-- Requiere las migraciones 45 y 47.
-- =====================================================================
create or replace function public.emitir_remito(p_remito jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare e jsonb; l lotes%rowtype; v_est text; v_cant numeric; v_rol text; v_prod productos%rowtype;
begin
  select rol into v_rol from profiles where id = auth.uid();
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    -- Semilla sin orden de carga: bloqueado para el despacho de planta
    if v_rol = 'operador' and coalesce(p_remito->>'modalidad', '') <> 'traslado' and nullif(e->>'orden_linea_id', '') is null then
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
    if coalesce(p_remito->>'modalidad','') <> 'traslado' then
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
