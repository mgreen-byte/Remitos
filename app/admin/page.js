"use client";

import { confirmar } from "@/lib/confirmar";
import { useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import CrudTable from "@/components/CrudTable";
import ExportarTodo from "@/components/ExportarTodo";
import { supabase } from "@/lib/supabaseClient";
import { MODALIDADES, IVA_DEFAULT, EMPRESAS_DEFAULT, EMPRESAS_ETIQUETA } from "@/lib/fieldCoords";
import { PROVINCIAS, fmtFecha, hoyISO, friendlyError, fmtMonto } from "@/lib/util";
import { TIPOS_LUGAR, LISTAS_CONTABLES } from "@/lib/pedidosInternos";

const TABS = [
  ["plantas", "Plantas"],
  ["usuarios", "Usuarios"],
  ["catalogo", "Catálogo"],
  ["destinatarios", "Destinatarios"],
  ["prefijos", "Prefijos de precinto"],
  ["precios", "Precios"],
  ["config", "Configuración"],
  ["areas", "Áreas"],
  ["lugares", "Lugares"],
  ["tipos_carga", "Tipos de carga"],
  ["contables", "Listas contables"],
  ["respaldo", "Respaldo"],
];

export default function AdminPage() {
  return <AuthGuard roles={["admin", "logistica"]}>{(profile) => <AdminInner profile={profile} />}</AuthGuard>;
}

function AdminInner({ profile }) {
  const esLogistica = profile.rol === "logistica"; // Catálogo, Respaldo y los maestros de pedidos internos
  const tabs = esLogistica ? TABS.filter(([id]) => ["catalogo", "respaldo", "areas", "lugares", "tipos_carga", "contables"].includes(id)) : TABS;
  const [areas, setAreas] = useState([]);
  const [tab, setTab] = useState(esLogistica ? "catalogo" : "plantas");
  const [plantas, setPlantas] = useState([]);
  const [transportes, setTransportes] = useState([]);

  useEffect(() => {
    supabase.from("plantas").select("id, nombre").order("nombre").then(({ data }) => setPlantas(data || []));
    supabase.from("areas").select("id, nombre").order("nombre").then(({ data }) => setAreas(data || []));
    supabase.from("transportistas").select("id, nombre, portal").order("nombre").then(({ data }) => setTransportes((data || []).sort((a, b) => Number(b.portal) - Number(a.portal) || a.nombre.localeCompare(b.nombre))));
  }, [tab]);

  return (
    <NavBar profile={profile}>
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-4">
        <div className="flex gap-1 flex-wrap">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded text-sm font-medium border ${tab === id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "plantas" && (
          <CrudTable
            key="plantas"
            table="plantas"
            orderBy="nombre"
            help="Cada planta tiene su propio punto de venta (4 dígitos) y es el que se usa en sus remitos. No se puede repetir. La empresa es la del formulario en el que imprime la planta: en un traslado entre depósitos, el destinatario es siempre esa empresa."
            columns={[
              { key: "nombre", label: "Planta", type: "text", upper: true },
              { key: "punto_venta", label: "Punto de venta", type: "text", digits: 4, placeholder: "0001" },
              { key: "prefijo", label: "Prefijo (órdenes de traslado)", type: "text", upper: true, placeholder: "STA" },
              { key: "nombre_sistema", label: "Nombre en sistema contable", type: "text", placeholder: "Como figura el depósito en el sistema" },
              { key: "contacto_nombre", label: "Contacto del depósito", type: "text", placeholder: "Nombre" },
              { key: "contacto_telefono", label: "Teléfono de contacto", type: "text", placeholder: "Ej.: 3462 123456" },
              { key: "horario_atencion", label: "Horario de atención", type: "text", placeholder: "Ej.: Lunes a viernes de 8 a 17" },
              { key: "correos_aviso", label: "Correos para avisos de órdenes", type: "text", placeholder: "deposito@... , encargado@... (separados por coma)" },
              { key: "domicilio", label: "Domicilio (para traslados)", type: "text", upper: true },
              { key: "domicilio_fiscal", label: "Dirección fiscal (encabezado del remito PDF)", type: "text", placeholder: "Calle y N° | (CP) Localidad | Provincia" },
              { key: "gps", label: "Ubicación (link de Maps, QR de traslados)", type: "text", nullable: true, placeholder: "https://maps.app.goo.gl/… (opcional)" },
              { key: "provincia", label: "Provincia", type: "select", nullable: true, options: PROVINCIAS.map((p) => ({ value: p, label: p })) },
              { key: "empresa", label: "Empresa (formulario)", type: "select", nullable: true, options: Object.entries(EMPRESAS_ETIQUETA).map(([value, label]) => ({ value, label })) },
              { key: "despacha", label: "Despacha", type: "select", options: [{ value: "ambos", label: "Soja y maíz" }, { value: "soja", label: "Solo soja" }, { value: "maiz", label: "Solo maíz" }] },
              { key: "activa", label: "Activa", type: "bool" },
            ]}
          />
        )}

        {tab === "usuarios" && (
          <CrudTable
            key="usuarios"
            table="profiles"
            orderBy="nombre"
            canAdd={false}
            help={
              <>
                Para crear un usuario nuevo: Supabase → Authentication → Users → Add user (con “Auto Confirm User”). Después aparece acá y le asignás planta y permisos.
                Despacho de planta: emite remitos y trabaja en su planta. Solo vista: ve todas las plantas y descarga a Excel, pero no reimprime ni modifica nada (no necesita planta). Solicitante: usuario de otra área que pide unidades (movimientos internos); elegí su Área. Ve “Nuevo pedido” y los pedidos de su área. Transportista (portal): usuario de una empresa de transporte; solo ve “Mis pedidos” (tildá el transporte o los transportes que maneja). Administrador: todo. “Otras plantas habilitadas”: si un usuario de despacho trabaja en más de una planta (por ejemplo, el mismo depósito con soja de MS Technologies y maíz de Stine), tildalas acá y va a poder cambiar de planta desde el menú.
              </>
            }
            columns={[
              { key: "nombre", label: "Nombre", type: "text", upper: true },
              { key: "rol", label: "Rol", type: "select", options: [{ value: "operador", label: "Despacho de planta" }, { value: "consulta", label: "Solo vista" }, { value: "logistica", label: "Logística" }, { value: "admin", label: "Administrador" }, { value: "transportista", label: "Transportista (portal)" }, { value: "solicitante", label: "Solicitante (pide unidades)" }] },
              { key: "area_id", label: "Área (solo rol Solicitante)", type: "select", nullable: true, options: areas.map((a) => ({ value: a.id, label: a.nombre })) },
              { key: "transportistas_ids", label: "Transportes (solo rol Transportista)", type: "multi", options: (transportes.some((t) => t.portal) ? transportes.filter((t) => t.portal) : transportes).map((t) => ({ value: t.id, label: t.nombre })) },
              { key: "planta_id", label: "Planta", type: "select", nullable: true, options: plantas.map((p) => ({ value: p.id, label: p.nombre })) },
              { key: "plantas_extra", label: "Otras plantas habilitadas", type: "multi", options: plantas.map((p) => ({ value: p.id, label: p.nombre })) },
              { key: "modalidades", label: "Modalidades", type: "multi", options: MODALIDADES.map((m) => ({ value: m.id, label: m.label })) },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "catalogo" && (
          <CrudTable
            key="catalogo"
            table="productos"
            orderBy="nombre"
            canDelete
            multiDelete={!esLogistica}
            deleteRpc="eliminar_productos"
            importarCatalogo
            nuevoDefault={{ categoria: "soja", grupo: "semilla" }}
            help="Todo lo que se remite: semillas, insumos y ensamblajes. Para insumos y ensamblajes elegí Categoría “Otro” y completá el Grupo. Podés editar o eliminar un producto; si ya tiene lotes cargados no se puede eliminar: desactivalo en “Activo”. Variedades/híbridos y su presentación. Los kg por unidad se usan para calcular el peso del remito (ej. Big Bag 800 / 1000 / 1089 kg: cargá una fila por cada presentación). En “Alias” poné otros nombres con los que viene el producto en el Excel de la OC, separados por coma, para que se reconozca solo."
            columns={[
              { key: "grupo", label: "Grupo", type: "select", options: [{ value: "semilla", label: "Semilla" }, { value: "insumo", label: "Insumo" }, { value: "ensamblaje", label: "Ensamblaje" }] },
              { key: "categoria", label: "Categoría", type: "select", options: [{ value: "soja", label: "Soja" }, { value: "maiz", label: "Maíz" }, { value: "otro", label: "Otro" }] },
              { key: "nombre", label: "Nombre (variedad / insumo / ensamblaje)", type: "text", upper: true },
              { key: "presentacion", label: "Presentación", type: "text", upper: true, placeholder: "BIG BAG 1000 KG" },
              { key: "kg_por_unidad", label: "Kg por unidad", type: "number" },
              { key: "por_pallets", label: "Por pallets", type: "bool" },
              { key: "alias", label: "Alias (Excel)", type: "list", placeholder: "nombre 1, nombre 2" },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "destinatarios" && (
          <CrudTable
            key="destinatarios"
            table="destinatarios"
            orderBy="nombre"
            canDelete
            help="Destinatarios guardados: al escribir el nombre en un remito, se completan solos el CUIT, el domicilio y la condición de IVA. También se agregan desde la pantalla de remitos con el tilde “Guardar para próximos remitos”. Solo el administrador los edita."
            columns={[
              { key: "nombre", label: "Nombre o razón social", type: "text", upper: true },
              { key: "cuit", label: "CUIT", type: "text" },
              { key: "domicilio", label: "Domicilio", type: "text", upper: true },
              { key: "iva", label: "Condición de IVA", type: "select", nullable: true, options: IVA_DEFAULT.map((x) => ({ value: x, label: x })) },
              { key: "activo", label: "Activo", type: "bool" },
            ]}
          />
        )}

        {tab === "prefijos" && <Prefijos />}

        {tab === "precios" && <Precios profile={profile} />}

        {tab === "config" && <Config />}

        {tab === "respaldo" && <ExportarTodo />}

        {tab === "areas" && (
          <CrudTable key="areas" table="areas" orderBy="nombre" canDelete
            help="Áreas que piden unidades (pedidos internos). Cada usuario Solicitante tiene su área y ve los pedidos de su área. Si un área ya tiene pedidos, desactivala en vez de borrarla."
            columns={[{ key: "nombre", label: "Área", type: "text", upper: true }, { key: "activa", label: "Activa", type: "bool" }]} />
        )}
        {tab === "lugares" && (
          <CrudTable key="lugares" table="lugares" orderBy="nombre" canDelete
            help="Lugares de carga y descarga que no son plantas (campos, depósitos de terceros, oficinas, proveedores). Las plantas aparecen solas en el pedido. Los solicitantes también pueden crear lugares desde el pedido."
            columns={[
              { key: "nombre", label: "Nombre", type: "text", upper: true },
              { key: "tipo", label: "Tipo", type: "select", options: TIPOS_LUGAR },
              { key: "domicilio", label: "Dirección", type: "text", upper: true, nullable: true },
              { key: "localidad", label: "Localidad", type: "text", upper: true },
              { key: "provincia", label: "Provincia", type: "select", nullable: true, options: PROVINCIAS.map((p) => ({ value: p, label: p })) },
              { key: "gps", label: "Ubicación (link de Maps)", type: "text", nullable: true, placeholder: "https://maps.app.goo.gl/…" },
              { key: "contacto", label: "Contacto", type: "text", nullable: true },
              { key: "telefono", label: "Teléfono", type: "text", nullable: true },
              { key: "horario", label: "Horario", type: "text", nullable: true },
              { key: "activo", label: "Activo", type: "bool" },
            ]} />
        )}
        {tab === "tipos_carga" && (
          <CrudTable key="tipos_carga" table="tipos_carga" orderBy="nombre" canDelete
            help="Lista de tipos de carga para los pedidos internos (por ejemplo: bolsas vacías, insumos, equipos)."
            columns={[{ key: "nombre", label: "Tipo de carga", type: "text", upper: true }, { key: "activo", label: "Activo", type: "bool" }]} />
        )}
        {tab === "contables" && (
          <CrudTable key="contables" table="listas_contables" orderBy="nombre" canDelete
            help="Opciones de Departamento, Clase, Subsidiaria y Cuenta para los pedidos internos. Cargá una fila por opción y elegí a qué lista pertenece."
            columns={[{ key: "lista", label: "Lista", type: "select", options: LISTAS_CONTABLES }, { key: "nombre", label: "Opción", type: "text", upper: true }, { key: "activo", label: "Activo", type: "bool" }]} />
        )}
      </div>
    </NavBar>
  );
}

function Config() {
  const [ccAviso, setCcAviso] = useState("");
  const [msgCc, setMsgCc] = useState("");
  useEffect(() => {
    supabase.from("configuracion").select("valor").eq("clave", "aviso_ordenes").maybeSingle().then(({ data }) => setCcAviso(data?.valor?.cc || ""));
  }, []);
  const guardarCc = async () => {
    const lista = ccAviso.split(/[;,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const mal = lista.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (mal) return setMsgCc(`“${mal}” no parece un correo.`);
    const { error } = await supabase.from("configuracion").upsert({ clave: "aviso_ordenes", valor: { cc: lista.join(", ") } });
    setMsgCc(error ? error.message : "Guardado.");
    if (!error) setCcAviso(lista.join(", "));
  };
  const [iva, setIva] = useState(IVA_DEFAULT.join("\n"));
  const [empresas, setEmpresas] = useState(EMPRESAS_DEFAULT);
  const [msg, setMsg] = useState("");
  const [msgEmp, setMsgEmp] = useState("");
  useEffect(() => {
    supabase.from("configuracion").select("*").in("clave", ["iva_options", "empresas"]).then(({ data }) => {
      const i = data?.find((x) => x.clave === "iva_options");
      const e = data?.find((x) => x.clave === "empresas");
      if (i?.valor) setIva(i.valor.join("\n"));
      if (e?.valor) setEmpresas({ ...EMPRESAS_DEFAULT, ...e.valor });
    });
  }, []);
  const guardar = async () => {
    const valor = iva.split("\n").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const { error } = await supabase.from("configuracion").upsert({ clave: "iva_options", valor });
    setMsg(error ? error.message : "Guardado.");
  };
  const setEmp = (k, campo, v) => setEmpresas((e) => ({ ...e, [k]: { ...e[k], [campo]: v } }));
  const guardarEmpresas = async () => {
    for (const [k, e] of Object.entries(empresas)) {
      if (!String(e.nombre || "").trim()) return setMsgEmp(`Falta el nombre de ${EMPRESAS_ETIQUETA[k] || k}.`);
      if (String(e.cuit || "").replace(/\D/g, "").length !== 11) return setMsgEmp(`El CUIT de ${EMPRESAS_ETIQUETA[k] || k} tiene que tener 11 dígitos.`);
    }
    const valor = Object.fromEntries(Object.entries(empresas).map(([k, e]) => [k, { nombre: String(e.nombre).trim().toUpperCase(), cuit: String(e.cuit).replace(/\D/g, ""), iva: e.iva || IVA_DEFAULT[0] }]));
    const { error } = await supabase.from("configuracion").upsert({ clave: "empresas", valor });
    setMsgEmp(error ? error.message : "Guardado.");
  };
  return (
    <div className="space-y-4">
    <div className="panel p-4 space-y-2 max-w-md">
      <h2 className="paso-titulo">Avisos de órdenes por correo</h2>
      <p className="text-[13px] text-stone-500">Copia fija (CC) de cada aviso de orden de carga a los depósitos. Los correos de cada depósito se cargan en Plantas.</p>
      <input value={ccAviso} onChange={(e) => setCcAviso(e.target.value)} placeholder="logistica@... (varios, separados por coma)" className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
      <div className="flex items-center gap-3">
        <button onClick={guardarCc} className="btn-primario">Guardar</button>
        {msgCc && <span className="text-[13px] text-stone-600">{msgCc}</span>}
      </div>
    </div>
    <div className="panel p-4 space-y-2 max-w-md">
      <div className="text-xs font-semibold text-stone-500 uppercase">Condiciones de IVA (una por línea)</div>
      <textarea value={iva} onChange={(e) => setIva(e.target.value)} rows={6} className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm uppercase" />
      <button onClick={guardar} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">
        Guardar
      </button>
      {msg && <span className="text-xs text-stone-500 ml-2">{msg}</span>}
      <div className="text-xs text-stone-400 pt-2">La calibración de impresión predeterminada se guarda desde la pantalla “Generar remito”.</div>
    </div>
    <div className="panel p-4 space-y-3 max-w-xl">
      <div>
        <div className="text-xs font-semibold text-stone-500 uppercase">Empresas (destinatario de los traslados entre depósitos)</div>
        <p className="text-[12.5px] text-stone-500 mt-1">En un traslado, el destinatario es siempre la empresa de la planta de origen (se asigna en Plantas → Empresa).</p>
      </div>
      {Object.entries(empresas).map(([k, e]) => (
        <div key={k} className="grid gap-2 md:grid-cols-3 border-t border-stone-100 pt-3">
          <div className="md:col-span-3 text-[13px] font-medium">{EMPRESAS_ETIQUETA[k] || k}</div>
          <label className="md:col-span-2 text-[12px] text-stone-500">Razón social
            <input value={e.nombre || ""} onChange={(ev) => setEmp(k, "nombre", ev.target.value.toUpperCase())} className="block w-full border border-stone-300 rounded px-2 py-1.5 text-sm" />
          </label>
          <label className="text-[12px] text-stone-500">CUIT (11 dígitos)
            <input value={e.cuit || ""} onChange={(ev) => setEmp(k, "cuit", ev.target.value)} className="block w-full border border-stone-300 rounded px-2 py-1.5 text-sm" />
          </label>
        </div>
      ))}
      <button onClick={guardarEmpresas} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">Guardar empresas</button>
      {msgEmp && <span className="text-xs text-stone-500 ml-2">{msgEmp}</span>}
    </div>
    </div>
  );
}

// Precio del kg de soja. Cada remito usa el precio vigente a su fecha (el más reciente que ya rige).
function Prefijos() {
  const [rows, setRows] = useState([]);
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const { data } = await supabase.from("prefijos_precinto").select("*").order("prefijo");
    setRows(data || []);
  };
  useEffect(() => {
    cargar();
  }, []);
  const guardar = async (prefijo, activo) => {
    setMsg("");
    const { error } = await supabase.rpc("guardar_prefijo", { p_prefijo: prefijo, p_activo: activo });
    if (error) return setMsg(friendlyError(error));
    if (prefijo === nuevo) setNuevo("");
    cargar();
  };
  return (
    <div className="panel p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="paso-titulo">Prefijos de precinto</h2>
        <p className="text-[13px] text-stone-500 mt-1">
          Lista que ve el operador al remitir: elige el prefijo y escribe los números “desde” y “hasta”. Los prefijos del reporte de stock se agregan solos al cargarlo. Si desactivás uno, deja de ofrecerse (los remitos ya emitidos no cambian).
        </p>
      </div>
      <div className="flex gap-2 items-end">
        <input value={nuevo} onChange={(e) => setNuevo(e.target.value.toUpperCase())} placeholder="26MST - STA" className="border border-stone-300 rounded px-2 py-1.5 text-sm w-56" />
        <button disabled={!nuevo.trim()} onClick={() => guardar(nuevo, true)} className="btn-primario">Agregar</button>
      </div>
      {msg && <div className="text-sm text-red-700">{msg}</div>}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-stone-100">
              <td className={`py-1.5 font-mono ${r.activo ? "" : "text-stone-400 line-through"}`}>{r.prefijo}</td>
              <td className="py-1.5 text-right">
                <button onClick={() => guardar(r.prefijo, !r.activo)} className="text-[13px] text-stone-600 underline">
                  {r.activo ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="py-2 text-stone-400">Todavía no hay prefijos. Se cargan solos al subir el reporte de stock.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Precios({ profile }) {
  const [cat, setCat] = useState("soja"); // soja: precio por kg · maíz: precio por bolsa
  const [rows, setRows] = useState([]);
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState(hoyISO());
  const [msg, setMsg] = useState("");
  const cargar = async () => {
    const { data } = await supabase.from("precios").select("*").eq("categoria", cat).order("vigente_desde", { ascending: false });
    setRows(data || []);
  };
  useEffect(() => {
    cargar();
    setMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);
  const unidad = cat === "maiz" ? "bolsa" : "kg";
  const guardar = async () => {
    const n = Number(String(precio).replace(",", "."));
    if (!(n > 0)) return setMsg("Cargá un precio mayor a cero.");
    if (!desde) return setMsg("Elegí desde qué fecha rige.");
    const { error } = await supabase
      .from("precios")
      .upsert({ categoria: cat, precio_kg: n, vigente_desde: desde, creado_por: profile.id, creado_por_nombre: profile.nombre }, { onConflict: "categoria,vigente_desde" });
    if (error) return setMsg(friendlyError(error));
    setPrecio("");
    setMsg("Precio guardado.");
    cargar();
  };
  const borrar = async (id) => {
    if (!(await confirmar("¿Borrar este precio?"))) return;
    const { error } = await supabase.from("precios").delete().eq("id", id);
    if (error) return setMsg(friendlyError(error));
    cargar();
  };
  const vigente = rows.find((r) => r.vigente_desde <= hoyISO());
  return (
    <div className="panel p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="paso-titulo">Precios para el COT</h2>
        <p className="text-[13px] text-stone-500 mt-1">
          Se usan en la pantalla COT para calcular el monto de cada remito: soja = kg × precio por kg; maíz = bolsas × precio por bolsa. Cada remito toma el precio vigente a su fecha.
        </p>
      </div>
      <div className="inline-flex rounded-md border border-stone-300 overflow-hidden text-[13px]">
        {[["soja", "Soja · por kg"], ["maiz", "Maíz · por bolsa"]].map(([v, t]) => (
          <button key={v} type="button" onClick={() => setCat(v)} className={`px-3 py-1.5 ${cat === v ? "bg-emerald-700 text-white" : "bg-white text-stone-600"}`}>{t}</button>
        ))}
      </div>
      <div className="flex gap-2 items-end flex-wrap">
        <label className="text-[12px] text-stone-500">
          Precio por {unidad} ($)
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0,00" className="block border border-stone-300 rounded px-2 py-1.5 text-sm w-36" />
        </label>
        <label className="text-[12px] text-stone-500">
          Rige desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="block border border-stone-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <button onClick={guardar} className="btn-primario">Guardar precio</button>
      </div>
      {msg && <div className="text-[13px] text-stone-600">{msg}</div>}
      {vigente && <div className="text-[13px]">Precio vigente hoy: <b>{fmtMonto(vigente.precio_kg)}</b> por {unidad} (desde {fmtFecha(vigente.vigente_desde)})</div>}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-stone-500">
            <th className="py-1.5 font-medium">Rige desde</th>
            <th className="py-1.5 font-medium text-right">Precio por {unidad}</th>
            <th className="py-1.5 font-medium pl-4">Cargó</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-stone-100">
              <td className="py-1.5">{fmtFecha(r.vigente_desde)}</td>
              <td className="py-1.5 text-right">{fmtMonto(r.precio_kg)}</td>
              <td className="py-1.5 pl-4 text-stone-500">{r.creado_por_nombre || ""}</td>
              <td className="py-1.5 text-right">
                <button onClick={() => borrar(r.id)} className="text-[12px] text-red-600 hover:underline">Borrar</button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-stone-400">Todavía no hay precios cargados.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
