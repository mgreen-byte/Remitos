"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PEDIDOS_DESDE } from "@/lib/pedidosPortal";
import { RUBROS, useRubro } from "@/lib/rubro";

const ICONOS = {
  inicio: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  talonarios: "M5 4h14v16H5zM9 4v16M12 9h4M12 13h4",
  traslados: "M4 8h13l-3-3M20 16H7l3 3M4 8h0M20 16h0",
  generar: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  stock: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  historial: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4",
  ordenes: "M9 4h6l1 2h3v15H5V6h3zM9 12h6M9 16h4",
  despachos: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  calidad: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4",
  reportes: "M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 8h3",
  cot: "M6 3h9l4 4v14H6zM9 13l2 2 4-4M9 17h6",
  conformes: "M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  pedidos: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  transportes: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  choferes: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  admin: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.8 7.3 4.8 7l-1 3 2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z",
};

function Icono({ d }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// Marco de la plataforma: menú lateral + contenido.
export default function NavBar({ profile, children }) {
  const pathname = usePathname();
  const router = useRouter();

  const [menu, setMenu] = useState(false); // menú desplegable del celular
  const [pendientes, setPendientes] = useState(0);
  const [avisoTal, setAvisoTal] = useState(0);
  const [avisoConf, setAvisoConf] = useState(0); // remitos sin conforme de salida
  const [avisoOc, setAvisoOc] = useState(0); // órdenes de carga activas con saldo pendiente
  const [avisoPu, setAvisoPu] = useState(0); // pedidos de unidad: órdenes sin asignar o rechazadas
  const [avisoCot, setAvisoCot] = useState(0);
  // Usuario con más de una planta habilitada: puede cambiar la planta en la que está trabajando.
  const [misPlantas, setMisPlantas] = useState([]);
  const [cambiando, setCambiando] = useState(false);
  useEffect(() => {
    const ids = [...new Set([profile?.planta_id, ...(profile?.plantas_extra || [])].filter(Boolean))];
    if (!profile || profile.rol === "admin" || ids.length < 2) return setMisPlantas([]);
    supabase.from("plantas").select("id, nombre, punto_venta").in("id", ids).eq("activa", true).order("nombre").then(({ data }) => setMisPlantas(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.planta_id]);
  const cambiarPlanta = async (id) => {
    if (!id || id === profile?.planta_id) return;
    setCambiando(true);
    const { error } = await supabase.rpc("cambiar_mi_planta", { p_planta: id });
    if (error) { setCambiando(false); window.alert(error.message); return; }
    window.location.reload(); // todo lo que se ve pasa a ser de la planta nueva
  };
  const selectorPlanta = misPlantas.length > 1 && (
    <label className="block mb-2">
      <span className="block text-[11px] uppercase tracking-wide text-stone-400 mb-1">Trabajando en</span>
      <select value={profile?.planta_id || ""} disabled={cambiando} onChange={(e) => cambiarPlanta(e.target.value)} className="w-full bg-ink-800 border border-ink-700 text-white text-[13px] rounded px-2 py-1.5">
        {misPlantas.map((p) => <option key={p.id} value={p.id}>{p.nombre} (PV {p.punto_venta})</option>)}
      </select>
    </label>
  );
  useEffect(() => { setMenu(false); }, [pathname]);
  // Menú lateral plegable (escritorio): se recuerda en este navegador.
  const [plegado, setPlegado] = useState(false);
  useEffect(() => { try { setPlegado(localStorage.getItem("menuPlegado") === "1"); } catch {} }, []);
  const alternarMenu = () => setPlegado((v) => { try { localStorage.setItem("menuPlegado", v ? "0" : "1"); } catch {} return !v; });
  useEffect(() => {
    if (!profile) return;
    if (profile.rol === "transportista") return; // el portal de transportistas no consulta nada más
    // Pedidos de unidad: órdenes activas (a clientes) sin transporte asignado, o rechazadas
    if (profile.rol === "admin" || profile.rol === "logistica") {
      Promise.all([
        supabase.from("ordenes_carga").select("id").eq("estado", "activa").eq("retira_cliente", false).is("pedido_desestimado_at", null).gte("created_at", PEDIDOS_DESDE).limit(3000),
        supabase.from("pedidos_unidad").select("orden_id, estado").limit(5000),
      ]).then(([o, p]) => {
        if (o.error || p.error) return;
        const est = Object.fromEntries((p.data || []).map((x) => [x.orden_id, x.estado]));
        setAvisoPu((o.data || []).filter((x) => !est[x.id] || est[x.id] === "rechazado").length);
      });
    }
    // COT pendientes: el operador ve los de su planta; admin y consulta, todos.
    if (profile.rol !== "operador" || profile.planta?.id) {
      let qc = supabase.from("v_cot_pendientes").select("remito_id", { count: "exact", head: true });
      if (profile.rol === "operador") qc = qc.eq("planta_id", profile.planta.id);
      qc.then(({ count }) => setAvisoCot(count || 0));
    }
    let q = supabase.from("remitos").select("id", { count: "exact", head: true }).eq("tipo", "traslado").eq("estado", "en_transito");
    if (profile.rol === "operador") {
      if (!profile.planta?.id) return;
      q = q.eq("planta_destino_id", profile.planta.id);
    }
    q.then(({ count }) => setPendientes(count || 0));
    // Conformes de salida: el operador, los de su planta; el resto, todos los que puede ver.
    if (profile.rol !== "operador" || profile.planta?.id) {
      let qf = supabase.from("v_conformes_pendientes").select("clave", { count: "exact", head: true });
      if (profile.rol === "operador") qf = qf.eq("planta_id", profile.planta.id);
      qf.then(({ count, error }) => setAvisoConf(error ? 0 : count || 0));
    }
    // Órdenes de carga activas con algo pendiente de remitir (la planta: las que tienen renglones suyos)
    if (profile.rol !== "operador" || profile.planta?.id) {
      let qo = supabase.from("v_ordenes_lineas_saldo").select("orden_id").eq("orden_estado", "activa").gt("saldo", 0).limit(5000);
      if (profile.rol === "operador") qo = qo.eq("planta_id", profile.planta.id);
      qo.then(({ data, error }) => setAvisoOc(error ? 0 : new Set((data || []).map((x) => x.orden_id)).size));
    }
    // Talonarios: la planta ve los que faltan confirmar; el admin, las pérdidas reportadas.
    let qt = supabase.from("talonarios").select("id", { count: "exact", head: true }).eq("estado", "activo");
    qt = profile.rol === "admin" ? qt.not("extravio_reportado_at", "is", null) : qt.is("recibido_at", null);
    if (profile.rol === "consulta" || profile.rol === "logistica") return;
    qt.then(({ count }) => setAvisoTal(count || 0));
  }, [profile, pathname]);

  const rol = profile?.rol;
  const items = rol === "transportista" ? [["/mis-pedidos", "Mis pedidos", "pedidos"]] : [
    ...(rol === "admin" || rol === "consulta" || rol === "logistica" ? [["/inicio", "Inicio", "inicio"]] : []),
    ...(rol !== "consulta" && rol !== "logistica" ? [["/generar", "Nuevo remito", "generar"]] : []),
    ["/ordenes", "Órdenes de carga", "ordenes"],
    ...(rol === "admin" || rol === "logistica" ? [["/pedidos", "Pedidos de unidad", "pedidos"]] : []),
    ...(rol === "admin" || rol === "consulta" || rol === "logistica" ? [["/despachos", "Despachos", "despachos"]] : []),
    ["/stock", "Stock", "stock"],
    ...(rol === "admin" || rol === "logistica" ? [["/calidad", "Calidad", "calidad"]] : []),
    ["/traslados", "Traslados", "traslados"],
    ["/talonarios", "Talonarios", "talonarios"],
    ["/conformes", "Conformes", "conformes"],
    ["/historial", "Historial", "historial"],
    ["/cot", "COT", "cot"],
    // Los maestros de transportes y choferes: admin (edita) (consulta no los ve).
    ...(rol === "admin" ? [["/transportes", "Transportes", "transportes"], ["/choferes", "Choferes", "choferes"]] : []),
    ...(rol === "admin" ? [["/reportes", "Reportes", "reportes"]] : []),
    ...(rol === "admin" || rol === "logistica" ? [["/admin", "Administración", "admin"]] : []),
  ];
  // Secciones del menú (solo títulos; los permisos de cada entrada no cambian).
  const GRUPO = { "/inicio": "Operación", "/generar": "Operación", "/ordenes": "Operación", "/pedidos": "Operación", "/mis-pedidos": "Operación", "/traslados": "Operación", "/historial": "Operación", "/conformes": "Operación", "/stock": "Stock", "/calidad": "Stock", "/talonarios": "Fiscal", "/cot": "Fiscal", "/despachos": "Análisis", "/reportes": "Análisis" };
  const ORDEN_GRUPOS = ["Operación", "Stock", "Fiscal", "Análisis", "Configuración"];
  const grupoDe = (href) => GRUPO[href] || "Configuración";
  const secciones = ORDEN_GRUPOS.map((g) => [g, items.filter((it) => grupoDe(it[0]) === g)]).filter(([, its]) => its.length);
  // Franja con la planta en la que se está trabajando (color por empresa, para no emitir en la planta equivocada).
  const EMP = { ms: ["MS Technologies", "bg-emerald-700"], stine: ["Stine Seed", "bg-sky-700"] }; // azul = Stine Seed, verde = MS Technologies
  const emp = EMP[profile?.planta?.empresa] || null;
  // Selector global Soja / Maíz (se recuerda en este navegador).
  const [rubro, setRubro] = useRubro();
  const selRubro = (
    <div className="ml-auto inline-flex items-center gap-2">
      <span className="opacity-80 text-[12px] hidden sm:inline">Ver</span>
      <div className="inline-flex rounded-md overflow-hidden border border-white/30 text-[12.5px]">
        {RUBROS.map(([v, t]) => (
          <button key={v || "todo"} type="button" onClick={() => setRubro(v)} className={`px-2.5 py-0.5 font-semibold ${rubro === v ? "bg-white text-stone-900" : "text-white hover:bg-white/15"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
  const franjaPlanta = profile?.rol === "transportista" ? (
    <div className="no-print bg-stone-700 text-white px-4 md:px-6 py-1.5 text-[13px]">Portal de transporte · {profile.nombre}</div>
  ) : (!profile?.planta || profile.rol === "admin") ? (profile && (
    <div className="no-print bg-stone-700 text-white px-4 md:px-6 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span className="opacity-80">{rubro ? `Mostrando solo ${rubro === "maiz" ? "maíz" : "soja"}` : "Mostrando soja y maíz"}</span>
      {selRubro}
    </div>
  )) : (
    <div className={`no-print ${emp ? emp[1] : "bg-stone-700"} text-white px-4 md:px-6 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]`}>
      <span className="opacity-80">Trabajando en</span>
      {misPlantas.length > 1 ? (
        <select value={profile.planta_id || ""} disabled={cambiando} onChange={(e) => cambiarPlanta(e.target.value)} className="bg-white/15 border border-white/30 rounded px-2 py-0.5 text-[13px] font-semibold text-white [&>option]:text-stone-900">
          {misPlantas.map((p) => <option key={p.id} value={p.id}>{p.nombre} (PV {p.punto_venta})</option>)}
        </select>
      ) : (
        <b>{profile.planta.nombre}</b>
      )}
      <span className="opacity-80">PV {profile.planta.punto_venta}</span>
      {emp && <span className="font-semibold uppercase tracking-wide text-[11.5px] bg-white/20 rounded px-1.5 py-0.5">{emp[0]}</span>}
      {misPlantas.length > 1 && <span className="opacity-80 text-[12px]">· podés cambiar de planta desde acá</span>}
      {selRubro}
    </div>
  );


  const titulo = (items.find(([href]) => href === pathname) || [])[1] || "";
  const hayAvisos = pendientes + avisoCot + avisoTal + avisoConf + avisoOc + avisoPu > 0;
  const rolTxt = profile?.rol === "consulta" ? "Solo vista" : profile?.rol === "logistica" ? "Logística" : profile?.planta ? profile.planta.nombre : profile?.rol === "admin" ? "Administrador" : "Sin planta";

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="print-reset min-h-screen md:flex bg-stone-100">
      <aside className={`no-print sticky top-0 z-40 md:z-auto ${plegado ? "md:w-16" : "md:w-60"} md:transition-[width] md:duration-200 md:flex-shrink-0 md:min-h-screen md:top-0 md:h-screen bg-ink-900 border-b-4 md:border-b-0 border-emerald-600 flex md:flex-col`}>
        <div className={`py-4 md:py-5 flex-shrink-0 ${plegado ? "md:px-2 px-5" : "px-5"}`}>
          <div className="flex items-start justify-between gap-2">
            <img src="/logo-blanco.png" alt="Stine" className={`h-8 md:h-10 w-auto ${plegado ? "md:hidden" : ""}`} />
            <button onClick={alternarMenu} title={plegado ? "Mostrar el menú" : "Ocultar el menú"} aria-label={plegado ? "Mostrar el menú" : "Ocultar el menú"} className={`hidden md:flex items-center justify-center w-8 h-8 rounded-md text-stone-300 hover:bg-ink-700 hover:text-white ${plegado ? "mx-auto" : ""}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{plegado ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}</svg>
            </button>
          </div>
          <div className={`hidden text-[12px] text-emerald-300 mt-2 ${plegado ? "" : "md:block"}`}>Despacho y Stock</div>
        </div>
        <div className="md:hidden flex-1 flex items-center justify-end gap-3 pr-3 min-w-0">
          <span className="text-[14px] font-medium text-white truncate">{titulo}</span>
          <button onClick={() => setMenu(true)} aria-label="Abrir menú" className="relative p-2.5 -mr-1 rounded-md text-white active:bg-ink-700">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            {hayAvisos && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-400" />}
          </button>
        </div>
        <nav className="hidden md:flex md:flex-col gap-0.5 px-2 md:px-3 flex-1 items-center md:items-stretch overflow-y-auto">
          {secciones.map(([g, its]) => (
            <div key={g} className="mb-1.5">
              {plegado ? <div className="mx-2 my-1.5 border-t border-ink-700" /> : <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.08em] text-stone-500 font-semibold">{g}</div>}
          {its.map(([href, label, icono]) => {
            const activo = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={plegado ? label : undefined}
                className={`relative flex items-center gap-3 ${plegado ? "justify-center px-0 py-2" : "px-3 py-1.5"} rounded-md text-[13.5px] font-medium whitespace-nowrap transition ${
                  activo ? "bg-emerald-600 text-white shadow-sm" : "text-stone-300 hover:bg-ink-700 hover:text-white"
                }`}
              >
                <Icono d={ICONOS[icono]} />
                {plegado ? (
                  (icono === "traslados" && pendientes > 0) || (icono === "cot" && avisoCot > 0) || (icono === "talonarios" && avisoTal > 0) || (icono === "conformes" && avisoConf > 0) || (icono === "ordenes" && avisoOc > 0) || (icono === "pedidos" && avisoPu > 0) ? <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-amber-400" /> : null
                ) : label}
                {!plegado && icono === "traslados" && pendientes > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center">{pendientes}</span>
                )}
                {!plegado && icono === "cot" && avisoCot > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center">{avisoCot}</span>
                )}
                {!plegado && icono === "pedidos" && avisoPu > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center" title="Órdenes sin transporte asignado o rechazadas">{avisoPu}</span>
                )}
                {!plegado && icono === "ordenes" && avisoOc > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center" title="Órdenes activas con saldo pendiente de remitir">{avisoOc}</span>
                )}
                {!plegado && icono === "conformes" && avisoConf > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center">{avisoConf}</span>
                )}
                {!plegado && icono === "talonarios" && avisoTal > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-amber-400 text-ink-900 rounded-full px-1.5 min-w-[18px] text-center">{avisoTal}</span>
                )}
              </Link>
            );
          })}
            </div>
          ))}
        </nav>
        {plegado && (
          <div className="hidden md:flex justify-center py-3 border-t border-ink-700">
            <button onClick={logout} title={`Cerrar sesión (${profile?.nombre || ""})`} aria-label="Cerrar sesión" className="w-9 h-9 flex items-center justify-center rounded-md text-emerald-300 hover:bg-ink-700 hover:text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        )}
        <div className={`hidden ${plegado ? "" : "md:block"} px-5 py-4 border-t border-ink-700 text-[13px]`}>
          <div className="font-medium text-white truncate">{profile?.nombre}</div>
          <div className="text-stone-400 text-[12px] mb-2">{profile?.rol === "consulta" ? "Solo vista" : profile?.rol === "logistica" ? "Logística" : profile?.planta ? profile.planta.nombre : profile?.rol === "admin" ? "Administrador" : "Sin planta"}</div>
          <button onClick={logout} className="text-emerald-300 hover:text-white text-[12.5px]">
            Cerrar sesión
          </button>
        </div>
        {menu && (
          <div className="md:hidden fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMenu(false)} />
            <div className="relative w-[82%] max-w-xs h-full bg-ink-900 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
                <div>
                  <div className="font-medium text-white">{profile?.nombre}</div>
                  <div className="text-stone-400 text-[12.5px]">{rolTxt}</div>
                </div>
                <button onClick={() => setMenu(false)} aria-label="Cerrar menú" className="p-2 text-stone-300 text-2xl leading-none">×</button>
              </div>
              <nav className="flex-1 p-2 space-y-1">
                {secciones.map(([g, its]) => (
                  <div key={g}>
                    <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-[0.08em] text-stone-500 font-semibold">{g}</div>
                {its.map(([href, label, icono]) => {
                  const n = icono === "traslados" ? pendientes : icono === "cot" ? avisoCot : icono === "talonarios" ? avisoTal : icono === "conformes" ? avisoConf : icono === "ordenes" ? avisoOc : icono === "pedidos" ? avisoPu : 0;
                  return (
                    <Link key={href} href={href} className={`flex items-center gap-3 px-4 py-3.5 rounded-md text-[16px] font-medium ${pathname === href ? "bg-emerald-600 text-white" : "text-stone-200 active:bg-ink-700"}`}>
                      <Icono d={ICONOS[icono]} />
                      {label}
                      {n > 0 && <span className="ml-auto text-[12px] font-semibold bg-amber-400 text-ink-900 rounded-full px-2 min-w-[20px] text-center">{n}</span>}
                    </Link>
                  );
                })}
                  </div>
                ))}
              </nav>
              <button onClick={logout} className="m-4 text-left px-4 py-3 rounded-md border border-ink-700 text-emerald-300 text-[15px]">Cerrar sesión</button>
            </div>
          </div>
        )}
      </aside>
      <main className="print-reset flex-1 min-w-0">{franjaPlanta}{children}</main>
    </div>
  );
}
