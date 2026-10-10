-- =====================================================================
-- MIGRACIÓN 5 — Traslados entre plantas
-- Ejecutar DESPUÉS de schema_v2.sql y migration_4.sql. Se puede correr más de una vez.
--
-- Flujo: la planta de origen emite un remito de TRASLADO (mismo formulario y
-- misma numeración de su punto de venta). El stock baja del lote de origen y
-- queda "EN TRÁNSITO" (sigue siendo de la empresa). La planta de destino lo
-- CONFIRMA (total o con diferencias) y recién ahí el stock aparece en su lote
-- (mismo producto y mismo número de lote), listo para despachar.
-- Si lo RECHAZA, o el origen lo ANULA mientras está en tránsito, vuelve al origen.
-- =====================================================================

-- 1. Columnas nuevas ---------------------------------------------------
alter table remitos add column if not exists tipo text not null default 'venta';
alter table remitos add column if not exists planta_destino_id uuid references plantas(id);
alter table remitos add column if not exists recibido_at timestamptz;
alter table remitos add column if not exists recibido_por uuid references profiles(id);
alter table remitos add column if not exists recibido_por_nombre text;
alter table remitos add column if not exists motivo_rechazo text;
alter table remitos add column if not exists obs_recepcion text;

alter table remitos drop constraint if exists remitos_tipo_check;
alter table remitos add constraint remitos_tipo_check check (tipo in ('venta', 'traslado'));

alter table remitos drop constraint if exists remitos_estado_check;
alter table remitos add constraint remitos_estado_check
  check (estado in ('emitido', 'anulado', 'en_transito', 'recibido', 'rechazado'));

alter table remitos drop constraint if exists remitos_traslado_destino_check;
alter table remitos add constraint remitos_traslado_destino_check
  check ((tipo = 'venta' and planta_destino_id is null)
      or (tipo = 'traslado' and planta_destino_id is not null and planta_destino_id <> planta_id));

create index if not exists remitos_destino_idx on remitos (planta_destino_id, estado) where tipo = 'traslado';

alter table remito_items add column if not exists cantidad_recibida numeric(14,3);
alter table remito_items add column if not exists lote_destino_id uuid references lotes(id) on delete set null;

alter table movimientos_stock drop constraint if exists movimientos_stock_tipo_check;
alter table movimientos_stock add constraint movimientos_stock_tipo_check
  check (tipo in ('ingreso', 'egreso', 'reintegro', 'ajuste',
                  'traslado_egreso', 'traslado_ingreso', 'traslado_reintegro'));

alter table plantas add column if not exists domicilio text;

-- 2. Permisos de lectura: la planta de destino ve los traslados que le llegan ---
drop policy if exists "remitos: lectura" on remitos;
create policy "remitos: lectura" on remitos for select to authenticated
  using (is_admin() or planta_id = mi_planta()
         or (tipo = 'traslado' and planta_destino_id = mi_planta()));

-- (remito_items hereda: solo ve ítems de remitos que puede ver)

-- 3. Emitir traslado -----------------------------------------------------
-- Usa emitir_remito (misma validación de PV, número y stock) y lo marca como traslado.
create or replace function public.emitir_traslado(p_remito jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_dest uuid := nullif(p_remito->>'planta_destino_id', '')::uuid;
  v_dest_row plantas%rowtype;
  v_origen uuid;
  v_it jsonb;
  v_n int := 0;
begin
  if v_dest is null then raise exception 'Elegí la planta de destino'; end if;
  select * into v_dest_row from plantas where id = v_dest and activa;
  if not found then raise exception 'La planta de destino no existe o está inactiva'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El traslado no tiene ítems';
  end if;
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    if nullif(v_it->>'lote_id', '') is null then
      raise exception 'Ítem %: en un traslado todos los ítems tienen que salir de un lote con stock', v_n;
    end if;
  end loop;

  v_id := emitir_remito(p_remito || '{"modalidad":"traslado"}'::jsonb, p_items);
  select planta_id into v_origen from remitos where id = v_id;
  if v_origen = v_dest then
    raise exception 'La planta de destino tiene que ser distinta a la de origen';
  end if;

  update remitos
  set tipo = 'traslado', estado = 'en_transito', planta_destino_id = v_dest
  where id = v_id;

  update movimientos_stock set tipo = 'traslado_egreso'
  where remito_id = v_id and tipo = 'egreso';

  return v_id;
end;
$$;

-- 4. Confirmar recepción -------------------------------------------------
-- p_items: [{"item_id": "...", "cantidad_recibida": 10}, ...]  (null = se recibe todo lo enviado)
-- La diferencia (enviado - recibido) vuelve al lote de origen y queda registrada.
create or replace function public.confirmar_traslado(
  p_remito_id uuid, p_items jsonb default null, p_obs text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_r remitos%rowtype;
  v_it record;
  v_rec numeric;
  v_dif numeric;
  v_lote_dest uuid;
  v_stock numeric;
  v_lote_orig lotes%rowtype;
  v_hay_dif boolean := false;
  v_tot_rec numeric := 0;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  select * into v_r from remitos where id = p_remito_id for update;
  if not found or v_r.tipo <> 'traslado' then raise exception 'El traslado no existe'; end if;
  if v_user.rol <> 'admin' and v_r.planta_destino_id is distinct from v_user.planta_id then
    raise exception 'Solo la planta de destino puede confirmar la recepción';
  end if;
  if v_r.estado <> 'en_transito' then
    raise exception 'El traslado ya no está en tránsito (estado: %)', v_r.estado;
  end if;

  for v_it in
    select ri.*, l.producto_id as l_prod
    from remito_items ri
    join lotes l on l.id = ri.lote_id
    where ri.remito_id = p_remito_id
    order by ri.lote_id, ri.id
  loop
    v_rec := v_it.cantidad;
    if p_items is not null then
      select coalesce((e->>'cantidad_recibida')::numeric, v_it.cantidad) into v_rec
      from jsonb_array_elements(p_items) e
      where (e->>'item_id')::uuid = v_it.id;
      v_rec := coalesce(v_rec, v_it.cantidad);
    end if;
    if v_rec < 0 or v_rec > v_it.cantidad then
      raise exception 'Ítem %: la cantidad recibida tiene que estar entre 0 y %', v_it.orden, v_it.cantidad;
    end if;
    v_dif := v_it.cantidad - v_rec;

    if v_rec > 0 then
      -- Lote en destino: mismo producto y mismo número de lote (se crea si no existe).
      insert into lotes (planta_id, producto_id, lote, stock)
      values (v_r.planta_destino_id, v_it.l_prod, v_it.lote_texto, 0)
      on conflict (planta_id, producto_id, lote) do nothing;
      select id into v_lote_dest from lotes
      where planta_id = v_r.planta_destino_id and producto_id = v_it.l_prod and lote = v_it.lote_texto
      for update;

      update lotes set stock = stock + v_rec, activo = true where id = v_lote_dest
      returning stock into v_stock;

      insert into movimientos_stock
        (lote_id, tipo, cantidad, stock_resultante, remito_id, motivo, usuario_id, usuario_nombre)
      values (v_lote_dest, 'traslado_ingreso', v_rec, v_stock, p_remito_id,
              'Recepción del traslado ' || v_r.punto_venta || '-' || v_r.numero,
              v_uid, v_user.nombre);
    else
      v_lote_dest := null;
    end if;

    if v_dif > 0 then
      v_hay_dif := true;
      select * into v_lote_orig from lotes where id = v_it.lote_id for update;
      update lotes set stock = stock + v_dif where id = v_it.lote_id returning stock into v_stock;
      insert into movimientos_stock
        (lote_id, tipo, cantidad, stock_resultante, remito_id, motivo, usuario_id, usuario_nombre)
      values (v_it.lote_id, 'traslado_reintegro', v_dif, v_stock, p_remito_id,
              'Diferencia en recepción del traslado ' || v_r.punto_venta || '-' || v_r.numero
              || ' (enviado ' || v_it.cantidad || ', recibido ' || v_rec || ')',
              v_uid, v_user.nombre);
    end if;

    update remito_items set cantidad_recibida = v_rec, lote_destino_id = v_lote_dest where id = v_it.id;
    v_tot_rec := v_tot_rec + v_rec;
  end loop;

  if v_hay_dif and (p_obs is null or length(trim(p_obs)) < 3) then
    raise exception 'Hay diferencias entre lo enviado y lo recibido: indicá el motivo en las observaciones';
  end if;
  if v_tot_rec = 0 then
    raise exception 'No se recibió nada: usá "Rechazar traslado"';
  end if;

  update remitos
  set estado = 'recibido', recibido_at = now(), recibido_por = v_uid,
      recibido_por_nombre = v_user.nombre, obs_recepcion = nullif(trim(coalesce(p_obs, '')), '')
  where id = p_remito_id;
end;
$$;

-- 5. Rechazar (la mercadería vuelve al origen) ---------------------------
create or replace function public.rechazar_traslado(p_remito_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_r remitos%rowtype;
  v_it record;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Indicá el motivo del rechazo';
  end if;

  select * into v_r from remitos where id = p_remito_id for update;
  if not found or v_r.tipo <> 'traslado' then raise exception 'El traslado no existe'; end if;
  if v_user.rol <> 'admin' and v_r.planta_destino_id is distinct from v_user.planta_id then
    raise exception 'Solo la planta de destino puede rechazar el traslado';
  end if;
  if v_r.estado <> 'en_transito' then
    raise exception 'El traslado ya no está en tránsito (estado: %)', v_r.estado;
  end if;

  for v_it in
    select lote_id, sum(cantidad) as cant from remito_items
    where remito_id = p_remito_id and lote_id is not null
    group by lote_id order by lote_id
  loop
    update lotes set stock = stock + v_it.cant where id = v_it.lote_id returning stock into v_stock;
    insert into movimientos_stock
      (lote_id, tipo, cantidad, stock_resultante, remito_id, motivo, usuario_id, usuario_nombre)
    values (v_it.lote_id, 'traslado_reintegro', v_it.cant, v_stock, p_remito_id,
            'Traslado ' || v_r.punto_venta || '-' || v_r.numero || ' rechazado por el destino',
            v_uid, v_user.nombre);
  end loop;

  update remito_items set cantidad_recibida = 0 where remito_id = p_remito_id;
  update remitos
  set estado = 'rechazado', motivo_rechazo = trim(p_motivo), recibido_at = now(),
      recibido_por = v_uid, recibido_por_nombre = v_user.nombre
  where id = p_remito_id;
end;
$$;

-- 6. Anular: un traslado solo se puede anular mientras está en tránsito -----
create or replace function public.anular_remito(p_remito_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_r remitos%rowtype;
  v_it record;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Indicá el motivo de la anulación';
  end if;

  select * into v_r from remitos where id = p_remito_id for update;
  if not found then raise exception 'El remito no existe'; end if;
  if v_user.rol <> 'admin' and v_r.planta_id is distinct from v_user.planta_id then
    raise exception 'No podés anular remitos de otra planta';
  end if;
  if v_r.estado = 'anulado' then raise exception 'El remito ya estaba anulado'; end if;
  if v_r.tipo = 'traslado' and v_r.estado <> 'en_transito' then
    raise exception 'Este traslado ya fue % por el destino: no se puede anular', v_r.estado;
  end if;

  for v_it in
    select lote_id, sum(cantidad) as cant
    from remito_items
    where remito_id = p_remito_id and lote_id is not null
    group by lote_id
    order by lote_id
  loop
    update lotes set stock = stock + v_it.cant where id = v_it.lote_id
    returning stock into v_stock;

    insert into movimientos_stock
      (lote_id, tipo, cantidad, stock_resultante, remito_id, motivo, usuario_id, usuario_nombre)
    values (v_it.lote_id, case when v_r.tipo = 'traslado' then 'traslado_reintegro' else 'reintegro' end,
            v_it.cant, v_stock, p_remito_id,
            'Anulación del remito ' || v_r.punto_venta || '-' || v_r.numero,
            v_uid, v_user.nombre);
  end loop;

  update remitos
  set estado = 'anulado', anulado_at = now(), anulado_por = v_uid,
      anulado_por_nombre = v_user.nombre, motivo_anulacion = trim(p_motivo)
  where id = p_remito_id;
end;
$$;

-- 7. Vistas ----------------------------------------------------------------
-- Mercadería en tránsito (sigue siendo de la empresa): una fila por ítem pendiente.
create or replace view public.v_stock_en_transito
with (security_invoker = true) as
select
  r.id as remito_id, r.punto_venta, r.numero, r.fecha,
  po.nombre as planta_origen, pd.nombre as planta_destino, r.planta_id, r.planta_destino_id,
  ri.descripcion, ri.lote_texto as lote, ri.cantidad, ri.kg_total
from remitos r
join plantas po on po.id = r.planta_id
join plantas pd on pd.id = r.planta_destino_id
join remito_items ri on ri.remito_id = r.id
where r.tipo = 'traslado' and r.estado = 'en_transito';

-- Trazabilidad: ahora incluye tipo, destino y cantidad recibida.
-- (drop + create: cambia la lista de columnas)
drop view if exists public.v_remito_items_detalle;
create view public.v_remito_items_detalle
with (security_invoker = true) as
select
  r.id as remito_id, r.punto_venta, r.numero, r.fecha, r.estado, r.modalidad,
  pl.nombre as planta,
  r.cliente_nombre, r.cliente_cuit, r.transportista_nombre, r.chofer_nombre, r.chasis, r.acoplado,
  ri.orden, ri.descripcion, ri.lote_texto as lote, ri.cantidad, ri.kg_unidad, ri.kg_total,
  r.usuario_nombre, r.created_at, r.motivo_anulacion,
  r.tipo, pd.nombre as planta_destino, ri.cantidad_recibida
from remitos r
join plantas pl on pl.id = r.planta_id
left join plantas pd on pd.id = r.planta_destino_id
join remito_items ri on ri.remito_id = r.id;
