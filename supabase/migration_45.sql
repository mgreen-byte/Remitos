-- =====================================================================
-- Migración 45: ESTADO DE CALIDAD del stock
--  * Calidad por lote completo (producto + lote, común a todas las plantas). No mueve stock.
--    Estados: aprobado | pre_inspeccion | pre_inspeccion_datos | no_aprobado
--  * Lotes existentes -> aprobado. Lotes nuevos -> pre_inspeccion.
--  * Bolsa rota ("Dañado"): unidades dañadas por lote/planta (siguen en stock físico, no disponibles).
--  * Remitos de venta: bloquea lotes no aprobados ("estado NO DISPONIBLE"). Traslados: permitidos.
--  * Solo admin o logística cambian estados / registran dañados.
-- =====================================================================

create table if not exists public.calidad_lotes (
  producto_id uuid not null references public.productos(id),
  lote_key text not null,               -- lote normalizado (upper/trim)
  estado text not null default 'pre_inspeccion'
    check (estado in ('aprobado','pre_inspeccion','pre_inspeccion_datos','no_aprobado')),
  updated_at timestamptz not null default now(),
  updated_por_nombre text,
  primary key (producto_id, lote_key)
);
alter table public.calidad_lotes enable row level security;
drop policy if exists calidad_select on public.calidad_lotes;
create policy calidad_select on public.calidad_lotes for select to authenticated using (true);

create table if not exists public.calidad_log (
  id uuid default gen_random_uuid() primary key,
  producto_id uuid not null,
  lote_key text not null,
  estado_anterior text,
  estado_nuevo text not null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
alter table public.calidad_log enable row level security;
drop policy if exists calidad_log_select on public.calidad_log;
create policy calidad_log_select on public.calidad_log for select to authenticated using (true);

-- Existentes: aprobado
insert into public.calidad_lotes (producto_id, lote_key, estado)
select distinct producto_id, upper(btrim(lote)), 'aprobado' from public.lotes
on conflict do nothing;

-- Nuevos lotes: pre inspección (si ya existe la calidad de ese producto+lote en otra planta, se respeta)
create or replace function public._lote_calidad_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into calidad_lotes (producto_id, lote_key, estado)
  values (new.producto_id, upper(btrim(new.lote)), 'pre_inspeccion')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists lotes_calidad_default on public.lotes;
create trigger lotes_calidad_default after insert on public.lotes
  for each row execute function public._lote_calidad_default();

create or replace function public._calidad_de(p_producto uuid, p_lote text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select estado from calidad_lotes where producto_id = p_producto and lote_key = upper(btrim(p_lote))), 'aprobado')
$$;

create or replace function public._es_admin_o_logistica()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and activo and rol in ('admin','logistica'))
$$;

create or replace function public.cambiar_calidad_lote(p_producto uuid, p_lote text, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := upper(btrim(coalesce(p_lote,''))); v_ant text; v_nom text;
begin
  if not _es_admin_o_logistica() then raise exception 'Solo administración o logística pueden cambiar el estado de calidad'; end if;
  if p_estado not in ('aprobado','pre_inspeccion','pre_inspeccion_datos','no_aprobado') then raise exception 'Estado de calidad inválido'; end if;
  if not exists (select 1 from lotes where producto_id = p_producto and upper(btrim(lote)) = v_key) then
    raise exception 'El lote no existe';
  end if;
  select nombre into v_nom from profiles where id = auth.uid();
  select estado into v_ant from calidad_lotes where producto_id = p_producto and lote_key = v_key for update;
  if v_ant is not distinct from p_estado then return; end if;
  insert into calidad_lotes (producto_id, lote_key, estado, updated_at, updated_por_nombre)
  values (p_producto, v_key, p_estado, now(), v_nom)
  on conflict (producto_id, lote_key) do update set estado = excluded.estado, updated_at = now(), updated_por_nombre = v_nom;
  insert into calidad_log (producto_id, lote_key, estado_anterior, estado_nuevo, usuario_nombre)
  values (p_producto, v_key, v_ant, p_estado, v_nom);
end $$;

-- ---------------------------------------------------------------------
-- Bolsa rota (Dañado): unidades dañadas por lote
-- ---------------------------------------------------------------------
alter table public.lotes add column if not exists danado numeric(14,3) not null default 0;
alter table public.lotes drop constraint if exists lotes_danado_check;
alter table public.lotes add constraint lotes_danado_check check (danado >= 0 and danado <= stock);

create table if not exists public.danados_log (
  id uuid default gen_random_uuid() primary key,
  lote_id uuid not null,
  accion text not null check (accion in ('registrar','recuperar','descartar')),
  cantidad numeric not null,
  motivo text,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
alter table public.danados_log enable row level security;
drop policy if exists danados_log_select on public.danados_log;
create policy danados_log_select on public.danados_log for select to authenticated using (true);

create or replace function public.gestionar_danado(p_lote_id uuid, p_accion text, p_cantidad numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_l lotes%rowtype; v_nom text; v_nuevo numeric;
begin
  if not _es_admin_o_logistica() then raise exception 'Solo administración o logística pueden gestionar unidades dañadas'; end if;
  if p_accion not in ('registrar','recuperar','descartar') then raise exception 'Acción inválida'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into v_l from lotes where id = p_lote_id for update;
  if not found then raise exception 'El lote no existe'; end if;
  select nombre into v_nom from profiles where id = auth.uid();
  if p_accion = 'registrar' then
    if v_l.danado + p_cantidad > v_l.stock then raise exception 'No podés marcar más unidades dañadas que el stock del lote'; end if;
    update lotes set danado = danado + p_cantidad where id = v_l.id;
  elsif p_accion = 'recuperar' then
    if p_cantidad > v_l.danado then raise exception 'Solo hay % unidades dañadas', v_l.danado; end if;
    update lotes set danado = danado - p_cantidad where id = v_l.id;
  else
    if p_cantidad > v_l.danado then raise exception 'Solo hay % unidades dañadas', v_l.danado; end if;
    perform set_config('app.pallets_ok', '1', true);
    v_nuevo := v_l.stock - p_cantidad;
    update lotes set danado = danado - p_cantidad, stock = v_nuevo where id = v_l.id;
    insert into movimientos_stock (lote_id, tipo, cantidad, stock_resultante, usuario_id, usuario_nombre)
    values (v_l.id, 'ajuste', -p_cantidad, v_nuevo, auth.uid(), v_nom);
  end if;
  insert into danados_log (lote_id, accion, cantidad, motivo, usuario_nombre)
  values (v_l.id, p_accion, p_cantidad, nullif(btrim(coalesce(p_motivo,'')), ''), v_nom);
end $$;

-- ---------------------------------------------------------------------
-- Despacho: wrapper de emitir_remito (los traslados quedan permitidos)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_proc where proname = 'emitir_remito' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = '_emitir_remito_base45' and pronamespace = 'public'::regnamespace) then
    alter function public.emitir_remito(jsonb, jsonb) rename to _emitir_remito_base45;
  end if;
end $$;
revoke execute on function public._emitir_remito_base45(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.emitir_remito(p_remito jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare e jsonb; l lotes%rowtype; v_est text; v_cant numeric;
begin
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(e->>'lote_id','') is null then continue; end if;
    select * into l from lotes where id = (e->>'lote_id')::uuid;
    if not found then continue; end if;
    v_cant := coalesce(nullif(e->>'cantidad','')::numeric, 0);
    if coalesce(p_remito->>'modalidad','') <> 'traslado' then
      v_est := _calidad_de(l.producto_id, l.lote);
      if v_est <> 'aprobado' then
        raise exception 'El lote % está NO DISPONIBLE (estado de calidad: %)', l.lote,
          case v_est when 'pre_inspeccion' then 'PRE INSPECCIÓN' when 'pre_inspeccion_datos' then 'PRE INSPECCIÓN c/datos' else 'NO APROBADO CALIDAD' end;
      end if;
    end if;
    if l.danado > 0 and l.stock - l.danado < v_cant then
      raise exception 'El lote % tiene % unidades dañadas: solo hay % disponibles para despachar', l.lote, l.danado, l.stock - l.danado;
    end if;
  end loop;
  return _emitir_remito_base45(p_remito, p_items);
end $$;
grant execute on function public.emitir_remito(jsonb, jsonb) to authenticated;
grant execute on function public.cambiar_calidad_lote(uuid, text, text) to authenticated;
grant execute on function public.gestionar_danado(uuid, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
