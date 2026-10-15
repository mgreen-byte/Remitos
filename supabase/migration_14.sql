-- =====================================================================
-- MIGRACIÓN 14 — Traslados entre depósitos: el destinatario es siempre la empresa propia
-- Ejecutar DESPUÉS de migration_13.sql. Se puede correr más de una vez.
--
--  * Cada planta tiene una EMPRESA (MS Technologies o Stine Seed): la del formulario en que imprime.
--  * En un traslado, el destinatario (nombre, CUIT, IVA) es la empresa de la planta de origen.
--    Lo exige la base, no solo la pantalla.
--  * Los datos de las empresas se pueden editar en Administración → Configuración.
--  * IMPORTANTE: después de correrla, asignar la empresa a cada planta en Administración → Plantas.
-- =====================================================================

alter table public.plantas add column if not exists empresa text;
alter table public.plantas drop constraint if exists plantas_empresa_check;
alter table public.plantas add constraint plantas_empresa_check check (empresa is null or empresa in ('ms', 'stine'));

insert into public.configuracion (clave, valor) values (
  'empresas',
  '{"ms": {"nombre": "MS TECHNOLOGIES ARGENTINA S.R.L.", "cuit": "30715468294", "iva": "IVA Responsable Inscripto"},
    "stine": {"nombre": "STINE SEED ARGENTINA SRL", "cuit": "30715863193", "iva": "IVA Responsable Inscripto"}}'::jsonb
) on conflict (clave) do nothing;

create or replace function public.emitir_traslado(p_remito jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_dest uuid := nullif(p_remito->>'planta_destino_id', '')::uuid;
  v_dest_row plantas%rowtype;
  v_origen uuid;
  v_empresa text;
  v_e jsonb;
  v_it jsonb;
  v_n int := 0;
begin
  if v_dest is null then raise exception 'Elegí la planta de destino'; end if;
  select * into v_dest_row from plantas where id = v_dest and activa;
  if not found then raise exception 'La planta de destino no existe o está inactiva'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El traslado no tiene ítems';
  end if;
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    if nullif(v_it->>'lote_id', '') is null then
      raise exception 'Ítem %: en un traslado todos los ítems tienen que salir de un lote con stock', v_n;
    end if;
  end loop;

  -- La provincia de destino sale de la planta de destino (así el COT se exige solo si corresponde).
  v_id := emitir_remito(
    p_remito || jsonb_build_object('modalidad', 'traslado',
                                   'cliente_provincia', coalesce(upper(nullif(trim(v_dest_row.provincia), '')), p_remito->>'cliente_provincia')),
    p_items);
  select planta_id into v_origen from remitos where id = v_id;
  if v_origen = v_dest then
    raise exception 'La planta de destino tiene que ser distinta a la de origen';
  end if;

  -- Traslado entre depósitos propios: el destinatario es siempre la empresa de la planta de origen.
  select empresa into v_empresa from plantas where id = v_origen;
  if v_empresa is null then
    raise exception 'La planta de origen no tiene empresa asignada (MS Technologies o Stine Seed). Pedile al administrador que la complete en Administración → Plantas.';
  end if;
  select valor -> v_empresa into v_e from configuracion where clave = 'empresas';
  if v_e is null or nullif(v_e->>'nombre', '') is null or length(regexp_replace(coalesce(v_e->>'cuit', ''), '\D', '', 'g')) <> 11 then
    raise exception 'Faltan los datos de la empresa (nombre y CUIT) en Administración → Configuración.';
  end if;
  update remitos
  set cliente_nombre = upper(v_e->>'nombre'),
      cliente_cuit = regexp_replace(v_e->>'cuit', '\D', '', 'g'),
      cliente_iva = coalesce(nullif(v_e->>'iva', ''), cliente_iva)
  where id = v_id;

  update remitos
  set tipo = 'traslado', estado = 'en_transito', planta_destino_id = v_dest
  where id = v_id;

  update movimientos_stock set tipo = 'traslado_egreso'
  where remito_id = v_id and tipo = 'egreso';

  return v_id;
end;
$$;

notify pgrst, 'reload schema';
