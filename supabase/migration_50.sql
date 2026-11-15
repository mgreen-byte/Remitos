-- =====================================================================
-- Migración 50: un usuario, varias plantas
--  * profiles.plantas_extra: plantas en las que el usuario puede trabajar (además de la actual).
--  * cambiar_mi_planta(): el usuario cambia su planta de trabajo entre las que tiene habilitadas.
--    Todo lo demás (permisos, stock, remitos, talonarios) sigue funcionando por la planta actual.
-- Caso de uso: un mismo depósito físico con dos plantas (soja = MS Technologies, maíz = Stine Seed).
-- =====================================================================
alter table public.profiles add column if not exists plantas_extra uuid[] not null default '{}';

create or replace function public.cambiar_mi_planta(p_planta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user profiles%rowtype;
begin
  v_user := _usuario_activo();
  if p_planta is null then raise exception 'Elegí una planta'; end if;
  if p_planta = v_user.planta_id then return; end if;
  if not (p_planta = any(coalesce(v_user.plantas_extra, '{}'))) then
    raise exception 'No tenés habilitada esa planta. Pedile al administrador que te la agregue.';
  end if;
  if not exists (select 1 from plantas where id = p_planta and activa) then raise exception 'La planta no está activa'; end if;
  update profiles
  set planta_id = p_planta,
      -- la planta anterior queda en la lista, para poder volver
      plantas_extra = case when v_user.planta_id is not null and not (v_user.planta_id = any(coalesce(plantas_extra, '{}')))
                           then array_append(coalesce(plantas_extra, '{}'), v_user.planta_id) else plantas_extra end
  where id = v_user.id;
end $$;
revoke execute on function public.cambiar_mi_planta(uuid) from public, anon;
grant execute on function public.cambiar_mi_planta(uuid) to authenticated;
notify pgrst, 'reload schema';
