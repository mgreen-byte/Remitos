-- =====================================================================
-- MIGRACIÓN 13 — COT opcional al emitir + pantalla COT (resumen por camión) + precios
-- Ejecutar DESPUÉS de migration_12.sql. Se puede correr más de una vez.
--
--  * El COT ya no es obligatorio para emitir/imprimir el remito.
--  * "COT pendiente": remito de SOJA, no anulado, sin COT, con destino en la provincia
--    de Buenos Aires o con la planta de origen en Buenos Aires. (Maíz: sin efecto por ahora.)
--  * Un COT agrupa varios remitos de una misma planta (un camión, varios destinos).
--  * Precio por kg de soja (con fecha desde la que rige) para calcular el monto de cada remito.
-- =====================================================================

-- ¿La provincia es Buenos Aires? (sin tildes ni mayúsculas; CABA no cuenta)
create or replace function public._es_prov_ba(p text)
returns boolean language sql immutable as $$
  select translate(upper(trim(coalesce(p, ''))), 'ÁÉÍÓÚ', 'AEIOU') = 'BUENOS AIRES'
$$;

-- Precio del kg (admin lo carga; rige desde una fecha).
create table if not exists public.precios (
  id uuid default gen_random_uuid() primary key,
  categoria text not null check (categoria in ('soja', 'maiz')),
  precio_kg numeric(14,4) not null check (precio_kg > 0),
  vigente_desde date not null,
  creado_por uuid references profiles(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  unique (categoria, vigente_desde)
);

-- Un COT = un camión. Agrupa remitos de una misma planta.
create table if not exists public.cots (
  id uuid default gen_random_uuid() primary key,
  codigo text not null unique,
  planta_id uuid not null references plantas(id),
  precio_kg numeric(14,4),
  monto_total numeric(16,2),
  detalle jsonb,
  usuario_id uuid references profiles(id),
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cots_planta_idx on cots (planta_id, created_at desc);

alter table public.remitos add column if not exists cot_id uuid references cots(id);
create index if not exists remitos_cot_id_idx on remitos (cot_id);

alter table public.precios enable row level security;
alter table public.cots enable row level security;

drop policy if exists "precios: lectura" on precios;
create policy "precios: lectura" on precios for select to authenticated using (true);
drop policy if exists "precios: admin" on precios;
create policy "precios: admin" on precios for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "cots: lectura" on cots;
create policy "cots: lectura" on cots for select to authenticated
  using (puede_ver_todo() or planta_id = mi_planta());
-- Los COT se crean y corrigen solo con las funciones de más abajo (no hay políticas de escritura).

drop trigger if exists bloquear_consulta on precios;
create trigger bloquear_consulta before insert or update or delete on precios
  for each statement execute function _bloquear_consulta();
drop trigger if exists bloquear_consulta on cots;
create trigger bloquear_consulta before insert or update or delete on cots
  for each statement execute function _bloquear_consulta();

-- Emitir remito: sin exigir el COT.
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

  -- El COT ya no es obligatorio al emitir: si falta, el remito queda como "COT pendiente"
  -- (cuando corresponde) y se carga después desde la pantalla COT.
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

-- Remitos con COT pendiente (soja, destino o planta en Buenos Aires, sin COT cargado).
drop view if exists public.v_cot_pendientes;
create view public.v_cot_pendientes
with (security_invoker = true) as
select
  r.id as remito_id, r.planta_id, pl.nombre as planta,
  r.punto_venta, r.numero, r.fecha, r.created_at, r.tipo, r.estado,
  r.orden_carga,
  r.cliente_nombre, r.cliente_cuit, r.cliente_domicilio, r.cliente_provincia,
  r.transportista_nombre, r.transportista_cuit, r.chasis, r.acoplado,
  r.chofer_nombre, r.chofer_cuil,
  (_hoy_ar() - r.fecha) as dias
from remitos r
join plantas pl on pl.id = r.planta_id
where r.estado not in ('anulado', 'rechazado')
  and r.cot_id is null
  and nullif(trim(coalesce(r.cot, '')), '') is null
  and (_es_prov_ba(r.cliente_provincia) or _es_prov_ba(pl.provincia))
  and exists (
    select 1 from remito_items ri
    join productos pr on pr.id = ri.producto_id
    where ri.remito_id = r.id and pr.categoria = 'soja'
  );

-- Cargar el código de COT a varios remitos de una vez.
create or replace function public.asignar_cot(
  p_remitos uuid[], p_codigo text, p_precio_kg numeric default null, p_detalle jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_ids uuid[];
  v_n int;
  v_plantas int;
  v_planta uuid;
  v_id uuid;
  v_monto numeric(16,2);
begin
  if v_uid is null then raise exception 'Sesión vencida. Volvé a ingresar.'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Tu usuario no está activo.'; end if;
  if v_user.rol = 'consulta' then raise exception 'Tu usuario es de solo consulta: no puede modificar datos.'; end if;
  if length(v_cod) < 3 then raise exception 'Cargá el código de COT.'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_remitos, '{}')) x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Elegí al menos un remito.'; end if;
  if exists (select 1 from cots where codigo = v_cod) then
    raise exception 'El COT % ya está cargado en otro grupo de remitos.', v_cod;
  end if;

  perform 1 from remitos where id = any(v_ids) for update;
  select count(*), count(distinct planta_id), (array_agg(planta_id))[1]
    into v_n, v_plantas, v_planta
    from remitos where id = any(v_ids);
  if v_n <> array_length(v_ids, 1) then raise exception 'Alguno de los remitos no existe.'; end if;
  if v_plantas <> 1 then raise exception 'Un COT solo puede juntar remitos de una misma planta.'; end if;
  if v_user.rol <> 'admin' and v_planta is distinct from v_user.planta_id then
    raise exception 'Solo podés cargar COT de remitos de tu planta.';
  end if;
  if exists (select 1 from remitos where id = any(v_ids) and estado in ('anulado', 'rechazado')) then
    raise exception 'Hay remitos anulados o rechazados en la selección.';
  end if;
  if exists (select 1 from remitos where id = any(v_ids) and (cot_id is not null or nullif(trim(coalesce(cot, '')), '') is not null)) then
    raise exception 'Alguno de los remitos ya tiene COT.';
  end if;

  select coalesce(sum((e->>'monto')::numeric), 0) into v_monto
    from jsonb_array_elements(coalesce(p_detalle, '[]'::jsonb)) e;

  insert into cots (codigo, planta_id, precio_kg, monto_total, detalle, usuario_id, usuario_nombre)
  values (v_cod, v_planta, p_precio_kg, v_monto, p_detalle, v_uid, v_user.nombre)
  returning id into v_id;

  update remitos set cot_id = v_id, cot = v_cod where id = any(v_ids);
  return v_id;
end;
$$;

-- Corregir el código de un COT ya cargado (error de tipeo).
create or replace function public.corregir_cot(p_cot_id uuid, p_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_cot cots%rowtype;
  v_cod text := upper(trim(coalesce(p_codigo, '')));
begin
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Tu usuario no está activo.'; end if;
  if v_user.rol = 'consulta' then raise exception 'Tu usuario es de solo consulta: no puede modificar datos.'; end if;
  select * into v_cot from cots where id = p_cot_id for update;
  if not found then raise exception 'No existe ese COT.'; end if;
  if v_user.rol <> 'admin' and v_cot.planta_id is distinct from v_user.planta_id then
    raise exception 'Solo podés corregir COT de tu planta.';
  end if;
  if length(v_cod) < 3 then raise exception 'Cargá el código de COT.'; end if;
  if exists (select 1 from cots where codigo = v_cod and id <> p_cot_id) then
    raise exception 'El COT % ya está cargado en otro grupo de remitos.', v_cod;
  end if;
  update cots set codigo = v_cod where id = p_cot_id;
  update remitos set cot = v_cod where cot_id = p_cot_id;
end;
$$;

-- Sacar un remito de su COT (se cargó por error). Si el COT queda vacío, se borra.
create or replace function public.quitar_remito_de_cot(p_remito_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_r remitos%rowtype;
begin
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Tu usuario no está activo.'; end if;
  if v_user.rol = 'consulta' then raise exception 'Tu usuario es de solo consulta: no puede modificar datos.'; end if;
  select * into v_r from remitos where id = p_remito_id for update;
  if not found or v_r.cot_id is null then raise exception 'Ese remito no tiene un COT cargado desde la pantalla COT.'; end if;
  if v_user.rol <> 'admin' and v_r.planta_id is distinct from v_user.planta_id then
    raise exception 'Solo podés modificar remitos de tu planta.';
  end if;
  update remitos set cot = null, cot_id = null where id = p_remito_id;
  delete from cots c where c.id = v_r.cot_id and not exists (select 1 from remitos where cot_id = c.id);
end;
$$;

grant execute on function public.asignar_cot(uuid[], text, numeric, jsonb) to authenticated;
grant execute on function public.corregir_cot(uuid, text) to authenticated;
grant execute on function public.quitar_remito_de_cot(uuid) to authenticated;

notify pgrst, 'reload schema';
