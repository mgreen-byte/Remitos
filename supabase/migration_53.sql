-- =====================================================================
-- Migración 53: choferes — CUIL repetido
--  * Al cargar o editar un chofer, se compara el CUIL solo por sus dígitos (con o sin guiones)
--    contra todos los choferes, incluidos los viejos cargados con guiones.
--  * Si ya existe, se bloquea y el mensaje dice a qué chofer está asignado.
--  * El CUIL nuevo se guarda siempre sin guiones.
-- =====================================================================
create or replace function public._chofer_cuil_unico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dig text := regexp_replace(coalesce(new.dni, ''), '\D', '', 'g'); v_otro choferes%rowtype;
begin
  if tg_op = 'UPDATE' and regexp_replace(coalesce(old.dni, ''), '\D', '', 'g') = v_dig then
    return new; -- no cambió el CUIL
  end if;
  new.dni := v_dig;
  select * into v_otro from choferes
  where regexp_replace(coalesce(dni, ''), '\D', '', 'g') = v_dig and id is distinct from new.id
  limit 1;
  if found then
    raise exception using errcode = 'unique_violation',
      message = format('El CUIL %s ya está cargado a nombre de %s%s.',
        substr(v_dig, 1, 2) || '-' || substr(v_dig, 3, 8) || '-' || substr(v_dig, 11, 1),
        v_otro.nombre,
        case when coalesce(v_otro.chasis, '') <> '' then ' (chasis ' || v_otro.chasis || ')' else '' end),
      hint = 'chofer_cuil_repetido:' || v_otro.id;
  end if;
  return new;
end $$;

drop trigger if exists choferes_cuil_unico on public.choferes;
create trigger choferes_cuil_unico before insert or update of dni on public.choferes
  for each row execute function public._chofer_cuil_unico();

-- Choferes que hoy comparten el mismo CUIL (para revisar y unificar a mano).
create or replace view public.v_choferes_cuil_repetido with (security_invoker = true) as
select regexp_replace(dni, '\D', '', 'g') as cuil, count(*) as cantidad, string_agg(nombre, ' · ' order by nombre) as choferes
from public.choferes
group by 1 having count(*) > 1;
grant select on public.v_choferes_cuil_repetido to authenticated;
notify pgrst, 'reload schema';
