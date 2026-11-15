-- =====================================================================
-- Migración 51: órdenes de carga
--  * Solo Administrador y Logística modifican las órdenes (cargar Excel, agregar / editar / quitar líneas).
--    Despacho de planta: las ve, las despacha (emite remitos) y descarga el PDF.
--  * Se guarda el ORDEN de los renglones tal como viene en el Excel (columna posicion):
--    el primer renglón es el último destino (se carga primero, contra el pecho del camión)
--    y el último renglón es el primer destino (se carga al final).
-- Requiere las migraciones 44 y 49.
-- =====================================================================
alter table public.ordenes_carga_lineas add column if not exists posicion int;

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

create or replace function public._oc_solo_editores()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = auth.uid() and rol = 'operador') then
    raise exception 'Las órdenes de carga solo las modifican Administración o Logística. Desde la planta se pueden ver, despachar y descargar en PDF.';
  end if;
end $$;

-- Renombra las funciones actuales (una sola vez) para envolverlas con el control de permisos.
do $$
declare r record;
begin
  for r in select * from (values
      ('cargar_orden_carga', 'text, date, jsonb, text'),
      ('agregar_orden_linea', 'uuid, jsonb'),
      ('guardar_orden_linea', 'uuid, jsonb'),
      ('quitar_orden_linea', 'uuid'),
      ('fijar_fecha_carga_excel', 'text, date')) as t(nombre, args) loop
    if not exists (select 1 from pg_proc where proname = '_' || r.nombre || '_base51' and pronamespace = 'public'::regnamespace) then
      execute format('alter function public.%I(%s) rename to %I', r.nombre, r.args, '_' || r.nombre || '_base51');
    end if;
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', '_' || r.nombre || '_base51', r.args);
  end loop;
end $$;

create or replace function public.cargar_orden_carga(p_numero text, p_fecha date, p_lineas jsonb, p_origen text default 'excel')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb; v_orden uuid;
begin
  perform _oc_solo_editores();
  v_res := _cargar_orden_carga_base51(p_numero, p_fecha, p_lineas, p_origen);
  v_orden := nullif(v_res->>'orden_id', '')::uuid;
  if v_orden is not null then
    -- Guarda el orden del archivo: posición = primer renglón del Excel en que aparece esa línea.
    update ordenes_carga_lineas l set posicion = x.pos
    from (
      select nullif(e->>'planta_id', '')::uuid as planta_id,
             upper(btrim(coalesce(e->>'cliente', ''))) as cliente,
             upper(btrim(coalesce(e->>'ov', ''))) as ov,
             upper(btrim(coalesce(e->>'producto_texto', ''))) as producto,
             upper(btrim(coalesce(e->>'lote_texto', ''))) as lote,
             upper(btrim(coalesce(e->>'domicilio', ''))) as domicilio,
             min(n)::int as pos
      from jsonb_array_elements(p_lineas) with ordinality as t(e, n)
      group by 1, 2, 3, 4, 5, 6
    ) x
    where l.orden_id = v_orden and l.planta_id = x.planta_id
      and upper(btrim(l.cliente)) = x.cliente and upper(btrim(coalesce(l.ov, ''))) = x.ov
      and upper(btrim(l.producto_texto)) = x.producto and upper(btrim(l.lote_texto)) = x.lote
      and upper(btrim(coalesce(l.domicilio, ''))) = x.domicilio
      and l.posicion is distinct from x.pos;
  end if;
  return v_res;
end $$;

create or replace function public.agregar_orden_linea(p_orden_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _oc_solo_editores();
  v_id := _agregar_orden_linea_base51(p_orden_id, p_data);
  -- Una línea agregada a mano va al final (o donde indique "posicion").
  update ordenes_carga_lineas set posicion = coalesce(nullif(p_data->>'posicion', '')::int,
    (select coalesce(max(posicion), 0) + 1 from ordenes_carga_lineas where orden_id = p_orden_id and id <> v_id))
  where id = v_id and posicion is null;
  return v_id;
end $$;

create or replace function public.guardar_orden_linea(p_linea_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _oc_solo_editores();
  perform _guardar_orden_linea_base51(p_linea_id, p_data);
  if nullif(p_data->>'posicion', '') is not null then
    update ordenes_carga_lineas set posicion = (p_data->>'posicion')::int where id = p_linea_id;
  end if;
end $$;

create or replace function public.quitar_orden_linea(p_linea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _oc_solo_editores();
  perform _quitar_orden_linea_base51(p_linea_id);
end $$;

create or replace function public.fijar_fecha_carga_excel(p_numero text, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _oc_solo_editores();
  perform _fijar_fecha_carga_excel_base51(p_numero, p_fecha);
end $$;

create or replace function public.fijar_modalidad_orden(p_numero text, p_modalidad text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype;
begin
  v_user := _usuario_activo();
  perform _oc_solo_editores();
  if v_user.rol = 'consulta' then raise exception 'Tu usuario no puede modificar órdenes'; end if;
  if p_modalidad not in ('soja', 'maiz') then raise exception 'Modalidad inválida'; end if;
  update ordenes_carga set modalidad = p_modalidad
  where upper(btrim(numero)) = upper(btrim(p_numero)) and modalidad in ('soja', 'maiz') and modalidad <> p_modalidad;
end $$;

grant execute on function public.cargar_orden_carga(text, date, jsonb, text) to authenticated;
grant execute on function public.agregar_orden_linea(uuid, jsonb) to authenticated;
grant execute on function public.guardar_orden_linea(uuid, jsonb) to authenticated;
grant execute on function public.quitar_orden_linea(uuid) to authenticated;
grant execute on function public.fijar_fecha_carga_excel(text, date) to authenticated;
notify pgrst, 'reload schema';
