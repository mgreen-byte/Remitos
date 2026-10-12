-- =====================================================================
-- MIGRACIÓN 10 — COT de ARBA, orden de carga, provincia de destino y carga masiva de stock
-- Ejecutar DESPUÉS de migration_9.sql. Se puede correr más de una vez.
-- =====================================================================

alter table plantas add column if not exists provincia text;
alter table remitos add column if not exists cliente_provincia text;
alter table remitos add column if not exists cot text;
alter table remitos add column if not exists orden_carga text;
create index if not exists remitos_cot_idx on remitos (cot);
create index if not exists remitos_oc_idx on remitos (orden_carga);

-- Remitos con destino Buenos Aires: el COT es obligatorio (lo exige la base).
create or replace function public.emitir_remito(p_remito jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_planta_id uuid;
  v_pv text;
  v_numero text := coalesce(p_remito->>'numero', '');
  v_remito_id uuid;
  v_item jsonb;
  v_i int := 0;
  v_cant numeric;
  v_kgu numeric;
  v_desc text;
  v_prec text;
  v_tal talonarios%rowtype;
  v_prov text := upper(trim(coalesce(p_remito->>'cliente_provincia', '')));
  v_cot text := upper(trim(coalesce(p_remito->>'cot', '')));
  v_lote lotes%rowtype;
  v_stock_nuevo numeric;
  v_total_u numeric := 0;
  v_total_k numeric := 0;
  v_todos_kg boolean := true;
  v_lote_ids uuid[];
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  v_planta_id := case when v_user.rol = 'admin' and nullif(p_remito->>'planta_id', '') is not null
                      then (p_remito->>'planta_id')::uuid else v_user.planta_id end;
  if v_planta_id is null then raise exception 'Tu usuario no tiene una planta asignada'; end if;

  select punto_venta into v_pv from plantas where id = v_planta_id and activa;
  if not found then raise exception 'La planta no existe o está inactiva'; end if;

  if coalesce(p_remito->>'punto_venta', '') <> v_pv then
    raise exception 'El punto de venta % no corresponde a tu planta (corresponde %)',
      coalesce(nullif(p_remito->>'punto_venta', ''), '(vacío)'), v_pv;
  end if;
  if v_numero !~ '^[0-9]{8}$' then
    raise exception 'El número de remito tiene que tener 8 dígitos';
  end if;
  -- Control de talonarios (solo si el administrador lo activó): rango, CAI vigente y orden de uso.
  v_tal := _validar_talonario(v_planta_id, v_numero::int);

  -- COT de ARBA: si el destino es la provincia de Buenos Aires, es obligatorio.
  if v_prov = 'BUENOS AIRES' and length(v_cot) < 3 then
    raise exception 'El destino es la provincia de Buenos Aires: tenés que generar el COT en ARBA y cargarlo en el remito.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El remito no tiene ítems';
  end if;
  if jsonb_array_length(p_items) > 15 then
    raise exception 'El remito admite hasta 15 ítems; dividilo en dos remitos';
  end if;

  -- Bloquea los lotes en un orden fijo (evita bloqueos cruzados entre plantas).
  select coalesce(array_agg(distinct (e->>'lote_id')::uuid order by (e->>'lote_id')::uuid), '{}')
    into v_lote_ids
  from jsonb_array_elements(p_items) e
  where nullif(e->>'lote_id', '') is not null;

  perform 1 from lotes where id = any(v_lote_ids) order by id for update;

  begin
    insert into remitos (
      planta_id, punto_venta, numero, fecha, modalidad,
      cliente_nombre, cliente_cuit, cliente_domicilio, cliente_iva, entregar_en,
      transportista_id, transportista_nombre, transportista_cuit, transportista_domicilio,
      chofer_id, chofer_nombre, chofer_cuil, chasis, acoplado,
      observaciones, usuario_id, usuario_nombre, talonario_id, cai, cai_vencimiento,
      cliente_provincia, cot, orden_carga
    ) values (
      v_planta_id, v_pv, v_numero,
      coalesce(nullif(p_remito->>'fecha', '')::date,
               (now() at time zone 'America/Argentina/Buenos_Aires')::date),
      coalesce(nullif(p_remito->>'modalidad', ''), 'generico'),
      _u(p_remito->>'cliente_nombre'), _u(p_remito->>'cliente_cuit'),
      _u(p_remito->>'cliente_domicilio'), _u(p_remito->>'cliente_iva'),
      _u(p_remito->>'entregar_en'),
      nullif(p_remito->>'transportista_id', '')::uuid,
      _u(p_remito->>'transportista_nombre'), _u(p_remito->>'transportista_cuit'),
      _u(p_remito->>'transportista_domicilio'),
      nullif(p_remito->>'chofer_id', '')::uuid,
      _u(p_remito->>'chofer_nombre'), _u(p_remito->>'chofer_cuil'),
      _u(p_remito->>'chasis'), _u(p_remito->>'acoplado'),
      _u(p_remito->>'observaciones'), v_uid, v_user.nombre,
      v_tal.id, v_tal.cai, v_tal.cai_vencimiento,
      nullif(v_prov, ''), nullif(v_cot, ''), _u(p_remito->>'orden_carga')
    )
    returning id into v_remito_id;
  exception when unique_violation then
    raise exception 'El remito % - % ya fue registrado', v_pv, v_numero using errcode = '23505';
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    v_cant := nullif(v_item->>'cantidad', '')::numeric;
    v_kgu := nullif(v_item->>'kg_unidad', '')::numeric;
    v_desc := _u(v_item->>'descripcion');
    v_prec := _u(v_item->>'precinto');
    v_lote := null;

    if v_cant is null or v_cant <= 0 then
      raise exception 'Ítem %: la cantidad tiene que ser mayor a cero', v_i;
    end if;
    if v_desc is null then
      raise exception 'Ítem %: falta la descripción', v_i;
    end if;

    if nullif(v_item->>'lote_id', '') is not null then
      if v_prec is null then
        raise exception 'Ítem %: falta el precinto con el que se despacha', v_i;
      end if;
      select * into v_lote from lotes where id = (v_item->>'lote_id')::uuid;
      if not found then raise exception 'Ítem %: el lote no existe', v_i; end if;
      if v_lote.planta_id <> v_planta_id then
        raise exception 'Ítem %: el lote no pertenece a la planta del remito', v_i;
      end if;
      if v_lote.stock < v_cant then
        raise exception 'Stock insuficiente en el lote %: hay %, se piden %',
          v_lote.lote, v_lote.stock, v_cant;
      end if;

      update lotes set stock = stock - v_cant where id = v_lote.id
      returning stock into v_stock_nuevo;

      insert into movimientos_stock
        (lote_id, tipo, cantidad, stock_resultante, remito_id, usuario_id, usuario_nombre)
      values (v_lote.id, 'egreso', -v_cant, v_stock_nuevo, v_remito_id, v_uid, v_user.nombre);
    end if;

    insert into remito_items
      (remito_id, orden, producto_id, lote_id, lote_texto, precinto, descripcion, cantidad, kg_unidad, kg_total)
    values (
      v_remito_id, v_i,
      coalesce(v_lote.producto_id, nullif(v_item->>'producto_id', '')::uuid),
      v_lote.id, v_lote.lote, v_prec, v_desc, v_cant, v_kgu,
      case when v_kgu is not null then v_cant * v_kgu end
    );

    v_total_u := v_total_u + v_cant;
    if v_kgu is null then v_todos_kg := false; else v_total_k := v_total_k + v_cant * v_kgu; end if;
  end loop;

  update remitos
  set total_unidades = v_total_u,
      total_kgs = coalesce(nullif(p_remito->>'total_kgs', '')::numeric,
                           case when v_todos_kg then v_total_k end)
  where id = v_remito_id;

  if v_tal.id is not null then perform _actualizar_estado_talonario(v_tal.id); end if;

  return v_remito_id;
end;
$$;

-- Traslados: el COT también se exige si la planta de destino está en Buenos Aires.
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

  -- La provincia de destino sale de la planta de destino (así el COT se exige solo si corresponde).
  v_id := emitir_remito(
    p_remito || jsonb_build_object('modalidad', 'traslado',
                                   'cliente_provincia', coalesce(upper(nullif(trim(v_dest_row.provincia), '')), p_remito->>'cliente_provincia')),
    p_items);
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

-- Trazabilidad: la vista suma COT, orden de carga y provincia.
drop view if exists public.v_remito_items_detalle;
create view public.v_remito_items_detalle
with (security_invoker = true) as
select
  r.id as remito_id, r.punto_venta, r.numero, r.fecha, r.estado, r.modalidad,
  pl.nombre as planta,
  r.cliente_nombre, r.cliente_cuit, r.transportista_nombre, r.chofer_nombre, r.chasis, r.acoplado,
  ri.orden, ri.descripcion, ri.lote_texto as lote, ri.cantidad, ri.kg_unidad, ri.kg_total,
  r.usuario_nombre, r.created_at, r.motivo_anulacion,
  r.tipo, pd.nombre as planta_destino, ri.cantidad_recibida, ri.precinto,
  r.cot, r.orden_carga, r.cliente_provincia
from remitos r
join plantas pl on pl.id = r.planta_id
left join plantas pd on pd.id = r.planta_destino_id
join remito_items ri on ri.remito_id = r.id;

-- Carga masiva de stock: todo o nada (si una fila falla, no se carga ninguna).
-- p_filas: [{"planta_id": "...", "producto_id": "...", "lote": "ABC", "cantidad": 10, "motivo": "..."}]
create or replace function public.cargar_stock_masivo(p_filas jsonb)
returns int
language plpgsql security invoker set search_path = public as $$
declare v_f jsonb; v_i int := 0;
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'No hay filas para cargar';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'Máximo 2000 filas por carga';
  end if;
  for v_f in select * from jsonb_array_elements(p_filas) loop
    v_i := v_i + 1;
    begin
      perform cargar_stock(
        (v_f->>'producto_id')::uuid, v_f->>'lote', (v_f->>'cantidad')::numeric,
        nullif(v_f->>'planta_id', '')::uuid, coalesce(nullif(v_f->>'motivo', ''), 'Carga masiva'));
    exception when others then
      raise exception 'Fila %: %', v_i, sqlerrm;
    end;
  end loop;
  return v_i;
end $$;

notify pgrst, 'reload schema';
