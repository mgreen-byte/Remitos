-- Consulta: no ve los maestros de transportes y choferes (bloqueado en la base)
drop policy if exists "transportistas: lectura" on transportistas;
create policy "transportistas: lectura" on transportistas for select to authenticated
  using (not es_consulta());
drop policy if exists "choferes: lectura" on choferes;
create policy "choferes: lectura" on choferes for select to authenticated
  using (not es_consulta());
notify pgrst, 'reload schema';
