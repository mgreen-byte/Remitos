-- =========================================================
-- Esquema de la base de datos para el sistema de remitos.
-- Corré esto una sola vez en Supabase: Dashboard -> SQL Editor -> New query -> pegar y Run.
-- =========================================================

-- Perfiles: extiende auth.users con nombre, rol y modalidades permitidas.
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text,
  rol text not null default 'operador' check (rol in ('admin', 'operador')),
  modalidades text[] not null default array['soja', 'maiz', 'generico'],
  created_at timestamptz default now()
);

-- Se crea automáticamente un perfil (rol operador, todas las modalidades)
-- apenas alguien acepta una invitación / se registra.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Maestro de transportistas.
create table if not exists transportistas (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  cuit text,
  domicilio text,
  chasis text,
  acoplado text,
  chofer text,
  dni text,
  created_at timestamptz default now()
);

-- Configuración general (condiciones de IVA, calibración por defecto, etc.)
-- guardada como filas clave/valor en JSON.
create table if not exists configuracion (
  clave text primary key,
  valor jsonb not null
);

insert into configuracion (clave, valor) values
  ('iva_options', '["IVA Responsable Inscripto", "Responsable Monotributo", "Exento", "Consumidor Final"]'),
  ('calibracion_default', '{"offsetX": 0, "offsetY": 0, "fontSize": 10}')
on conflict (clave) do nothing;

-- Historial de remitos generados (no se guarda el Excel de origen, solo el resultado).
create table if not exists remitos_generados (
  id uuid default gen_random_uuid() primary key,
  numero text,
  cliente text,
  modalidad text,
  usuario_id uuid references profiles(id),
  usuario_nombre text,
  total_unidades text,
  total_kgs text,
  fecha text,
  created_at timestamptz default now()
);

-- =========================================================
-- Seguridad por fila (RLS): todo usuario logueado puede leer
-- lo compartido; solo el admin puede escribir configuración
-- y transportistas.
-- =========================================================

alter table profiles enable row level security;
alter table transportistas enable row level security;
alter table configuracion enable row level security;
alter table remitos_generados enable row level security;

-- profiles: cualquiera logueado puede ver todos los perfiles (para el panel admin);
-- solo un admin puede actualizar perfiles (rol/modalidades/nombre).
create policy "profiles: lectura autenticada" on profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles: admin actualiza" on profiles
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- transportistas: lectura para todos los logueados, escritura solo admin.
create policy "transportistas: lectura autenticada" on transportistas
  for select using (auth.role() = 'authenticated');

create policy "transportistas: admin escribe" on transportistas
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- configuracion: lectura para todos, escritura solo admin.
create policy "configuracion: lectura autenticada" on configuracion
  for select using (auth.role() = 'authenticated');

create policy "configuracion: admin escribe" on configuracion
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- remitos_generados: cualquier usuario logueado puede insertar y leer el historial completo.
create policy "remitos: lectura autenticada" on remitos_generados
  for select using (auth.role() = 'authenticated');

create policy "remitos: insercion autenticada" on remitos_generados
  for insert with check (auth.role() = 'authenticated');
