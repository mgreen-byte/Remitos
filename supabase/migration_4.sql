-- =====================================================================
-- MIGRACIÓN 4 — Transportes y choferes como base compartida
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
