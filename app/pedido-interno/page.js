"use client";
// Nuevo pedido interno (o editar uno: ?id=). Solicitante (su área), Administración y Logística (eligen el área).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import BuscadorSelect from "@/components/BuscadorSelect";
import { supabase } from "@/lib/supabaseClient";
import { friendlyError, hoyISO, PROVINCIAS } from "@/lib/util";
import { TIPOS_LUGAR, LISTAS_CONTABLES, tipoLugarLabel } from "@/lib/pedidosInternos";

export default function PedidoInternoPage() {
  return <AuthGuard roles={["solicitante", "admin", "logistica"]}>{(profile) => <Formulario profile={profile} />}</AuthGuard>;
}

const inp = "w-full border border-stone-300 rounded-md px-3 py-2 text-[15px] sm:text-sm bg-white";
const lab = "block text-[12px] font-medium text-stone-600 mb-1";
const vacioPunto = { ref: "", contacto: "", telefono: "" };
const refDe = (planta, lugar) => (planta ? `p:${planta}` : lugar ? `l:${lugar}` : "");

function Formulario({ profile }) {
  const router = useRouter();
  const [editId] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("id") : null));
  const esLog = profile.rol === "admin" || profile.rol === "logistica";
  const [plantas, setPlantas] = useState([]);
  const [lugares, setLugares] = useState([]);
  const [areas, setAreas] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [listas, setListas] = useState([]);
  const [f, setF] = useState({ fecha_carga: "", hora: "", area_id: "", camiones: 1, tipo_carga_id: "", kg: "", bolsas: "", pallets: "", comentarios: "", departamento_id: "", clase_id: "", subsidiaria_id: "", cuenta_id: "", categoria_id: "" });
  const [carga, setCarga] = useState(vacioPunto);
  const [descarga, setDescarga] = useState(vacioPunto);
  const [paradas, setParadas] = useState([]);
  const [nuevoLugar, setNuevoLugar] = useState(null); // { para: "carga"|"descarga"|índice de parada, ...datos }
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [numero, setNumero] = useState("");

  const cargarLugares = () => supabase.from("lugares").select("*").eq("activo", true).order("nombre").then(({ data }) => setLugares(data || []));
  useEffect(() => {
    supabase.from("plantas").select("id, nombre, domicilio, provincia, gps, contacto_nombre, contacto_telefono, horario_atencion, activa").eq("activa", true).order("nombre").then(({ data }) => setPlantas(data || []));
    cargarLugares();
    supabase.from("areas").select("id, nombre").eq("activa", true).order("nombre").then(({ data }) => setAreas(data || []));
    supabase.from("tipos_carga").select("id, nombre").eq("activo", true).order("nombre").then(({ data }) => setTipos(data || []));
    supabase.from("listas_contables").select("id, lista, nombre").eq("activo", true).order("nombre").then(({ data }) => setListas(data || []));
  }, []);

  // Editar: trae el pedido
  useEffect(() => {
    if (!editId) return;
    supabase.rpc("pedidos_internos_lista", { p_desde: "2000-01-01" }).then(({ data, error: e }) => {
      if (e) return setError(friendlyError(e));
      const x = (data || []).find((y) => y.id === editId);
      if (!x) return setError("No encontré el pedido.");
      if (!x.editable) setError(profile.rol === "solicitante" ? "Este pedido ya fue asignado a un transporte: los cambios pedíselos a Logística." : "El pedido está cancelado o finalizado.");
      setNumero(x.numero);
      setF({ fecha_carga: x.fecha_carga || "", hora: x.hora || "", area_id: x.area_id || "", camiones: 1, tipo_carga_id: x.tipo_carga_id || "", kg: x.kg ?? "", bolsas: x.bolsas ?? "", pallets: x.pallets ?? "", comentarios: x.comentarios || "",
        departamento_id: x.departamento_id || "", clase_id: x.clase_id || "", subsidiaria_id: x.subsidiaria_id || "", cuenta_id: x.cuenta_id || "", categoria_id: x.categoria_id || "" });
      setCarga({ ref: refDe(x.carga_planta_id, x.carga_lugar_id), contacto: x.carga_contacto || "", telefono: x.carga_telefono || "" });
      setDescarga({ ref: refDe(x.descarga_planta_id, x.descarga_lugar_id), contacto: x.descarga_contacto || "", telefono: x.descarga_telefono || "" });
      setParadas((x.paradas_ids || []).map((p) => ({ ref: refDe(p.planta_id, p.lugar_id), contacto: p.contacto || "", telefono: p.telefono || "" })));
    });
  }, [editId, profile.rol]);

  const opciones = useMemo(() => [
    ...plantas.map((p) => ({ value: `p:${p.id}`, label: String(p.nombre).split("|")[0].trim(), sub: `Planta · ${String(p.nombre).split("|")[1]?.trim() || p.provincia || ""}`, buscar: p.nombre })),
    ...lugares.map((l) => ({ value: `l:${l.id}`, label: l.nombre, sub: `${tipoLugarLabel(l.tipo)} · ${[l.localidad, l.provincia].filter(Boolean).join(", ")}`, buscar: `${l.domicilio || ""} ${l.localidad || ""}` })),
  ], [plantas, lugares]);
  const datoDe = (ref) => {
    if (!ref) return null;
    const id = ref.slice(2);
    if (ref[0] === "p") { const p = plantas.find((x) => x.id === id); return p && { contacto: p.contacto_nombre, telefono: p.contacto_telefono, gps: p.gps, horario: p.horario_atencion, domicilio: p.domicilio }; }
    const l = lugares.find((x) => x.id === id); return l && { contacto: l.contacto, telefono: l.telefono, gps: l.gps, horario: l.horario, domicilio: [l.domicilio, l.localidad].filter(Boolean).join(" - ") };
  };
  const aIds = (pt) => ({ planta_id: pt.ref[0] === "p" ? pt.ref.slice(2) : null, lugar_id: pt.ref[0] === "l" ? pt.ref.slice(2) : null });

  const guardarLugar = async () => {
    setError("");
    const { para, ...datos } = nuevoLugar;
    const { data, error: e } = await supabase.rpc("crear_lugar", { p: datos });
    if (e) return setError(friendlyError(e));
    await cargarLugares();
    const ref = `l:${data}`;
    if (para === "carga") setCarga({ ...carga, ref }); else if (para === "descarga") setDescarga({ ...descarga, ref });
    else setParadas(paradas.map((p, i) => (i === para ? { ...p, ref } : p)));
    setNuevoLugar(null);
  };

  const guardar = async () => {
    setError("");
    const c = aIds(carga), d = aIds(descarga);
    const p = {
      ...f, camiones: Number(f.camiones || 1),
      carga_planta_id: c.planta_id, carga_lugar_id: c.lugar_id, carga_contacto: carga.contacto, carga_telefono: carga.telefono,
      descarga_planta_id: d.planta_id, descarga_lugar_id: d.lugar_id, descarga_contacto: descarga.contacto, descarga_telefono: descarga.telefono,
      paradas: paradas.filter((x) => x.ref).map((x) => ({ ...aIds(x), contacto: x.contacto, telefono: x.telefono })),
    };
    if (!esLog) delete p.area_id;
    setGuardando(true);
    const { data, error: e } = editId ? await supabase.rpc("editar_pedido_interno", { p_id: editId, p }) : await supabase.rpc("crear_pedido_interno", { p });
    setGuardando(false);
    if (e) return setError(friendlyError(e));
    const nums = editId ? numero : (data || []).join(", ");
    router.push(esLog ? `/pedidos?tipo=interno&ok=${encodeURIComponent(nums)}` : `/solicitudes?ok=${encodeURIComponent(nums)}`);
  };

  // (función, no componente: así los campos no pierden el foco al escribir)
  const punto = ({ key, titulo, pt, set, para, quitar }) => {
    const d = datoDe(pt.ref);
    return (
      <div key={key} className="rounded-md border border-stone-200 bg-white p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-stone-800">{titulo}</span>
          {quitar && <button type="button" onClick={quitar} className="ml-auto text-[12px] text-stone-500 underline">Quitar parada</button>}
        </div>
        <BuscadorSelect value={pt.ref} onChange={(v) => (v === "__nuevo" ? setNuevoLugar({ para, nombre: "", tipo: "campo", domicilio: "", localidad: "", provincia: "", gps: "", contacto: "", telefono: "", horario: "" }) : set({ ...pt, ref: v }))} options={opciones} className={inp} placeholder="Buscar planta o lugar (nombre, localidad)…"
          extras={[{ value: "__nuevo", label: "+ No está en la lista: crear un lugar nuevo", alFinal: true }]} />
        {d && (
          <div className="text-[12px] text-stone-500">
            {d.domicilio && <div>{d.domicilio}</div>}
            {d.horario && <div>Horario: {d.horario}</div>}
            {!d.gps && <div className="text-amber-700">Este lugar no tiene ubicación de Maps (no entra en el cálculo de km).</div>}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div><label className={lab}>Contacto</label><input value={pt.contacto} onChange={(e) => set({ ...pt, contacto: e.target.value })} placeholder={d?.contacto || "Nombre"} className={inp} /></div>
          <div><label className={lab}>Teléfono</label><input value={pt.telefono} onChange={(e) => set({ ...pt, telefono: e.target.value })} placeholder={d?.telefono || ""} className={inp} /></div>
        </div>
        {d?.contacto && !pt.contacto && <div className="text-[11.5px] text-stone-400">Si lo dejás vacío va el contacto cargado del lugar.</div>}
      </div>
    );
  };
  const lista = (k) => listas.filter((x) => x.lista === k);

  return (
    <NavBar profile={profile}>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-4">
        <header>
          <h1 className="text-[20px] sm:text-[22px] font-semibold text-stone-900">{editId ? `Modificar pedido ${numero}` : "Nuevo pedido de unidad"}</h1>
          <p className="text-stone-500 text-[13px]">Movimientos internos (no entregas a clientes). Logística lo confirma y lo asigna a un transporte; lo seguís en “Mis pedidos”.</p>
        </header>

        <section className="panel p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={lab}>Fecha de carga *</label><input type="date" min={editId ? undefined : hoyISO()} value={f.fecha_carga} onChange={(e) => setF({ ...f, fecha_carga: e.target.value })} className={inp} /></div>
            <div><label className={lab}>Hora (opcional)</label><input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} className={inp} /></div>
            {esLog ? (
              <div><label className={lab}>Área que pide *</label>
                <select value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })} className={inp}>
                  <option value="">Elegir…</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
            ) : !profile.area_id ? <div className="text-[12.5px] text-red-700 self-end">Tu usuario no tiene área asignada: pedile a Administración que te la asigne.</div> : null}
          </div>
        </section>

        <section className="space-y-2">
          {punto({ key: "c", titulo: "Carga *", pt: carga, set: setCarga, para: "carga" })}
          {paradas.map((p, i) => punto({ key: `p${i}`, titulo: `Parada intermedia ${i + 1}`, pt: p, set: (v) => setParadas(paradas.map((x, j) => (j === i ? v : x))), para: i, quitar: () => setParadas(paradas.filter((_, j) => j !== i)) }))}
          <button type="button" onClick={() => setParadas([...paradas, { ...vacioPunto }])} className="text-[13px] text-sky-700 underline">+ Agregar parada intermedia</button>
          {punto({ key: "d", titulo: "Descarga *", pt: descarga, set: setDescarga, para: "descarga" })}
        </section>

        {nuevoLugar && (
          <section className="panel p-4 space-y-3 border-sky-300">
            <div className="font-semibold text-[14px]">Lugar nuevo</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={lab}>Nombre *</label><input value={nuevoLugar.nombre} onChange={(e) => setNuevoLugar({ ...nuevoLugar, nombre: e.target.value.toUpperCase() })} className={inp} /></div>
              <div><label className={lab}>Tipo</label><select value={nuevoLugar.tipo} onChange={(e) => setNuevoLugar({ ...nuevoLugar, tipo: e.target.value })} className={inp}>{TIPOS_LUGAR.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
              <div><label className={lab}>Dirección</label><input value={nuevoLugar.domicilio} onChange={(e) => setNuevoLugar({ ...nuevoLugar, domicilio: e.target.value.toUpperCase() })} placeholder="Ruta, km, calle…" className={inp} /></div>
              <div><label className={lab}>Localidad *</label><input value={nuevoLugar.localidad} onChange={(e) => setNuevoLugar({ ...nuevoLugar, localidad: e.target.value.toUpperCase() })} className={inp} /></div>
              <div><label className={lab}>Provincia</label><select value={nuevoLugar.provincia} onChange={(e) => setNuevoLugar({ ...nuevoLugar, provincia: e.target.value })} className={inp}><option value="">—</option>{PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              <div><label className={lab}>Ubicación (link de Google Maps)</label><input value={nuevoLugar.gps} onChange={(e) => setNuevoLugar({ ...nuevoLugar, gps: e.target.value })} placeholder="https://maps.app.goo.gl/…" className={inp} /></div>
              <div><label className={lab}>Contacto</label><input value={nuevoLugar.contacto} onChange={(e) => setNuevoLugar({ ...nuevoLugar, contacto: e.target.value })} className={inp} /></div>
              <div><label className={lab}>Teléfono</label><input value={nuevoLugar.telefono} onChange={(e) => setNuevoLugar({ ...nuevoLugar, telefono: e.target.value })} className={inp} /></div>
              <div className="sm:col-span-2"><label className={lab}>Horario</label><input value={nuevoLugar.horario} onChange={(e) => setNuevoLugar({ ...nuevoLugar, horario: e.target.value })} placeholder="Ej.: lunes a viernes de 8 a 17" className={inp} /></div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={guardarLugar} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-[14px]">Guardar lugar</button>
              <button type="button" onClick={() => setNuevoLugar(null)} className="px-3 py-2 text-[14px] text-stone-500">Cancelar</button>
            </div>
          </section>
        )}

        <section className="panel p-4 space-y-3">
          <div className="text-[13px] font-semibold text-stone-800">Carga</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><label className={lab}>Tipo de carga *</label>
              <select value={f.tipo_carga_id} onChange={(e) => setF({ ...f, tipo_carga_id: e.target.value })} className={inp}>
                <option value="">Elegir…</option>{tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            {!editId && <div><label className={lab}>Cantidad de camiones</label><input type="number" min={1} max={30} value={f.camiones} onChange={(e) => setF({ ...f, camiones: e.target.value })} className={inp} /></div>}
            <div><label className={lab}>Kg</label><input inputMode="decimal" value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value.replace(/[^\d.,]/g, "") })} className={inp} /></div>
            <div><label className={lab}>Bolsas</label><input inputMode="numeric" value={f.bolsas} onChange={(e) => setF({ ...f, bolsas: e.target.value.replace(/\D/g, "") })} className={inp} /></div>
            <div><label className={lab}>Pallets</label><input inputMode="numeric" value={f.pallets} onChange={(e) => setF({ ...f, pallets: e.target.value.replace(/\D/g, "") })} className={inp} /></div>
            <div className="sm:col-span-3"><label className={lab}>Comentarios</label><textarea rows={2} value={f.comentarios} onChange={(e) => setF({ ...f, comentarios: e.target.value })} className={inp} /></div>
          </div>
          {Number(f.camiones) > 1 && <div className="text-[12.5px] text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1">Se van a crear {f.camiones} pedidos iguales (uno por camión).</div>}
        </section>

        <section className="panel p-4 space-y-3">
          <div className="text-[13px] font-semibold text-stone-800">Datos contables</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LISTAS_CONTABLES.map((l) => (
              <div key={l.value}><label className={lab}>{l.label}</label>
                <select value={f[`${l.value}_id`]} onChange={(e) => setF({ ...f, [`${l.value}_id`]: e.target.value })} className={inp}>
                  <option value="">—</option>{lista(l.value).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>

        {error && <div className="text-sm rounded p-3 border bg-red-50 border-red-200 text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button disabled={guardando} onClick={guardar} className="px-4 py-2.5 rounded-md bg-emerald-700 text-white text-[14px] font-medium disabled:opacity-60">{guardando ? "Guardando…" : editId ? "Guardar cambios" : "Enviar pedido"}</button>
          <button onClick={() => router.back()} className="px-4 py-2.5 text-[14px] text-stone-500">Volver</button>
        </div>
      </div>
    </NavBar>
  );
}
