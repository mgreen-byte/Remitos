-- =====================================================================
-- Migración 60: el punto de venta es por EMPRESA (como en ARCA: cada CUIT tiene los suyos)
--  * Dos plantas de distinta empresa pueden tener el mismo punto de venta (ej. MST 0021 y Stine 0021).
--    Dentro de una misma empresa sigue sin poder repetirse.
--  * Los remitos se numeran por empresa + punto de venta (remitos.serie = "empresa|PV"):
--    el 0021-00000001 de Stine y el 0021-00000001 de MS Technologies son remitos distintos.
--  * Se ajustan todas las funciones que buscaban remitos solo por punto de venta.
-- Requiere las migraciones 43 y 45. Correrla completa.
-- =====================================================================

-- 1) Serie de un remito: empresa de la planta + punto de venta
create or replace function public._serie(p_planta uuid, p_pv text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select empresa from plantas where id = p_planta), '?') || '|' || coalesce(p_pv, '')
$$;

alter table public.remitos add column if not exists serie text;
update public.remitos r set serie = public._serie(r.planta_id, r.punto_venta) where serie is distinct from public._serie(r.planta_id, r.punto_venta);

create or replace function public._remito_serie()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.serie := _serie(new.planta_id, new.punto_venta);
  return new;
end $$;
drop trigger if exists remitos_serie on public.remitos;
create trigger remitos_serie before insert or update of punto_venta, planta_id on public.remitos
  for each row execute function public._remito_serie();

-- 2) Unicidad: número por serie; punto de venta de la planta por empresa
alter table public.remitos drop constraint if exists remitos_punto_venta_numero_key;
create unique index if not exists remitos_serie_numero_key on public.remitos (serie, numero);
alter table public.plantas drop constraint if exists plantas_punto_venta_key;
create unique index if not exists plantas_empresa_pv_key on public.plantas (coalesce(empresa, ''), punto_venta);

-- 3) Funciones que buscaban remitos por punto de venta: pasan a buscar por serie
do $$
declare
  r record; v_def text; v_new text;
begin
  for r in select * from (values
    ('_corregir_numero_remito_base', 'where punto_venta = r.punto_venta and numero = v_num', 'where serie = r.serie and numero = v_num'),
    ('_disponibles', 'r.punto_venta = p.punto_venta', 'r.serie = _serie(p.id, p.punto_venta)'),
    ('_emitir_remito_base45', 'from remitos where punto_venta = v_pv and numero ~', 'from remitos where serie = _serie(v_planta_id, v_pv) and numero ~'),
    ('crear_talonario_auto', 'from talonarios_autoimpresion where punto_venta = v_pv and estado', 'from talonarios_autoimpresion where punto_venta = v_pv and _serie(planta_id, punto_venta) = _serie(p_planta, v_pv) and estado'),
    ('crear_talonario_auto', 'r.punto_venta = v_pv and r.talonario_auto_id', 'r.serie = _serie(p_planta, v_pv) and r.talonario_auto_id'),
    ('editar_talonario', 'where punto_venta = v_pv and numero between', 'where serie = _serie(t.planta_id, v_pv) and numero between'),
    ('info_autoimpresion', 'where punto_venta = t.punto_venta and numero ~', 'where serie = _serie(t.planta_id, t.punto_venta) and numero ~'),
    ('justificar_numeros', 'where punto_venta = v_pv and numero = _n8(n)', 'where serie = _serie(t.planta_id, v_pv) and numero = _n8(n)'),
    ('numeros_sin_justificar', 'where punto_venta = v_pv and numero between', 'where serie = _serie(t.planta_id, v_pv) and numero between'),
    ('numeros_sin_justificar', 'r.punto_venta = v_pv and r.numero', 'r.serie = _serie(t.planta_id, v_pv) and r.numero'),
    ('siguiente_numero', 'where punto_venta = v_pv and numero between', 'where serie = _serie(v_planta, v_pv) and numero between'),
    ('siguiente_numero', 'r.punto_venta = v_pv and r.numero', 'r.serie = _serie(v_planta, v_pv) and r.numero')
  ) as t(fn, de, a) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    if v_def is null then raise exception 'No encontré la función %', r.fn; end if;
    if position(r.a in v_def) > 0 then continue; end if; -- ya estaba cambiada
    if position(r.de in v_def) = 0 then raise exception 'La función % no tiene el texto esperado (%): avisale a Claude', r.fn, r.de; end if;
    v_new := replace(v_def, r.de, r.a);
    execute v_new;
  end loop;
end $$;

notify pgrst, 'reload schema';
