-- Operadores: no pueden cargar stock ni sumar ajustes positivos (solo admin).
-- Reciben stock por traslados (confirmar_traslado) o por carga del admin.
create or replace function public.cargar_stock(
  p_producto_id uuid,
  p_lote text,
  p_cantidad numeric,
  p_planta_id uuid default null,
  p_motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_planta uuid;
  v_lote text := upper(trim(coalesce(p_lote, '')));
  v_lote_id uuid;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;
  if v_user.rol <> 'admin' then
    raise exception 'Solo el administrador puede cargar stock. Tu planta recibe stock por traslados.';
  end if;

  v_planta := case when v_user.rol = 'admin' and p_planta_id is not null
                   then p_planta_id else v_user.planta_id end;
  if v_planta is null then raise exception 'Tu usuario no tiene una planta asignada'; end if;
  if v_lote = '' then raise exception 'Falta el número de lote'; end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor a cero';
  end if;
  if not exists (select 1 from productos where id = p_producto_id and activo) then
    raise exception 'El producto no existe o está inactivo';
  end if;

  insert into lotes (planta_id, producto_id, lote)
  values (v_planta, p_producto_id, v_lote)
  on conflict (planta_id, producto_id, lote) do nothing;

  select id into v_lote_id from lotes
  where planta_id = v_planta and producto_id = p_producto_id and lote = v_lote
  for update;

  update lotes set stock = stock + p_cantidad, activo = true
  where id = v_lote_id
  returning stock into v_stock;

  insert into movimientos_stock (lote_id, tipo, cantidad, stock_resultante, motivo, usuario_id, usuario_nombre)
  values (v_lote_id, 'ingreso', p_cantidad, v_stock, nullif(trim(p_motivo), ''), v_uid, v_user.nombre);

  return v_lote_id;
end;
$$;

create or replace function public.ajustar_stock(
  p_lote_id uuid,
  p_delta numeric,
  p_motivo text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user profiles%rowtype;
  v_lote lotes%rowtype;
  v_stock numeric;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  select * into v_user from profiles where id = v_uid and activo;
  if not found then raise exception 'Usuario no habilitado'; end if;
  if v_user.rol <> 'admin' and p_delta > 0 then
    raise exception 'Solo el administrador puede sumar stock. Podés registrar bajas (mermas, roturas) con cantidad negativa.';
  end if;

  if p_delta is null or p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Indicá el motivo del ajuste';
  end if;

  select * into v_lote from lotes where id = p_lote_id for update;
  if not found then raise exception 'El lote no existe'; end if;
  if v_user.rol <> 'admin' and v_lote.planta_id is distinct from v_user.planta_id then
    raise exception 'No podés ajustar lotes de otra planta';
  end if;
  if v_lote.stock + p_delta < 0 then
    raise exception 'El ajuste dejaría el lote % con stock negativo (hay %)', v_lote.lote, v_lote.stock;
  end if;

  update lotes set stock = stock + p_delta where id = p_lote_id returning stock into v_stock;

  insert into movimientos_stock (lote_id, tipo, cantidad, stock_resultante, motivo, usuario_id, usuario_nombre)
  values (p_lote_id, 'ajuste', p_delta, v_stock, trim(p_motivo), v_uid, v_user.nombre);

  return v_stock;
end;
$$;

notify pgrst, 'reload schema';
