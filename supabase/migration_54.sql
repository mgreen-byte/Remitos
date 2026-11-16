-- =====================================================================
-- Migración 54: localidad de entrega por línea de orden de carga
--  * ordenes_carga_lineas.localidad: se guarda aparte al subir el Excel (soja: columna Localidad;
--    maíz: sale de la dirección "… - Localidad - Provincia").
--  * Las líneas ya cargadas se completan a partir del domicilio guardado.
-- Requiere la migración 51.
-- =====================================================================
alter table public.ordenes_carga_lineas add column if not exists localidad text;

-- Completa las líneas existentes:
--   "Zona Rural - General Galarza - EntreRíos" -> GENERAL GALARZA (anteúltima parte si hay " - ")
--   "Zona Rural, Salto"                         -> SALTO (lo que va después de la última coma)
update public.ordenes_carga_lineas
set localidad = upper(btrim(case
  when domicilio ~ '\s-\s' then
    (regexp_split_to_array(domicilio, '\s+-\s+'))[greatest(1, array_length(regexp_split_to_array(domicilio, '\s+-\s+'), 1) - 1)]
  when domicilio like '%,%' then regexp_replace(domicilio, '^.*,', '')
  else '' end))
where localidad is null and coalesce(domicilio, '') <> '';
update public.ordenes_carga_lineas set localidad = null where localidad = '';

drop view if exists public.v_ordenes_lineas_saldo;
create view public.v_ordenes_lineas_saldo with (security_invoker = true) as
select
  l.*,
  o.numero as orden_numero, o.fecha as orden_fecha, o.estado as orden_estado, o.modalidad as orden_modalidad,
  o.planta_destino_id as orden_planta_destino_id,
  pl.nombre as planta_nombre,
  public._oc_remitido(l.id) as remitido,
  l.cantidad - public._oc_remitido(l.id) as saldo
from ordenes_carga_lineas l
join ordenes_carga o on o.id = l.orden_id
join plantas pl on pl.id = l.planta_id;
grant select on public.v_ordenes_lineas_saldo to authenticated;

-- Al subir el Excel: además de la posición, guarda la localidad que viene en cada línea.
create or replace function public.cargar_orden_carga(p_numero text, p_fecha date, p_lineas jsonb, p_origen text default 'excel')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb; v_orden uuid;
begin
  perform _oc_solo_editores();
  v_res := _cargar_orden_carga_base51(p_numero, p_fecha, p_lineas, p_origen);
  v_orden := nullif(v_res->>'orden_id', '')::uuid;
  if v_orden is not null then
    update ordenes_carga_lineas l set posicion = x.pos, localidad = coalesce(x.loc, l.localidad)
    from (
      select nullif(e->>'planta_id', '')::uuid as planta_id,
             upper(btrim(coalesce(e->>'cliente', ''))) as cliente,
             upper(btrim(coalesce(e->>'ov', ''))) as ov,
             upper(btrim(coalesce(e->>'producto_texto', ''))) as producto,
             upper(btrim(coalesce(e->>'lote_texto', ''))) as lote,
             upper(btrim(coalesce(e->>'domicilio', ''))) as domicilio,
             min(n)::int as pos,
             max(nullif(upper(btrim(coalesce(e->>'localidad', ''))), '')) as loc
      from jsonb_array_elements(p_lineas) with ordinality as t(e, n)
      group by 1, 2, 3, 4, 5, 6
    ) x
    where l.orden_id = v_orden and l.planta_id = x.planta_id
      and upper(btrim(l.cliente)) = x.cliente and upper(btrim(coalesce(l.ov, ''))) = x.ov
      and upper(btrim(l.producto_texto)) = x.producto and upper(btrim(l.lote_texto)) = x.lote
      and upper(btrim(coalesce(l.domicilio, ''))) = x.domicilio;
  end if;
  return v_res;
end $$;
grant execute on function public.cargar_orden_carga(text, date, jsonb, text) to authenticated;
notify pgrst, 'reload schema';
