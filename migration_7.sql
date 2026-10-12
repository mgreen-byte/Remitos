-- =====================================================================
-- MIGRACIÓN 7 — Control de talonarios (CAI, rangos, orden de uso, justificación de saltos)
-- Ejecutar DESPUÉS de migration_6.sql. Se puede correr más de una vez.
--
-- El control viene APAGADO. Primero cargás los talonarios de cada planta
-- (Talonarios → Nuevo talonario) y recién entonces lo activás con el interruptor
-- de esa pantalla. Mientras esté apagado, los remitos se emiten como hasta ahora.
-- =====================================================================

create table if not exists talonarios (
  id uuid default gen_random_uuid() primary key,
  planta_id uuid not null references plantas(id),
  desde int not null check (desde between 1 and 99999999),
  hasta int not null check (hasta between 1 and 99999999),
  cai text not null,
  cai_vencimiento date not null,
  estado text not null default 'activo' check (estado in ('activo', 'agotado', 'cerrado')),
  created_at timestamptz not null default now(),
  creado_por uuid references profiles(id),
  creado_por_nombre text,
  recibido_at timestamptz,
  recibido_por uuid references profiles(id),
  recibido_por_nombre text,
  extravio_reportado_at timestamptz,
  extravio_reportado_por_nombre text,
  extravio_detalle text,
  cerrado_at timestamptz,
  cerrado_por_nombre text,
  motivo_cierre text,
  check (hasta >= desde)
);
create index if not exists talonarios_planta_idx on talonarios (planta_id, estado, desde);

create table if not exists talonario_justificaciones (
  id uuid default gen_random_uuid() primary key,
  talonario_id uuid not null references talonarios(id),
  planta_id uuid not null references plantas(id),
  numero int not null,
  motivo text not null check (motivo in ('danado', 'extraviado', 'otro')),
  detalle text,
  usuario_id uuid references profiles(id),
  usuario_nombre text,
  created_at timestamptz not null default now(),
  unique (talonario_id, numero)
);

alter table remitos add column if not exists talonario_id uuid references talonarios(id);
alter table remitos add column if not exists cai text;
alter table remitos add column if not exists cai_vencimiento date;

insert into configuracion (clave, valor) values ('control_talonarios', '{"activo": false}')
on conflict (clave) do nothing;

-- Permisos: lectura solo de la propia planta (admin todo); escritura solo por funciones.
alter table talonarios enable row level security;
alter table talonario_justificaciones enable row level security;
drop policy if exists "talonarios: lectura" on talonarios;
create policy "talonarios: lectura" on talonarios for select to authenticated
  using (is_admin() or planta_id = mi_planta());
drop policy if exists "justificaciones: lectura" on talonario_justificaciones;
create policy "justificaciones: lectura" on talonario_justificaciones for select to authenticated
  using (is_admin() or planta_id = mi_planta());

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function public._hoy_ar() returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

create or replace function public._control_talonarios_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor->>'activo')::boolean from configuracion where clave = 'control_talonarios'), false) $$;

create or replace function public._n8(n int) returns text language sql immutable as $$
  select lpad(n::text, 8, '0') $$;

-- Números todavía libres del talonario (no emitidos ni justificados).
create or replace function public._disponibles(t talonarios) returns int
language sql stable security definer set search_path = public as $$
  select (t.hasta - t.desde + 1)
    - (select count(*) from remitos r join plantas p on p.id = t.planta_id
        where r.punto_venta = p.punto_venta and r.numero between _n8(t.desde) and _n8(t.hasta))::int
    - (select count(*) from talonario_justificaciones j where j.talonario_id = t.id)::int $$;

create or replace function public._actualizar_estado_talonario(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t talonarios%rowtype;
begin
  select * into t from talonarios where id = p_id;
  if found and t.estado = 'activo' and _disponibles(t) <= 0 then
    update talonarios set estado = 'agotado' where id = p_id;
  end if;
end $$;

-- Valida el número contra los talonarios de la planta. Devuelve el talonario a usar
-- (o null si el control está apagado). Si no se puede emitir, explica por qué.
create or replace function public._validar_talonario(p_planta uuid, p_numero int)
returns talonarios
language plpgsql security definer set search_path = public as $$
declare
  t talonarios%rowtype;
  o talonarios%rowtype;
  j talonario_justificaciones%rowtype;
  v_rangos text;
  v_motivos jsonb := '{"danado":"dañado","extraviado":"extraviado","otro":"anulado en papel / otro"}';
begin
  if not _control_talonarios_activo() then return null; end if;

  select * into t from talonarios
  where planta_id = p_planta and estado = 'activo' and p_numero between desde and hasta;

  if not found then
    select * into t from talonarios
    where planta_id = p_planta and p_numero between desde and hasta
    order by created_at desc limit 1;
    if found and t.estado = 'cerrado' then
      raise exception 'El número % pertenece a un talonario dado de baja (% a %, CAI %). Motivo: %.',
        _n8(p_numero), _n8(t.desde), _n8(t.hasta), t.cai, coalesce(t.motivo_cierre, 'sin detalle');
    elsif found and t.estado = 'agotado' then
      raise exception 'El talonario de ese número (% a %) ya está agotado.', _n8(t.desde), _n8(t.hasta);
    end if;
    select string_agg(_n8(desde) || ' a ' || _n8(hasta), ' / ' order by desde) into v_rangos
    from talonarios where planta_id = p_planta and estado = 'activo';
    if v_rangos is null then
      raise exception 'Tu planta no tiene un talonario activo. Pedile al administrador que cargue el talonario con su CAI.';
    end if;
    raise exception 'El número % está fuera de los talonarios activos de tu planta (%). Revisá el número del formulario o pedile al administrador que cargue el talonario nuevo.',
      _n8(p_numero), v_rangos;
  end if;

  if t.cai_vencimiento < _hoy_ar() then
    raise exception 'El CAI % del talonario % a % venció el %. No se pueden emitir remitos con ese talonario; pedile al administrador el talonario vigente.',
      t.cai, _n8(t.desde), _n8(t.hasta), to_char(t.cai_vencimiento, 'DD/MM/YYYY');
  end if;

  select * into j from talonario_justificaciones where talonario_id = t.id and numero = p_numero;
  if found then
    raise exception 'El número % fue marcado como % y no se puede usar.', _n8(p_numero), v_motivos->>j.motivo;
  end if;

  -- Se usan primero los talonarios más viejos (mientras estén vigentes y les queden números).
  for o in
    select * from talonarios
    where planta_id = p_planta and estado = 'activo' and desde < t.desde and cai_vencimiento >= _hoy_ar()
    order by desde
  loop
    if _disponibles(o) > 0 then
      raise exception 'Antes tenés que usar el talonario más antiguo (% a %, CAI %): todavía quedan % números. Si esos formularios se perdieron, reportalo para que el administrador lo dé de baja.',
        _n8(o.desde), _n8(o.hasta), o.cai, _disponibles(o);
    end if;
  end loop;

  return t;
end $$;

-- ---------------------------------------------------------------------
-- Vista con el estado de cada talonario
-- ---------------------------------------------------------------------
drop view if exists public.v_talonarios;
create view public.v_talonarios
with (security_invoker = true) as
select
  t.*, pl.nombre as planta, pl.punto_venta,
  (t.cai_vencimiento < (now() at time zone 'America/Argentina/Buenos_Aires')::date) as vencido,
  u.usados, j.justificados,
  (t.hasta - t.desde + 1) - u.usados - j.justificados as disponibles,
  greatest(u.mx, j.mx) as ultimo_numero,
  case when greatest(u.mx, j.mx) is null then 0
       else greatest(greatest(u.mx, j.mx) - t.desde + 1 - u.usados - j.justificados, 0) end as huecos
from talonarios t
join plantas pl on pl.id = t.planta_id
cross join lateral (
  select count(*)::int as usados, max(r.numero::int) as mx from remitos r
  where r.punto_venta = pl.punto_venta and r.numero between lpad(t.desde::text, 8, '0') and lpad(t.hasta::text, 8, '0')
) u
cross join lateral (
  select count(*)::int as justificados, max(numero) as mx from talonario_justificaciones where talonario_id = t.id
) j;

-- ---------------------------------------------------------------------
-- Funciones de gestión
-- ---------------------------------------------------------------------
create or replace function public._usuario_activo() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare v profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  select * into v from profiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;
  return v;
end $$;

create or replace function public.crear_talonario(
  p_planta uuid, p_desde int, p_hasta int, p_cai text, p_vencimiento date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; v_id uuid; v_x talonarios%rowtype;
begin
  v_user := _usuario_activo();
  if v_user.rol <> 'admin' then raise exception 'Solo el administrador puede cargar talonarios'; end if;
  if not exists (select 1 from plantas where id = p_planta) then raise exception 'La planta no existe'; end if;
  if p_desde is null or p_hasta is null or p_desde < 1 or p_hasta < p_desde then
    raise exception 'El rango es inválido: "desde" tiene que ser menor o igual a "hasta"';
  end if;
  if p_cai is null or length(trim(p_cai)) < 5 then raise exception 'Falta el CAI'; end if;
  if p_vencimiento is null then raise exception 'Falta el vencimiento del CAI'; end if;

  select * into v_x from talonarios
  where planta_id = p_planta and desde <= p_hasta and hasta >= p_desde limit 1;
  if found then
    raise exception 'El rango se superpone con el talonario % a % (CAI %) de esa planta',
      _n8(v_x.desde), _n8(v_x.hasta), v_x.cai;
  end if;

  insert into talonarios (planta_id, desde, hasta, cai, cai_vencimiento, creado_por, creado_por_nombre)
  values (p_planta, p_desde, p_hasta, upper(trim(p_cai)), p_vencimiento, v_user.id, v_user.nombre)
  returning id into v_id;
  perform _actualizar_estado_talonario(v_id);
  return v_id;
end $$;

create or replace function public.confirmar_recepcion_talonario(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype;
begin
  v_user := _usuario_activo();
  select * into t from talonarios where id = p_id for update;
  if not found then raise exception 'El talonario no existe'; end if;
  if v_user.rol <> 'admin' and t.planta_id is distinct from v_user.planta_id then
    raise exception 'Ese talonario es de otra planta';
  end if;
  if t.recibido_at is not null then raise exception 'La recepción ya estaba confirmada'; end if;
  update talonarios set recibido_at = now(), recibido_por = v_user.id, recibido_por_nombre = v_user.nombre where id = p_id;
end $$;

create or replace function public.reportar_extravio_talonario(p_id uuid, p_detalle text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype;
begin
  v_user := _usuario_activo();
  if p_detalle is null or length(trim(p_detalle)) < 3 then raise exception 'Contá qué pasó con el talonario'; end if;
  select * into t from talonarios where id = p_id for update;
  if not found then raise exception 'El talonario no existe'; end if;
  if v_user.rol <> 'admin' and t.planta_id is distinct from v_user.planta_id then
    raise exception 'Ese talonario es de otra planta';
  end if;
  if t.estado <> 'activo' then raise exception 'El talonario ya no está activo'; end if;
  update talonarios
  set extravio_reportado_at = now(), extravio_reportado_por_nombre = v_user.nombre, extravio_detalle = trim(p_detalle)
  where id = p_id;
end $$;

create or replace function public.cerrar_talonario(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype;
begin
  v_user := _usuario_activo();
  if v_user.rol <> 'admin' then raise exception 'Solo el administrador puede dar de baja un talonario'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then raise exception 'Indicá el motivo de la baja'; end if;
  select * into t from talonarios where id = p_id for update;
  if not found then raise exception 'El talonario no existe'; end if;
  if t.estado = 'cerrado' then raise exception 'El talonario ya estaba dado de baja'; end if;
  update talonarios
  set estado = 'cerrado', cerrado_at = now(), cerrado_por_nombre = v_user.nombre, motivo_cierre = trim(p_motivo)
  where id = p_id;
end $$;

-- Números del talonario que quedaron sin usar por debajo del último emitido.
create or replace function public.numeros_sin_justificar(p_talonario uuid)
returns setof int
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype; v_pv text; v_max int;
begin
  v_user := _usuario_activo();
  select * into t from talonarios where id = p_talonario;
  if not found then return; end if;
  if v_user.rol <> 'admin' and t.planta_id is distinct from v_user.planta_id then return; end if;
  select punto_venta into v_pv from plantas where id = t.planta_id;
  select max(n) into v_max from (
    select numero::int as n from remitos
      where punto_venta = v_pv and numero between _n8(t.desde) and _n8(t.hasta)
    union all select numero from talonario_justificaciones where talonario_id = t.id) x;
  if v_max is null then return; end if;
  return query
    select g from generate_series(t.desde, v_max) g
    where not exists (select 1 from remitos r where r.punto_venta = v_pv and r.numero = _n8(g))
      and not exists (select 1 from talonario_justificaciones j where j.talonario_id = t.id and j.numero = g)
    order by g;
end $$;

create or replace function public.justificar_numeros(
  p_talonario uuid, p_numeros int[], p_motivo text, p_detalle text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype; v_pv text; n int; v_c int := 0;
begin
  v_user := _usuario_activo();
  if p_motivo not in ('danado', 'extraviado', 'otro') then raise exception 'Motivo inválido'; end if;
  if p_motivo = 'otro' and (p_detalle is null or length(trim(p_detalle)) < 3) then
    raise exception 'Explicá el motivo';
  end if;
  if p_numeros is null or array_length(p_numeros, 1) is null then raise exception 'Elegí al menos un número'; end if;
  select * into t from talonarios where id = p_talonario for update;
  if not found then raise exception 'El talonario no existe'; end if;
  if v_user.rol <> 'admin' and t.planta_id is distinct from v_user.planta_id then
    raise exception 'Ese talonario es de otra planta';
  end if;
  select punto_venta into v_pv from plantas where id = t.planta_id;
  foreach n in array p_numeros loop
    if n < t.desde or n > t.hasta then raise exception 'El número % no pertenece a este talonario', _n8(n); end if;
    if exists (select 1 from remitos where punto_venta = v_pv and numero = _n8(n)) then
      raise exception 'El número % ya tiene un remito emitido', _n8(n);
    end if;
    insert into talonario_justificaciones (talonario_id, planta_id, numero, motivo, detalle, usuario_id, usuario_nombre)
    values (t.id, t.planta_id, n, p_motivo, nullif(trim(coalesce(p_detalle, '')), ''), v_user.id, v_user.nombre)
    on conflict (talonario_id, numero) do nothing;
    v_c := v_c + 1;
  end loop;
  perform _actualizar_estado_talonario(t.id);
  return v_c;
end $$;

-- Número sugerido para emitir: el siguiente del talonario vigente más antiguo.
create or replace function public.siguiente_numero(p_planta uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user profiles%rowtype; v_planta uuid; v_pv text; o talonarios%rowtype;
  v_max int; v_next int; v_total int := 0; v_res jsonb := null; v_cons int; v_huecos int;
begin
  v_user := _usuario_activo();
  if not _control_talonarios_activo() then return jsonb_build_object('control', false); end if;
  v_planta := case when v_user.rol = 'admin' and p_planta is not null then p_planta else v_user.planta_id end;
  if v_planta is null then return jsonb_build_object('control', true, 'numero', null, 'motivo', 'Sin planta'); end if;
  select punto_venta into v_pv from plantas where id = v_planta;

  for o in select * from talonarios
           where planta_id = v_planta and estado = 'activo' and cai_vencimiento >= _hoy_ar() order by desde
  loop
    v_total := v_total + _disponibles(o);
    if v_res is null and _disponibles(o) > 0 then
      select max(n), count(*) into v_max, v_cons from (
        select numero::int as n from remitos where punto_venta = v_pv and numero between _n8(o.desde) and _n8(o.hasta)
        union all select numero from talonario_justificaciones where talonario_id = o.id) x;
      v_next := greatest(coalesce(v_max, 0) + 1, o.desde);
      if v_next > o.hasta then
        select g into v_next from generate_series(o.desde, o.hasta) g
        where not exists (select 1 from remitos r where r.punto_venta = v_pv and r.numero = _n8(g))
          and not exists (select 1 from talonario_justificaciones j where j.talonario_id = o.id and j.numero = g)
        order by g limit 1;
      end if;
      v_huecos := case when v_max is null then 0 else greatest(v_max - o.desde + 1 - v_cons, 0) end;
      v_res := jsonb_build_object('numero', _n8(v_next), 'talonario_id', o.id, 'desde', _n8(o.desde),
        'hasta', _n8(o.hasta), 'cai', o.cai, 'cai_vencimiento', o.cai_vencimiento,
        'disponibles', _disponibles(o), 'huecos', v_huecos,
        'dias_vencimiento', o.cai_vencimiento - _hoy_ar());
    end if;
  end loop;

  if v_res is null then
    return jsonb_build_object('control', true, 'numero', null,
      'motivo', 'Tu planta no tiene un talonario activo y con CAI vigente. Pedile al administrador que cargue el talonario nuevo.');
  end if;
  return v_res || jsonb_build_object('control', true, 'total_disponibles', v_total);
end $$;

-- Activar / apagar el control (solo admin).
create or replace function public.set_control_talonarios(p_activo boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype;
begin
  v_user := _usuario_activo();
  if v_user.rol <> 'admin' then raise exception 'Solo el administrador puede cambiar esto'; end if;
  insert into configuracion (clave, valor) values ('control_talonarios', jsonb_build_object('activo', p_activo))
  on conflict (clave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- emitir_remito con control de talonario
-- ---------------------------------------------------------------------
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
      observaciones, usuario_id, usuario_nombre, talonario_id, cai, cai_vencimiento
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
      v_tal.id, v_tal.cai, v_tal.cai_vencimiento
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
