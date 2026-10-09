-- =====================================================================
-- REMITOS — ESQUEMA v2 (completo)
-- Para un proyecto de Supabase NUEVO y VACÍO. Reemplaza a schema.sql,
-- migration_2.sql, migration_3.sql y schema_completo.sql.
--
-- Cómo usarlo:
--   1) Supabase -> SQL Editor -> New query -> pegar TODO este archivo -> Run.
--   2) Authentication -> Users -> Add user (tu email y contraseña, con
--      "Auto Confirm User" tildado).
--   3) Correr la última línea de este archivo (promoverte a admin).
--
-- Ideas de diseño:
--   * Cada usuario de planta ve SOLO lo de su planta. El admin ve todo.
--   * Stock, remitos y movimientos NO se escriben directamente desde la app:
--     solo a través de funciones (cargar_stock, ajustar_stock, emitir_remito,
--     anular_remito). Así el stock nunca queda negativo y un número de remito
--     no se puede repetir, aunque 12 plantas trabajen a la vez.
--   * Un remito nunca se borra: se anula (con motivo) y el stock se reintegra.
--   * Cada remito guarda una "foto" de lo que se imprimió (cliente,
--     transportista, chofer, ítems, lotes), aunque después cambien los datos.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Plantas (cada una con su punto de venta de 4 dígitos).
create table if not exists plantas (
  id uuid default gen_random_uuid() primary key,
  nombre text not null unique,
  punto_venta text not null unique check (punto_venta ~ '^[0-9]{4}$'),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Perfiles: extiende auth.users con nombre, rol, planta y modalidades.
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text,
  rol text not null default 'operador' check (rol in ('admin', 'operador')),
  planta_id uuid references plantas(id),
  modalidades text[] not null default array['soja', 'maiz', 'generico'],
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Al crearse un usuario en Authentication se crea su perfil solo
-- (rol operador, sin planta: el admin se la asigna desde el panel).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, upper(coalesce(new.raw_user_meta_data->>'nombre', new.email)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Ayudas para los permisos (security definer: evitan recursión en las políticas).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and rol = 'admin' and activo
  );
$$;

create or replace function public.mi_planta()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select planta_id from profiles where id = auth.uid() and activo;
$$;

-- Catálogo de productos (lo carga el admin): variedades de soja, híbridos de
-- maíz, insumos. "alias" sirve para reconocer nombres que vienen distintos
-- en el Excel de la orden de carga.
create table if not exists productos (
  id uuid default gen_random_uuid() primary key,
  categoria text not null check (categoria in ('soja', 'maiz', 'otro')),
  nombre text not null,
  presentacion text not null default '',
  kg_por_unidad numeric(12,3) check (kg_por_unidad is null or kg_por_unidad > 0),
  alias text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (categoria, nombre, presentacion)
);

-- Lotes por planta, con su stock actual. El stock solo cambia por funciones.
create table if not exists lotes (
  id uuid default gen_random_uuid() primary key,
  planta_id uuid not null references plantas(id),
  producto_id uuid not null references productos(id),
  lote text not null check (length(trim(lote)) > 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (planta_id, producto_id, lote)
);
create index if not exists lotes_planta_producto_idx on lotes (planta_id, producto_id);

-- Maestro de transportistas (solo datos de la empresa de transporte).
create table if not exists transportistas (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  cuit text,
  domicilio text,
  created_at timestamptz not null default now()
);

-- Choferes: compartidos entre todas las plantas. CUIL de 11 dígitos, sin repetir.
create table if not exists choferes (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  dni text not null unique check (dni ~ '^[0-9]{11}$'),
  chasis text,
  acoplado text,
  created_at timestamptz not null default now()
);

-- Configuración general (condiciones de IVA, calibración por defecto).
create table if not exists configuracion (
  clave text primary key,
  valor jsonb not null
);

insert into configuracion (clave, valor) values
  ('iva_options', '["IVA RESPONSABLE INSCRIPTO", "RESPONSABLE MONOTRIBUTO", "EXENTO", "CONSUMIDOR FINAL"]'),
  ('calibracion_default', '{"offsetX": 0, "offsetY": 0, "fontSize": 10}')
on conflict (clave) do nothing;

-- Remitos emitidos. (punto_venta, numero) es único: no se puede repetir.
create table if not exists remitos (
  id uuid default gen_random_uuid() primary key,
  planta_id uuid not null references plantas(id),
  punto_venta text not null check (punto_venta ~ '^[0-9]{4}$'),
  numero text not null check (numero ~ '^[0-9]{8}$'),
  fecha date not null,
  estado text not null default 'emitido' check (estado in ('emitido', 'anulado')),
  modalidad text not null,
  cliente_nombre text,
  cliente_cuit text,
  cliente_domicilio text,
  cliente_iva text,
  entregar_en text,
  transportista_id uuid references transportistas(id) on delete set null,
  transportista_nombre text,
  transportista_cuit text,
  transportista_domicilio text,
  chofer_id uuid references choferes(id) on delete set null,
  chofer_nombre text,
  chofer_cuil text,
  chasis text,
  acoplado text,
  total_unidades numeric(14,3),
  total_kgs numeric(14,3),
  observaciones text,
  usuario_id uuid references profiles(id),
  usuario_nombre text,
  created_at timestamptz not null default now(),
  anulado_at timestamptz,
  anulado_por uuid references profiles(id),
  anulado_por_nombre text,
  motivo_anulacion text,
  unique (punto_venta, numero)
);
create index if not exists remitos_planta_fecha_idx on remitos (planta_id, fecha desc);
create index if not exists remitos_cliente_idx on remitos (cliente_nombre);
create index if not exists remitos_created_idx on remitos (created_at desc);

-- Ítems de cada remito (con el lote usado).
create table if not exists remito_items (
  id uuid default gen_random_uuid() primary key,
  remito_id uuid not null references remitos(id) on delete cascade,
  orden int not null default 0,
  producto_id uuid references productos(id) on delete set null,
  lote_id uuid references lotes(id) on delete set null,
  lote_texto text,
  descripcion text not null,
  cantidad numeric(14,3) not null check (cantidad > 0),
  kg_unidad numeric(12,3),
  kg_total numeric(14,3)
);
create index if not exists remito_items_remito_idx on remito_items (remito_id);
create index if not exists remito_items_lote_idx on remito_items (lote_id);

-- Historial de movimientos de stock (ingresos, egresos por remito,
-- reintegros por anulación y ajustes). Cantidad con signo.
create table if not exists movimientos_stock (
  id uuid default gen_random_uuid() primary key,
  lote_id uuid not null references lotes(id),
  tipo text not null check (tipo in ('ingreso', 'egreso', 'reintegro', 'ajuste')),
  cantidad numeric(14,3) not null check (cantidad <> 0),
  stock_resultante numeric(14,3) not null,
  remito_id uuid references remitos(id),
  motivo text,
  usuario_id uuid references profiles(id),
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists mov_lote_idx on movimientos_stock (lote_id, created_at desc);
create index if not exists mov_remito_idx on movimientos_stock (remito_id);


-- ---------------------------------------------------------------------
-- 2. FUNCIONES (todo lo que escribe stock y remitos pasa por acá)
-- ---------------------------------------------------------------------

-- Limpia un texto: sin espacios de más, en MAYÚSCULAS, vacío -> null.
create or replace function public._u(t text)
returns text
language sql
immutable
as $$
  select upper(nullif(trim(t), ''));
$$;

-- Carga stock de un lote (lo crea si no existe). La planta carga en la suya;
-- el admin puede indicar p_planta_id.
create or replace function public.cargar_stock(
  p_producto_id uuid,
  p_lote text,
  p_cantidad numeric,
  p_planta_id uuid default null,
  p_motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_planta uuid;
  v_lote text := upper(trim(coalesce(p_lote, '')));
  v_lote_id uuid;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  v_planta := case when v_user.rol = 'admin' and p_planta_id is not null
                   then p_planta_id else v_user.planta_id end;
  if v_planta is null then raise exception 'Tu usuario no tiene una planta asignada'; end if;
  if v_lote = '' then raise exception 'Falta el número de lote'; end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor a cero';
  end if;
  if not exists (select 1 from productos where id = p_producto_id and activo) then
    raise exception 'El producto no existe o está inactivo';
  end if;

  insert into lotes (planta_id, producto_id, lote)
  values (v_planta, p_producto_id, v_lote)
  on conflict (planta_id, producto_id, lote) do nothing;

  select id into v_lote_id from lotes
  where planta_id = v_planta and producto_id = p_producto_id and lote = v_lote
  for update;

  update lotes set stock = stock + p_cantidad, activo = true
  where id = v_lote_id
  returning stock into v_stock;

  insert into movimientos_stock (lote_id, tipo, cantidad, stock_resultante, motivo, usuario_id, usuario_nombre)
  values (v_lote_id, 'ingreso', p_cantidad, v_stock, nullif(trim(p_motivo), ''), v_uid, v_user.nombre);

  return v_lote_id;
end;
$$;

-- Ajusta el stock de un lote (positivo o negativo) con motivo obligatorio.
create or replace function public.ajustar_stock(
  p_lote_id uuid,
  p_delta numeric,
  p_motivo text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_lote lotes%rowtype;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  if p_delta is null or p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Indicá el motivo del ajuste';
  end if;

  select * into v_lote from lotes where id = p_lote_id for update;
  if not found then raise exception 'El lote no existe'; end if;
  if v_user.rol <> 'admin' and v_lote.planta_id is distinct from v_user.planta_id then
    raise exception 'No podés ajustar lotes de otra planta';
  end if;
  if v_lote.stock + p_delta < 0 then
    raise exception 'El ajuste dejaría el lote % con stock negativo (hay %)', v_lote.lote, v_lote.stock;
  end if;

  update lotes set stock = stock + p_delta where id = p_lote_id returning stock into v_stock;

  insert into movimientos_stock (lote_id, tipo, cantidad, stock_resultante, motivo, usuario_id, usuario_nombre)
  values (p_lote_id, 'ajuste', p_delta, v_stock, trim(p_motivo), v_uid, v_user.nombre);

  return v_stock;
end;
$$;

-- Emite un remito: valida punto de venta y número, descuenta el stock de cada
-- lote y deja todo registrado, en una sola operación (o se hace todo, o nada).
--   p_remito: {punto_venta, numero, fecha, modalidad, cliente_nombre, cliente_cuit,
--              cliente_domicilio, cliente_iva, entregar_en, transportista_id,
--              transportista_nombre, transportista_cuit, transportista_domicilio,
--              chofer_id, chofer_nombre, chofer_cuil, chasis, acoplado,
--              total_kgs (opcional), observaciones, planta_id (solo admin)}
--   p_items:  [{producto_id, lote_id, descripcion, cantidad, kg_unidad}, ...]
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El remito no tiene ítems';
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
      observaciones, usuario_id, usuario_nombre
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
      _u(p_remito->>'observaciones'), v_uid, v_user.nombre
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
    v_lote := null;

    if v_cant is null or v_cant <= 0 then
      raise exception 'Ítem %: la cantidad tiene que ser mayor a cero', v_i;
    end if;
    if v_desc is null then
      raise exception 'Ítem %: falta la descripción', v_i;
    end if;

    if nullif(v_item->>'lote_id', '') is not null then
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
      (remito_id, orden, producto_id, lote_id, lote_texto, descripcion, cantidad, kg_unidad, kg_total)
    values (
      v_remito_id, v_i,
      coalesce(v_lote.producto_id, nullif(v_item->>'producto_id', '')::uuid),
      v_lote.id, v_lote.lote, v_desc, v_cant, v_kgu,
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

  return v_remito_id;
end;
$$;

-- Anula un remito (motivo obligatorio) y reintegra el stock de sus lotes.
-- El admin anula cualquiera; cada planta, los suyos.
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
    values (v_it.lote_id, 'reintegro', v_it.cant, v_stock, p_remito_id,
            'Anulación del remito ' || v_r.punto_venta || '-' || v_r.numero,
            v_uid, v_user.nombre);
  end loop;

  update remitos
  set estado = 'anulado', anulado_at = now(), anulado_por = v_uid,
      anulado_por_nombre = v_user.nombre, motivo_anulacion = trim(p_motivo)
  where id = p_remito_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. VISTAS PARA CONSULTAS Y TRAZABILIDAD (respetan los permisos de quien consulta)
-- ---------------------------------------------------------------------

-- Una fila por ítem de remito: sirve para buscar "¿en qué remitos salió el lote X?".
create or replace view public.v_remito_items_detalle
with (security_invoker = true) as
select
  r.id as remito_id, r.punto_venta, r.numero, r.fecha, r.estado, r.modalidad,
  pl.nombre as planta,
  r.cliente_nombre, r.cliente_cuit, r.transportista_nombre, r.chofer_nombre, r.chasis, r.acoplado,
  ri.orden, ri.descripcion, ri.lote_texto as lote, ri.cantidad, ri.kg_unidad, ri.kg_total,
  r.usuario_nombre, r.created_at, r.motivo_anulacion
from remitos r
join plantas pl on pl.id = r.planta_id
join remito_items ri on ri.remito_id = r.id;

-- Stock actual por planta, producto y lote.
create or replace view public.v_stock_lotes
with (security_invoker = true) as
select
  l.id as lote_id, pl.nombre as planta, p.categoria, p.nombre as producto,
  p.presentacion, l.lote, l.stock, l.activo
from lotes l
join plantas pl on pl.id = l.planta_id
join productos p on p.id = l.producto_id;


-- ---------------------------------------------------------------------
-- 4. SEGURIDAD POR FILA (RLS)
-- ---------------------------------------------------------------------

alter table plantas enable row level security;
alter table profiles enable row level security;
alter table productos enable row level security;
alter table lotes enable row level security;
alter table transportistas enable row level security;
alter table choferes enable row level security;
alter table configuracion enable row level security;
alter table remitos enable row level security;
alter table remito_items enable row level security;
alter table movimientos_stock enable row level security;

-- plantas: leen todos los logueados; escribe el admin.
drop policy if exists "plantas: lectura" on plantas;
create policy "plantas: lectura" on plantas for select to authenticated using (true);
drop policy if exists "plantas: admin" on plantas;
create policy "plantas: admin" on plantas for all to authenticated
  using (is_admin()) with check (is_admin());

-- profiles: cada uno ve el suyo; el admin ve y modifica todos.
drop policy if exists "profiles: lectura" on profiles;
create policy "profiles: lectura" on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
drop policy if exists "profiles: admin actualiza" on profiles;
create policy "profiles: admin actualiza" on profiles for update to authenticated
  using (is_admin()) with check (is_admin());

-- productos: leen todos; escribe el admin.
drop policy if exists "productos: lectura" on productos;
create policy "productos: lectura" on productos for select to authenticated using (true);
drop policy if exists "productos: admin" on productos;
create policy "productos: admin" on productos for all to authenticated
  using (is_admin()) with check (is_admin());

-- lotes, remitos, ítems y movimientos: solo lectura directa, y solo de la propia
-- planta (el admin ve todo). Las escrituras pasan por las funciones.
drop policy if exists "lotes: lectura" on lotes;
create policy "lotes: lectura" on lotes for select to authenticated
  using (is_admin() or planta_id = mi_planta());

drop policy if exists "remitos: lectura" on remitos;
create policy "remitos: lectura" on remitos for select to authenticated
  using (is_admin() or planta_id = mi_planta());

drop policy if exists "remito_items: lectura" on remito_items;
create policy "remito_items: lectura" on remito_items for select to authenticated
  using (exists (select 1 from remitos r where r.id = remito_items.remito_id));

drop policy if exists "movimientos: lectura" on movimientos_stock;
create policy "movimientos: lectura" on movimientos_stock for select to authenticated
  using (exists (select 1 from lotes l where l.id = movimientos_stock.lote_id));

-- transportistas y configuración: leen todos; escribe el admin.
drop policy if exists "transportistas: lectura" on transportistas;
create policy "transportistas: lectura" on transportistas for select to authenticated using (true);
drop policy if exists "transportistas: admin" on transportistas;
create policy "transportistas: admin" on transportistas for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "configuracion: lectura" on configuracion;
create policy "configuracion: lectura" on configuracion for select to authenticated using (true);
drop policy if exists "configuracion: admin" on configuracion;
create policy "configuracion: admin" on configuracion for all to authenticated
  using (is_admin()) with check (is_admin());

-- choferes: leen y agregan todos los logueados; edita y borra el admin.
drop policy if exists "choferes: lectura" on choferes;
create policy "choferes: lectura" on choferes for select to authenticated using (true);
drop policy if exists "choferes: alta" on choferes;
create policy "choferes: alta" on choferes for insert to authenticated with check (true);
drop policy if exists "choferes: admin edita" on choferes;
create policy "choferes: admin edita" on choferes for update to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "choferes: admin borra" on choferes;
create policy "choferes: admin borra" on choferes for delete to authenticated
  using (is_admin());


-- ---------------------------------------------------------------------
-- 5. PERMISOS DE EJECUCIÓN (solo usuarios logueados)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.mi_planta() from public, anon;
revoke execute on function public.cargar_stock(uuid, text, numeric, uuid, text) from public, anon;
revoke execute on function public.ajustar_stock(uuid, numeric, text) from public, anon;
revoke execute on function public.emitir_remito(jsonb, jsonb) from public, anon;
revoke execute on function public.anular_remito(uuid, text) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.mi_planta() to authenticated;
grant execute on function public.cargar_stock(uuid, text, numeric, uuid, text) to authenticated;
grant execute on function public.ajustar_stock(uuid, numeric, text) to authenticated;
grant execute on function public.emitir_remito(jsonb, jsonb) to authenticated;
grant execute on function public.anular_remito(uuid, text) to authenticated;


-- =====================================================================
-- DESPUÉS de crear tu usuario en Authentication -> Users, corré esto
-- (cambiando el email por el tuyo) para convertirte en admin:
--
--   update profiles set rol = 'admin'
--   where id = (select id from auth.users where email = 'tu-email@empresa.com');
-- =====================================================================


-- =====================================================================
-- INCLUIDO EN ESTE ARCHIVO: Transportes y choferes como base compartida (antes: migration_4)
-- Correr UNA vez en Supabase -> SQL Editor (sobre el proyecto que ya tiene schema_v2).
--  * Cualquier usuario logueado puede ver, agregar y editar transportes y choferes.
--  * Solo el admin puede borrar.
--  * El CUIT del transporte son 11 dígitos y no se repite (igual que el CUIL del chofer).
--  * Queda registrado quién cargó y quién modificó por última vez cada registro.
--  Los remitos ya emitidos NO cambian: guardan su propia copia de los datos.
-- =====================================================================

-- 1. Datos de auditoría
alter table transportistas add column if not exists creado_por_nombre text;
alter table transportistas add column if not exists modificado_por_nombre text;
alter table transportistas add column if not exists modificado_at timestamptz;
alter table choferes add column if not exists creado_por_nombre text;
alter table choferes add column if not exists modificado_por_nombre text;
alter table choferes add column if not exists modificado_at timestamptz;

create or replace function public.set_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  select nombre into v_nombre from profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.creado_por_nombre := coalesce(v_nombre, new.creado_por_nombre);
  else
    new.modificado_por_nombre := v_nombre;
    new.modificado_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists transportistas_auditoria_ins on transportistas;
create trigger transportistas_auditoria_ins before insert on transportistas
  for each row execute function public.set_auditoria();
drop trigger if exists transportistas_auditoria_upd on transportistas;
create trigger transportistas_auditoria_upd before update on transportistas
  for each row execute function public.set_auditoria();
drop trigger if exists choferes_auditoria_ins on choferes;
create trigger choferes_auditoria_ins before insert on choferes
  for each row execute function public.set_auditoria();
drop trigger if exists choferes_auditoria_upd on choferes;
create trigger choferes_auditoria_upd before update on choferes
  for each row execute function public.set_auditoria();

-- 2. CUIT del transporte: 11 dígitos y sin repetir (vacío permitido)
update transportistas set cuit = nullif(regexp_replace(coalesce(cuit, ''), '[^0-9]', '', 'g'), '');
alter table transportistas drop constraint if exists transportistas_cuit_formato;
alter table transportistas add constraint transportistas_cuit_formato
  check (cuit is null or cuit ~ '^[0-9]{11}$');
create unique index if not exists transportistas_cuit_unico on transportistas (cuit) where cuit is not null;

-- 3. Permisos: todos leen, agregan y editan; solo el admin borra
drop policy if exists "transportistas: admin" on transportistas;
drop policy if exists "transportistas: alta" on transportistas;
create policy "transportistas: alta" on transportistas for insert to authenticated with check (true);
drop policy if exists "transportistas: edita" on transportistas;
create policy "transportistas: edita" on transportistas for update to authenticated using (true) with check (true);
drop policy if exists "transportistas: admin borra" on transportistas;
create policy "transportistas: admin borra" on transportistas for delete to authenticated using (is_admin());

drop policy if exists "choferes: admin edita" on choferes;
drop policy if exists "choferes: edita" on choferes;
create policy "choferes: edita" on choferes for update to authenticated using (true) with check (true);
