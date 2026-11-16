-- =====================================================================
-- Migración 52: exportación de despachos para el sistema contable
--  * plantas.nombre_sistema: nombre del depósito tal como está en el sistema contable.
--  * Cada renglón de remito guarda si ya fue exportado (para no bajarlo dos veces).
--  * export_contable(): renglones de despachos a clientes con O/V (sin traslados ni anulados).
--    Artículo = primer alias del producto. Cantidad en unidades.
--  * marcar_exportados() / deshacer_exportacion(). Solo Administrador y Logística.
-- =====================================================================
alter table public.plantas add column if not exists nombre_sistema text;

create table if not exists public.exportaciones_contables (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  usuario_nombre text,
  renglones int not null default 0
);
alter table public.exportaciones_contables enable row level security;
drop policy if exists exportaciones_select on public.exportaciones_contables;
create policy exportaciones_select on public.exportaciones_contables for select to authenticated using (true);

alter table public.remito_items add column if not exists exportacion_id uuid references public.exportaciones_contables(id) on delete set null;
alter table public.remito_items add column if not exists exportado_en timestamptz;
create index if not exists remito_items_export_idx on public.remito_items (exportacion_id);

create or replace function public.export_contable(p_desde date default null, p_hasta date default null, p_planta uuid default null, p_ver text default 'pendientes', p_exportacion uuid default null)
returns table (
  item_id uuid, fecha date, remito text, planta text, deposito_sistema text, orden_carga text, ov text, cliente text,
  producto text, articulo_sistema text, lote text, unidades numeric, exportado_en timestamptz, exportacion_id uuid
) language plpgsql stable security definer set search_path = public as $$
begin
  if not _es_admin_o_logistica() then raise exception 'Solo Administración o Logística pueden exportar al sistema contable'; end if;
  return query
  select ri.id, r.fecha::date, (r.punto_venta || '-' || r.numero)::text, pl.nombre::text, nullif(btrim(coalesce(pl.nombre_sistema, '')), '')::text,
         coalesce(r.orden_carga, '')::text, btrim(l.ov)::text, r.cliente_nombre::text,
         coalesce(p.nombre, l.producto_texto, ri.descripcion)::text,
         nullif(btrim(coalesce(p.alias[1], '')), '')::text,
         coalesce(lo.lote, ri.lote_texto, l.lote_texto, '')::text,
         ri.cantidad, ri.exportado_en, ri.exportacion_id
  from remito_items ri
  join remitos r on r.id = ri.remito_id
  join plantas pl on pl.id = r.planta_id
  join ordenes_carga_lineas l on l.id = ri.orden_linea_id
  left join productos p on p.id = coalesce(ri.producto_id, l.producto_id)
  left join lotes lo on lo.id = ri.lote_id
  where coalesce(r.tipo, '') <> 'traslado'
    and r.estado not in ('anulado', 'rechazado')
    and btrim(coalesce(l.ov, '')) <> ''
    and (p_desde is null or r.fecha::date >= p_desde)
    and (p_hasta is null or r.fecha::date <= p_hasta)
    and (p_planta is null or r.planta_id = p_planta)
    and (p_exportacion is null or ri.exportacion_id = p_exportacion)
    and (p_exportacion is not null or p_ver = 'todos'
         or (p_ver = 'pendientes' and ri.exportacion_id is null)
         or (p_ver = 'exportados' and ri.exportacion_id is not null))
  order by r.fecha, r.punto_venta, r.numero, ri.orden;
end $$;

create or replace function public.marcar_exportados(p_items uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int; v_nom text;
begin
  if not _es_admin_o_logistica() then raise exception 'Solo Administración o Logística pueden exportar al sistema contable'; end if;
  if p_items is null or array_length(p_items, 1) is null then raise exception 'No hay renglones para marcar'; end if;
  select nombre into v_nom from profiles where id = auth.uid();
  insert into exportaciones_contables (usuario_nombre) values (v_nom) returning id into v_id;
  update remito_items set exportacion_id = v_id, exportado_en = now() where id = any(p_items) and exportacion_id is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Esos renglones ya estaban exportados'; end if;
  update exportaciones_contables set renglones = v_n where id = v_id;
  return v_id;
end $$;

-- Deshace una exportación: sus renglones vuelven a quedar pendientes.
create or replace function public.deshacer_exportacion(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not _es_admin_o_logistica() then raise exception 'Solo Administración o Logística pueden exportar al sistema contable'; end if;
  update remito_items set exportacion_id = null, exportado_en = null where exportacion_id = p_id;
  get diagnostics v_n = row_count;
  delete from exportaciones_contables where id = p_id;
  return v_n;
end $$;

revoke execute on function public.export_contable(date, date, uuid, text, uuid) from public, anon;
revoke execute on function public.marcar_exportados(uuid[]) from public, anon;
revoke execute on function public.deshacer_exportacion(uuid) from public, anon;
grant execute on function public.export_contable(date, date, uuid, text, uuid) to authenticated;
grant execute on function public.marcar_exportados(uuid[]) to authenticated;
grant execute on function public.deshacer_exportacion(uuid) to authenticated;
notify pgrst, 'reload schema';
