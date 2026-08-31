-- =========================================================
-- Migración 2: separar choferes de transportistas, número de
-- remito en punto de venta + número, y RLS para que cualquier
-- usuario logueado pueda cargar un chofer nuevo.
-- Corré esto en Supabase -> SQL Editor -> New query -> Run.
-- =========================================================

-- Choferes: tabla propia, compartida entre todos los usuarios.
-- El CUIL/DNI no se puede repetir.
create table if not exists choferes (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  dni text not null unique,
  created_at timestamptz default now()
);

alter table choferes enable row level security;

drop policy if exists "choferes: lectura autenticada" on choferes;
create policy "choferes: lectura autenticada" on choferes
  for select using (auth.role() = 'authenticated');

-- Cualquier usuario logueado puede agregar un chofer nuevo
-- (no hace falta ser admin, para poder cargarlo al vuelo).
drop policy if exists "choferes: insercion autenticada" on choferes;
create policy "choferes: insercion autenticada" on choferes
  for insert with check (auth.role() = 'authenticated');

-- Solo el admin puede editar o borrar choferes existentes.
drop policy if exists "choferes: admin edita" on choferes;
create policy "choferes: admin edita" on choferes
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

drop policy if exists "choferes: admin borra" on choferes;
create policy "choferes: admin borra" on choferes
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- El transportista deja de incluir datos del chofer: ahora es
-- solo la empresa/vehículo. Si tenías columnas viejas, se borran.
alter table transportistas drop column if exists chofer;
alter table transportistas drop column if exists dni;

-- El número de remito se registra separado en punto de venta (4
-- dígitos) y número (8 dígitos), además del texto combinado que
-- ya se guardaba.
alter table remitos_generados add column if not exists punto_venta text;
alter table remitos_generados add column if not exists numero_remito text;
