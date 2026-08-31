-- =========================================================
-- Migración 3: el chasis y el acoplado pasan del transportista
-- al chofer (porque un chofer puede manejar distintos camiones
-- según el día). El transportista queda solo con los datos de
-- la empresa. El CUIL del chofer se fuerza a 11 dígitos numéricos.
-- Corré esto en Supabase -> SQL Editor -> New query -> Run.
-- =========================================================

alter table choferes add column if not exists chasis text;
alter table choferes add column if not exists acoplado text;

alter table transportistas drop column if exists chasis;
alter table transportistas drop column if exists acoplado;

-- El CUIL tiene que ser de 11 dígitos numéricos. Se aplica "NOT VALID"
-- para no romper si ya hay choferes cargados con otro formato — a partir
-- de ahora, cualquier chofer nuevo sí lo va a exigir.
alter table choferes drop constraint if exists choferes_dni_format;
alter table choferes add constraint choferes_dni_format
  check (dni ~ '^[0-9]{11}$') not valid;
