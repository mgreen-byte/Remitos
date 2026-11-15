-- =====================================================================
-- Migración 47: MAÍZ EN BOLSAS
--  * Cada lote puede tener su propio peso por bolsa (kg) y su calibre. Son datos del lote
--    (producto + lote), comunes a todas las plantas: viajan solos en los traslados.
--  * Los productos de categoría Maíz no llevan precinto en los remitos.
--  * La soja no cambia (sigue con el peso fijo del producto).
-- Requiere las migraciones 45 y 46 ya corridas.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_emitir_remito_base45' and pronamespace = 'public'::regnamespace) then
    raise exception 'Falta correr la migración 45 antes que esta';
  end if;
end $$;

alter table public.calidad_lotes add column if not exists kg_unidad numeric(12,3) check (kg_unidad is null or kg_unidad > 0);
alter table public.calidad_lotes add column if not exists calibre text;

-- Peso por bolsa y calibre de un lote (admin o logística). Vale para ese producto + lote en todas las plantas.
create or replace function public.definir_datos_lote(p_producto uuid, p_lote text, p_kg numeric, p_calibre text)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := upper(btrim(coalesce(p_lote, '')));
begin
  if not _es_admin_o_logistica() then raise exception 'Solo administración o logística pueden cargar el peso y el calibre del lote'; end if;
  if v_key = '' then raise exception 'Falta el lote'; end if;
  if p_kg is not null and p_kg <= 0 then raise exception 'El peso por bolsa tiene que ser mayor a cero'; end if;
  if not exists (select 1 from lotes where producto_id = p_producto and upper(btrim(lote)) = v_key) then
    raise exception 'El lote no existe';
  end if;
  insert into calidad_lotes (producto_id, lote_key, estado, kg_unidad, calibre)
  values (p_producto, v_key, 'pre_inspeccion', p_kg, nullif(upper(btrim(coalesce(p_calibre, ''))), ''))
  on conflict (producto_id, lote_key) do update
    set kg_unidad = excluded.kg_unidad, calibre = excluded.calibre;
end $$;
grant execute on function public.definir_datos_lote(uuid, text, numeric, text) to authenticated;

-- Emisión: igual que antes, pero el maíz no exige precinto.
create or replace function public._emitir_remito_base45(p_remito jsonb, p_items jsonb)
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
  v_prec text;
  v_tal talonarios%rowtype;
  v_prov text := upper(trim(coalesce(p_remito->>'cliente_provincia', '')));
  v_cot text := upper(trim(coalesce(p_remito->>'cot', '')));
  v_lote lotes%rowtype;
  v_stock_nuevo numeric;
  v_total_u numeric := 0;
  v_total_k numeric := 0;
  v_todos_kg boolean := true;
  v_lote_ids uuid[];
  v_grupo text;
  v_auto talonarios_autoimpresion%rowtype;
  v_hay_pre boolean;
  v_remito_id_n bigint;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;

  v_planta_id := case when v_user.rol = 'admin' and nullif(p_remito->>'planta_id', '') is not null
                      then (p_remito->>'planta_id')::uuid else v_user.planta_id end;
  if v_planta_id is null then raise exception 'Tu usuario no tiene una planta asignada'; end if;

  select punto_venta into v_pv from plantas where id = v_planta_id and activa;
  if not found then raise exception 'La planta no existe o está inactiva'; end if;

  -- Autoimpresión: si la planta tiene un talonario de autoimpresión con CAI vigente, el número lo asigna el sistema
  -- (correlativo por punto de venta, sin rango) y el remito sale solo en PDF.
  v_auto := _auto_vigente(v_planta_id);
  if v_auto.id is not null then
    if nullif(btrim(coalesce(v_auto.leyenda, '')), '') is null then
      raise exception 'Falta cargar la leyenda del CAI en el talonario de autoimpresión (Talonarios → Autoimpresión).';
    end if;
    v_pv := v_auto.punto_venta;
    perform pg_advisory_xact_lock(hashtext('remito_pv:' || v_pv));
    select coalesce(max(numero::int), 0) + 1 into v_remito_id_n from remitos where punto_venta = v_pv and numero ~ '^[0-9]{8}$';
    if v_remito_id_n > 99999999 then raise exception 'Se agotó la numeración del punto de venta %', v_pv; end if;
    v_numero := lpad(v_remito_id_n::text, 8, '0');
  else
    select * into v_auto from talonarios_autoimpresion where planta_id = v_planta_id and estado = 'activo' order by cai_vencimiento desc limit 1;
    select exists (select 1 from talonarios where planta_id = v_planta_id and estado = 'activo') into v_hay_pre;
    if v_auto.id is not null and not v_hay_pre then
      raise exception 'El CAI de autoimpresión (%) venció el %. Pedile al administrador que cargue el CAI nuevo.', v_auto.cai, to_char(v_auto.cai_vencimiento, 'DD/MM/YYYY');
    end if;
    v_auto := null;

    if coalesce(p_remito->>'punto_venta', '') <> v_pv then
      raise exception 'El punto de venta % no corresponde a tu planta (corresponde %)',
        coalesce(nullif(p_remito->>'punto_venta', ''), '(vacío)'), v_pv;
    end if;
    if v_numero !~ '^[0-9]{8}$' then
      raise exception 'El número de remito tiene que tener 8 dígitos';
    end if;
    -- Control de talonarios (solo si el administrador lo activó): rango, CAI vigente y orden de uso.
    v_tal := _validar_talonario(v_planta_id, v_numero::int);
  end if;

  -- El COT ya no es obligatorio al emitir: si falta, el remito queda como "COT pendiente"
  -- (cuando corresponde) y se carga después desde la pantalla COT.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El remito no tiene ítems';
  end if;
  if jsonb_array_length(p_items) > 15 then
    raise exception 'El remito admite hasta 15 ítems; dividilo en dos remitos';
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
      observaciones, usuario_id, usuario_nombre, talonario_id, cai, cai_vencimiento,
      cliente_provincia, cot, orden_carga, talonario_auto_id, digital, digital_por_nombre, digital_at
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
      _u(p_remito->>'observaciones'), v_uid, v_user.nombre,
      v_tal.id, coalesce(v_tal.cai, v_auto.cai), coalesce(v_tal.cai_vencimiento, v_auto.cai_vencimiento),
      nullif(v_prov, ''), nullif(v_cot, ''), _u(p_remito->>'orden_carga'),
      v_auto.id, v_auto.id is not null, case when v_auto.id is not null then v_user.nombre end, case when v_auto.id is not null then now() end
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
    v_prec := _u(v_item->>'precinto');
    v_lote := null;

    if v_cant is null or v_cant <= 0 then
      raise exception 'Ítem %: la cantidad tiene que ser mayor a cero', v_i;
    end if;
    if v_desc is null then
      raise exception 'Ítem %: falta la descripción', v_i;
    end if;

    if nullif(v_item->>'lote_id', '') is not null then
      -- Solo las semillas llevan precinto obligatorio; insumos y ensamblajes no.
      -- El maíz en bolsas no lleva precinto.
      select case when p.categoria = 'maiz' then 'maiz' else coalesce(p.grupo, 'semilla') end into v_grupo
      from lotes l join productos p on p.id = l.producto_id
      where l.id = (v_item->>'lote_id')::uuid;
      if v_prec is null and coalesce(v_grupo, 'semilla') = 'semilla' then
        raise exception 'Ítem %: falta el precinto con el que se despacha', v_i;
      end if;
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
      (remito_id, orden, producto_id, lote_id, lote_texto, precinto, descripcion, cantidad, kg_unidad, kg_total)
    values (
      v_remito_id, v_i,
      coalesce(v_lote.producto_id, nullif(v_item->>'producto_id', '')::uuid),
      v_lote.id, v_lote.lote, v_prec, v_desc, v_cant, v_kgu,
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

  if v_tal.id is not null then perform _actualizar_estado_talonario(v_tal.id); end if;

  return v_remito_id;
end;
$$;
revoke execute on function public._emitir_remito_base45(jsonb, jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
