-- =====================================================================
-- Migración 46: eliminar productos del catálogo aunque hayan tenido lotes (solo administrador).
-- Se puede eliminar un producto si TODOS sus lotes tienen stock 0, no tiene unidades dañadas,
-- pallets numerados ni traslados en tránsito. Se borran sus lotes vacíos y su calidad;
-- los movimientos de esos lotes se guardan en movimientos_stock_eliminados (respaldo).
-- Los remitos ya emitidos NO se tocan (conservan la descripción y el lote en texto).
-- Devuelve cuántos se eliminaron y cuáles se rechazaron con el motivo.
-- =====================================================================
create or replace function public.eliminar_productos(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_p productos%rowtype; v_ok int := 0; v_rech jsonb := '[]'::jsonb;
  v_nom text; v_motivo text; v_lote lotes%rowtype;
begin
  if not is_admin() then raise exception 'Solo el administrador puede eliminar productos'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'No elegiste ningún producto'; end if;
  select nombre into v_nom from profiles where id = auth.uid();
  foreach v_id in array p_ids loop
    select * into v_p from productos where id = v_id;
    if not found then continue; end if;
    v_motivo := null;
    if exists (select 1 from lotes where producto_id = v_id and stock > 0) then
      v_motivo := 'todavía tiene stock en algún lote';
    elsif exists (select 1 from pallets where producto_id = v_id) then
      v_motivo := 'tiene pallets numerados cargados';
    elsif exists (select 1 from remito_items ri join remitos r on r.id = ri.remito_id
                  where ri.producto_id = v_id and r.tipo = 'traslado' and r.estado = 'en_transito') then
      v_motivo := 'tiene un traslado en tránsito';
    end if;
    if v_motivo is null then
      begin
        perform set_config('app.pallets_ok', '1', true);
        for v_lote in select * from lotes where producto_id = v_id loop
          insert into movimientos_stock_eliminados (movimiento, lote_texto, motivo, eliminado_por, eliminado_por_nombre)
          select to_jsonb(m), v_lote.lote, 'Eliminación del producto ' || v_p.nombre, auth.uid(), v_nom
          from movimientos_stock m where m.lote_id = v_lote.id;
          delete from movimientos_stock where lote_id = v_lote.id;
          delete from danados_log where lote_id = v_lote.id;
          delete from lotes where id = v_lote.id;
        end loop;
        delete from calidad_lotes where producto_id = v_id;
        update ordenes_carga_lineas set producto_id = null where producto_id = v_id;
        delete from productos where id = v_id;
        v_ok := v_ok + 1;
      exception when others then
        v_motivo := 'tiene datos asociados que lo impiden (' || sqlerrm || ')';
      end;
    end if;
    if v_motivo is not null then
      v_rech := v_rech || jsonb_build_object('nombre', v_p.nombre, 'motivo', v_motivo);
    end if;
  end loop;
  return jsonb_build_object('eliminados', v_ok, 'rechazados', v_rech);
end $$;
revoke execute on function public.eliminar_productos(uuid[]) from public, anon;
grant execute on function public.eliminar_productos(uuid[]) to authenticated;
notify pgrst, 'reload schema';
