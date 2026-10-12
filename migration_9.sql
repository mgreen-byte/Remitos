-- =====================================================================
-- MIGRACIÓN 9 — Talonarios: "primer número a usar" y edición por el admin
-- Ejecutar DESPUÉS de migration_8.sql. Se puede correr más de una vez.
--
-- Cada talonario tiene su rango impreso (desde / hasta) y ahora también el PRIMER NÚMERO
-- A USAR EN EL SISTEMA. Los formularios anteriores se tomaron como usados antes de empezar:
-- no cuentan como saltos, no figuran como disponibles y no se pueden emitir.
-- =====================================================================

alter table talonarios add column if not exists primero int;
update talonarios set primero = desde where primero is null;
alter table talonarios alter column primero set not null;
alter table talonarios drop constraint if exists talonarios_primero_check;
alter table talonarios add constraint talonarios_primero_check check (primero >= desde and primero <= hasta);

create or replace function public._disponibles(t talonarios) returns int
language sql stable security definer set search_path = public as $$
  select (t.hasta - t.primero + 1)
    - (select count(*) from remitos r join plantas p on p.id = t.planta_id
        where r.punto_venta = p.punto_venta and r.numero between _n8(t.primero) and _n8(t.hasta))::int
    - (select count(*) from talonario_justificaciones j where j.talonario_id = t.id)::int $$;

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

  if p_numero < t.primero then
    raise exception 'El número % corresponde a un formulario usado antes de empezar con el sistema (en este talonario se empieza desde el %).',
      _n8(p_numero), _n8(t.primero);
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
      where punto_venta = v_pv and numero between _n8(t.primero) and _n8(t.hasta)
    union all select numero from talonario_justificaciones where talonario_id = t.id) x;
  if v_max is null then return; end if;
  return query
    select g from generate_series(t.primero, v_max) g
    where not exists (select 1 from remitos r where r.punto_venta = v_pv and r.numero = _n8(g))
      and not exists (select 1 from talonario_justificaciones j where j.talonario_id = t.id and j.numero = g)
    order by g;
end $$;

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
        select numero::int as n from remitos where punto_venta = v_pv and numero between _n8(o.primero) and _n8(o.hasta)
        union all select numero from talonario_justificaciones where talonario_id = o.id) x;
      v_next := greatest(coalesce(v_max, 0) + 1, o.primero);
      if v_next > o.hasta then
        select g into v_next from generate_series(o.primero, o.hasta) g
        where not exists (select 1 from remitos r where r.punto_venta = v_pv and r.numero = _n8(g))
          and not exists (select 1 from talonario_justificaciones j where j.talonario_id = o.id and j.numero = g)
        order by g limit 1;
      end if;
      v_huecos := case when v_max is null then 0 else greatest(v_max - o.primero + 1 - v_cons, 0) end;
      v_res := jsonb_build_object('numero', _n8(v_next), 'talonario_id', o.id, 'desde', _n8(o.desde), 'primero', _n8(o.primero),
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

drop view if exists public.v_talonarios;
create view public.v_talonarios
with (security_invoker = true) as
select
  t.*, pl.nombre as planta, pl.punto_venta,
  (t.cai_vencimiento < (now() at time zone 'America/Argentina/Buenos_Aires')::date) as vencido,
  u.usados, j.justificados,
  (t.hasta - t.primero + 1) - u.usados - j.justificados as disponibles,
  greatest(u.mx, j.mx) as ultimo_numero,
  case when greatest(u.mx, j.mx) is null then 0
       else greatest(greatest(u.mx, j.mx) - t.primero + 1 - u.usados - j.justificados, 0) end as huecos
from talonarios t
join plantas pl on pl.id = t.planta_id
cross join lateral (
  select count(*)::int as usados, max(r.numero::int) as mx from remitos r
  where r.punto_venta = pl.punto_venta and r.numero between lpad(t.primero::text, 8, '0') and lpad(t.hasta::text, 8, '0')
) u
cross join lateral (
  select count(*)::int as justificados, max(numero) as mx from talonario_justificaciones where talonario_id = t.id
) j;

-- Alta: ahora admite el primer número a usar (si no se indica, es el "desde").
drop function if exists public.crear_talonario(uuid, int, int, text, date);
create or replace function public.crear_talonario(
  p_planta uuid, p_desde int, p_hasta int, p_cai text, p_vencimiento date, p_primero int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; v_id uuid; v_x talonarios%rowtype; v_primero int := coalesce(p_primero, p_desde);
begin
  v_user := _usuario_activo();
  if v_user.rol <> 'admin' then raise exception 'Solo el administrador puede cargar talonarios'; end if;
  if not exists (select 1 from plantas where id = p_planta) then raise exception 'La planta no existe'; end if;
  if p_desde is null or p_hasta is null or p_desde < 1 or p_hasta < p_desde then
    raise exception 'El rango es inválido: "desde" tiene que ser menor o igual a "hasta"';
  end if;
  if v_primero < p_desde or v_primero > p_hasta then
    raise exception 'El primer número a usar tiene que estar entre % y %', _n8(p_desde), _n8(p_hasta);
  end if;
  if p_cai is null or length(trim(p_cai)) < 5 then raise exception 'Falta el CAI'; end if;
  if p_vencimiento is null then raise exception 'Falta el vencimiento del CAI'; end if;

  select * into v_x from talonarios
  where planta_id = p_planta and desde <= p_hasta and hasta >= p_desde limit 1;
  if found then
    raise exception 'El rango se superpone con el talonario % a % (CAI %) de esa planta',
      _n8(v_x.desde), _n8(v_x.hasta), v_x.cai;
  end if;

  insert into talonarios (planta_id, desde, hasta, primero, cai, cai_vencimiento, creado_por, creado_por_nombre)
  values (p_planta, p_desde, p_hasta, v_primero, upper(trim(p_cai)), p_vencimiento, v_user.id, v_user.nombre)
  returning id into v_id;
  perform _actualizar_estado_talonario(v_id);
  return v_id;
end $$;

-- Edición (solo admin): primer número a usar, hasta, CAI y vencimiento.
create or replace function public.editar_talonario(
  p_id uuid, p_primero int default null, p_hasta int default null,
  p_cai text default null, p_vencimiento date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user profiles%rowtype; t talonarios%rowtype; v_pv text;
  v_primero int; v_hasta int; v_min text; v_max text;
begin
  v_user := _usuario_activo();
  if v_user.rol <> 'admin' then raise exception 'Solo el administrador puede editar talonarios'; end if;
  select * into t from talonarios where id = p_id for update;
  if not found then raise exception 'El talonario no existe'; end if;
  if t.estado = 'cerrado' then raise exception 'El talonario está dado de baja y no se puede editar'; end if;
  select punto_venta into v_pv from plantas where id = t.planta_id;

  v_primero := coalesce(p_primero, t.primero);
  v_hasta := coalesce(p_hasta, t.hasta);
  if v_hasta < t.desde then raise exception 'El "hasta" no puede ser menor que el "desde" (%)', _n8(t.desde); end if;
  if v_primero < t.desde or v_primero > v_hasta then
    raise exception 'El primer número a usar tiene que estar entre % y %', _n8(t.desde), _n8(v_hasta);
  end if;

  if exists (select 1 from talonarios o where o.planta_id = t.planta_id and o.id <> t.id
             and o.desde <= v_hasta and o.hasta >= t.desde) then
    raise exception 'El nuevo rango se superpone con otro talonario de la planta';
  end if;

  select min(numero), max(numero) into v_min, v_max from remitos
  where punto_venta = v_pv and numero between _n8(t.desde) and _n8(t.hasta);
  if v_min is not null and v_min < _n8(v_primero) then
    raise exception 'Ya hay remitos emitidos desde el sistema con número menor a % (el menor es el %). Elegí un número menor o igual.',
      _n8(v_primero), v_min;
  end if;
  if v_max is not null and v_max > _n8(v_hasta) then
    raise exception 'Ya hay remitos emitidos con número mayor a % (el mayor es el %).', _n8(v_hasta), v_max;
  end if;
  if exists (select 1 from talonario_justificaciones where talonario_id = t.id and (numero < v_primero or numero > v_hasta)) then
    raise exception 'Hay números justificados fuera del nuevo rango';
  end if;

  update talonarios
  set primero = v_primero, hasta = v_hasta,
      cai = case when p_cai is not null and length(trim(p_cai)) >= 5 then upper(trim(p_cai)) else cai end,
      cai_vencimiento = coalesce(p_vencimiento, cai_vencimiento)
  where id = t.id;

  select * into t from talonarios where id = p_id;
  if t.estado = 'agotado' and _disponibles(t) > 0 then
    update talonarios set estado = 'activo' where id = t.id;
  end if;
  perform _actualizar_estado_talonario(t.id);
end $$;
