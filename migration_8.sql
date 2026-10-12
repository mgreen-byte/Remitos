-- =====================================================================
-- MIGRACIÓN 8 — Rol "consulta", maestros de transportes/choferes solo para el admin,
--               y grupos de productos (semilla / insumo / ensamblaje)
-- Ejecutar DESPUÉS de migration_7.sql. Se puede correr más de una vez.
-- =====================================================================

-- 1. Rol CONSULTA: ve todo (todas las plantas), descarga, y no modifica nada. ----
alter table profiles drop constraint if exists profiles_rol_check;
alter table profiles add constraint profiles_rol_check check (rol in ('admin', 'operador', 'consulta'));

create or replace function public.es_consulta() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and rol = 'consulta' and activo) $$;

create or replace function public.puede_ver_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or es_consulta() $$;

drop policy if exists "lotes: lectura" on lotes;
create policy "lotes: lectura" on lotes for select to authenticated
  using (puede_ver_todo() or planta_id = mi_planta());

drop policy if exists "remitos: lectura" on remitos;
create policy "remitos: lectura" on remitos for select to authenticated
  using (puede_ver_todo() or planta_id = mi_planta()
         or (tipo = 'traslado' and planta_destino_id = mi_planta()));

drop policy if exists "talonarios: lectura" on talonarios;
create policy "talonarios: lectura" on talonarios for select to authenticated
  using (puede_ver_todo() or planta_id = mi_planta());

drop policy if exists "justificaciones: lectura" on talonario_justificaciones;
create policy "justificaciones: lectura" on talonario_justificaciones for select to authenticated
  using (puede_ver_todo() or planta_id = mi_planta());

-- Red de seguridad: ninguna escritura sobre estas tablas, venga de donde venga
-- (pantalla, API o funciones), si el usuario es de solo consulta.
create or replace function public._bloquear_consulta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if es_consulta() then
    raise exception 'Tu usuario es de solo consulta: no puede modificar datos.';
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['lotes', 'movimientos_stock', 'remitos', 'remito_items', 'talonarios',
                           'talonario_justificaciones', 'choferes', 'transportistas', 'productos',
                           'plantas', 'configuracion']
  loop
    execute format('drop trigger if exists bloquear_consulta on %I', t);
    execute format('create trigger bloquear_consulta before insert or update or delete on %I
                    for each statement execute function public._bloquear_consulta()', t);
  end loop;
end $$;

create or replace function public.numeros_sin_justificar(p_talonario uuid)
returns setof int
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype; t talonarios%rowtype; v_pv text; v_max int;
begin
  v_user := _usuario_activo();
  select * into t from talonarios where id = p_talonario;
  if not found then return; end if;
  if v_user.rol not in ('admin', 'consulta') and t.planta_id is distinct from v_user.planta_id then return; end if;
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

-- 2. Transportes y choferes: el maestro (editar / borrar / importar) es del admin. ----
-- Los operadores pueden leer (para elegir en el remito) y dar de alta uno nuevo desde
-- el remito, pero no editar los existentes. Las patentes del chofer se actualizan
-- por una función acotada.
drop policy if exists "choferes: edita" on choferes;
drop policy if exists "choferes: admin edita" on choferes;
create policy "choferes: admin edita" on choferes for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "transportistas: edita" on transportistas;
drop policy if exists "transportistas: admin edita" on transportistas;
create policy "transportistas: admin edita" on transportistas for update to authenticated
  using (is_admin()) with check (is_admin());

create or replace function public.actualizar_patentes_chofer(p_chofer uuid, p_chasis text, p_acoplado text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;
  if v_user.rol = 'consulta' then raise exception 'Tu usuario es de solo consulta: no puede modificar datos.'; end if;
  update choferes set chasis = nullif(upper(trim(coalesce(p_chasis, ''))), ''),
                      acoplado = nullif(upper(trim(coalesce(p_acoplado, ''))), '')
  where id = p_chofer;
end $$;

-- 3. Productos: grupo (semilla / insumo / ensamblaje) ----
alter table productos add column if not exists grupo text not null default 'semilla';
alter table productos drop constraint if exists productos_grupo_check;
alter table productos add constraint productos_grupo_check check (grupo in ('semilla', 'insumo', 'ensamblaje'));
