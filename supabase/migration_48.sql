-- =====================================================================
-- Migración 48: calidad masiva
--  * calidad_masiva(filas): cambia el estado de calidad y/o carga peso por bolsa y calibre de muchos
--    lotes a la vez. Cada fila: {producto_id, lote, estado?, kg?, calibre?}. Lo que no viene, no se toca.
--  * La usan la pantalla Calidad (tildar lotes) y la carga masiva de stock por Excel.
-- Solo admin o logística. Requiere las migraciones 45 y 47.
-- =====================================================================
create or replace function public.calidad_masiva(p_filas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare f jsonb; v_prod uuid; v_lote text; v_est text; v_kg numeric; v_cal text; v_n int := 0;
begin
  if not _es_admin_o_logistica() then raise exception 'Solo administración o logística pueden cambiar el estado de calidad'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'No elegiste ningún lote'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_prod := nullif(f->>'producto_id', '')::uuid;
    v_lote := upper(btrim(coalesce(f->>'lote', '')));
    v_est := nullif(f->>'estado', '');
    v_kg := nullif(f->>'kg', '')::numeric;
    v_cal := nullif(upper(btrim(coalesce(f->>'calibre', ''))), '');
    if v_prod is null or v_lote = '' then continue; end if;
    if v_est is not null then perform cambiar_calidad_lote(v_prod, v_lote, v_est); end if;
    if v_kg is not null or v_cal is not null then
      if v_kg is not null and v_kg <= 0 then raise exception 'Lote %: el peso por bolsa tiene que ser mayor a cero', v_lote; end if;
      if not exists (select 1 from lotes where producto_id = v_prod and upper(btrim(lote)) = v_lote) then
        raise exception 'El lote % no existe', v_lote;
      end if;
      insert into calidad_lotes (producto_id, lote_key, estado, kg_unidad, calibre)
      values (v_prod, v_lote, 'pre_inspeccion', v_kg, v_cal)
      on conflict (producto_id, lote_key) do update
        set kg_unidad = coalesce(excluded.kg_unidad, calidad_lotes.kg_unidad),
            calibre = coalesce(excluded.calibre, calidad_lotes.calibre);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.calidad_masiva(jsonb) from public, anon;
grant execute on function public.calidad_masiva(jsonb) to authenticated;
notify pgrst, 'reload schema';
