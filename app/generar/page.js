"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import RemitoSheet from "@/components/RemitoSheet";
import { supabase } from "@/lib/supabaseClient";
import { parseOrdenDeCarga, matchProducto } from "@/lib/parseOrdenDeCarga";
import { IVA_DEFAULT, CALIBRACION_DEFAULT, MODALIDADES, uid } from "@/lib/fieldCoords";
import { up, fmtNum, hoyISO, friendlyError, fmtCuit } from "@/lib/util";

const patente = (v) => up(v).replace(/[\s.\-]/g, "");

const itemVacio = () => ({ id: uid(), libre: false, productoId: "", loteId: "", cantidad: "", descripcion: "", kgUnidad: "", extra: "", hint: "" });

function remitoVacio() {
  return {
    fecha: hoyISO(),
    numero: "",
    destinatario: "",
    cuit: "",
    domicilio: "",
    iva: IVA_DEFAULT[0],
    entregarEn: "",
    transportistaId: "",
    transportista: "",
    transpCuit: "",
    transpDomicilio: "",
    choferId: "",
    chofer: "",
    choferDni: "",
    chasis: "",
    acoplado: "",
    totalKgs: "",
    observaciones: "",
  };
}

const inp = "w-full px-3 py-2 text-[14px]";
const lab = "campo-etiqueta";

function Paso({ n, titulo, ayuda, children }) {
  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3 mb-5">
        <span className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold flex items-center justify-center">{n}</span>
        <div>
          <h2 className="paso-titulo">{titulo}</h2>
          {ayuda && <p className="paso-ayuda">{ayuda}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function GenerarPage() {
  return <AuthGuard>{(profile) => <GenerarInner profile={profile} />}</AuthGuard>;
}

function GenerarInner({ profile }) {
  const esAdmin = profile.rol === "admin";
  const modalidadesPermitidas = profile.modalidades?.length ? profile.modalidades : ["soja", "maiz", "generico"];

  const [modalidad, setModalidad] = useState(modalidadesPermitidas[0]);
  const [plantas, setPlantas] = useState([]);
  const [plantaId, setPlantaId] = useState(profile.planta?.id || "");
  const [productos, setProductos] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [ivaOptions, setIvaOptions] = useState(IVA_DEFAULT);
  const [transportistas, setTransportistas] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [calibracion, setCalibracion] = useState(CALIBRACION_DEFAULT);
  const [ocData, setOcData] = useState(null);
  const [clienteSel, setClienteSel] = useState("");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [remito, setRemito] = useState(remitoVacio());
  const [items, setItems] = useState([itemVacio()]);
  const [mostrarPreview, setMostrarPreview] = useState(false);
  const [nuevoChofer, setNuevoChofer] = useState(null);
  const [errorChofer, setErrorChofer] = useState("");
  const [nuevoTransp, setNuevoTransp] = useState(null);
  const [errorTransp, setErrorTransp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emitido, setEmitido] = useState(null); // {id, pv, numero}
  const [sugerido, setSugerido] = useState("");
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);

  const choferSel = choferes.find((c) => c.id === remito.choferId);
  const patentesCambiadas = !!choferSel && (patente(choferSel.chasis) !== remito.chasis || patente(choferSel.acoplado) !== remito.acoplado);

  const planta = esAdmin ? plantas.find((p) => p.id === plantaId) : profile.planta;
  const puntoVenta = planta?.punto_venta || "";

  // ---------- carga de datos ----------
  useEffect(() => {
    (async () => {
      const [cfg, trans, chof, prods, pls] = await Promise.all([
        supabase.from("configuracion").select("*"),
        supabase.from("transportistas").select("*").order("nombre"),
        supabase.from("choferes").select("*").order("nombre"),
        supabase.from("productos").select("*").eq("activo", true).order("nombre"),
        supabase.from("plantas").select("*").eq("activa", true).order("nombre"),
      ]);
      const iva = cfg.data?.find((c) => c.clave === "iva_options");
      const cal = cfg.data?.find((c) => c.clave === "calibracion_default");
      if (iva) setIvaOptions(iva.valor);
      let calib = cal ? cal.valor : CALIBRACION_DEFAULT;
      try {
        const local = JSON.parse(localStorage.getItem("calibracion_local") || "null");
        if (local) calib = local;
      } catch {}
      setCalibracion(calib);
      if (trans.data) setTransportistas(trans.data);
      if (chof.data) setChoferes(chof.data);
      if (prods.data) setProductos(prods.data);
      if (pls.data) {
        setPlantas(pls.data);
        if (esAdmin && !plantaId && pls.data[0]) setPlantaId(pls.data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarLotes = async (pid) => {
    if (!pid) return setLotes([]);
    const { data } = await supabase
      .from("lotes")
      .select("id, lote, stock, producto_id")
      .eq("planta_id", pid)
      .eq("activo", true)
      .gt("stock", 0)
      .order("lote");
    setLotes(data || []);
  };

  const cargarSugerido = async (pv) => {
    setSugerido("");
    if (!pv) return;
    const { data } = await supabase.from("remitos").select("numero").eq("punto_venta", pv).order("numero", { ascending: false }).limit(1);
    const ult = data?.[0]?.numero;
    setSugerido(ult ? String(Number(ult) + 1).padStart(8, "0") : "00000001");
  };

  useEffect(() => {
    cargarLotes(plantaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaId]);

  useEffect(() => {
    cargarSugerido(puntoVenta);
  }, [puntoVenta]);

  const productosDisponibles = useMemo(() => {
    const conStock = new Set(lotes.map((l) => l.producto_id));
    return productos.filter(
      (p) => conStock.has(p.id) && (modalidad === "generico" || p.categoria === modalidad || p.categoria === "otro")
    );
  }, [productos, lotes, modalidad]);

  const lotesDe = (productoId) => lotes.filter((l) => l.producto_id === productoId);
  const productoDe = (id) => productos.find((p) => p.id === id);
  const loteDe = (id) => lotes.find((l) => l.id === id);

  // ---------- ítems ----------
  const descripcionDe = (it) => {
    if (it.libre) return up(it.descripcion);
    const p = productoDe(it.productoId);
    const l = loteDe(it.loteId);
    if (!p) return "";
    return [`${p.nombre} ${p.presentacion || ""}`.trim(), l ? `LOTE ${l.lote}` : "", it.extra].filter(Boolean).join(" · ").toUpperCase();
  };
  const kgUnidadDe = (it) => (it.libre ? Number(it.kgUnidad) || null : Number(productoDe(it.productoId)?.kg_por_unidad) || null);

  const itemsCalc = items.map((it) => ({ ...it, desc: descripcionDe(it), kgu: kgUnidadDe(it), cant: Number(it.cantidad) || 0 }));
  const totalUnidades = itemsCalc.reduce((a, it) => a + it.cant, 0);
  const totalKgsAuto = itemsCalc.reduce((a, it) => a + (it.kgu ? it.cant * it.kgu : 0), 0);
  const todosConKg = itemsCalc.every((it) => it.cant === 0 || it.kgu);

  useEffect(() => {
    setRemito((r) => ({ ...r, totalKgs: totalKgsAuto && todosConKg ? String(Math.round(totalKgsAuto * 100) / 100) : "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(itemsCalc.map((i) => [i.cant, i.kgu]))]);

  const updItem = (id, patch) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const selProducto = (id, productoId) => {
    const ls = lotesDe(productoId);
    updItem(id, { productoId, loteId: ls.length === 1 ? ls[0].id : "" });
  };

  // ---------- Excel ----------
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        setOcData(parseOrdenDeCarga(rows));
        setClienteSel("");
      } catch (err) {
        setParseError(err.message || "No pude leer el archivo.");
        setOcData(null);
      }
    };
    reader.readAsArrayBuffer(file); // el archivo no se sube: se procesa solo en este navegador
  };

  const selectCliente = (nombre) => {
    setClienteSel(nombre);
    const c = ocData?.clientes.find((x) => x.cliente === nombre);
    if (!c) return;
    const obs = [c.contacto ? `Contacto: ${c.contacto}` : "", c.telefono ? `Tel: ${c.telefono}` : ""].filter(Boolean).join(" — ");
    setRemito((r) => ({
      ...r,
      destinatario: up(c.cliente),
      cuit: up(c.cuit),
      domicilio: up(c.domicilio),
      entregarEn: up(c.entregarEn),
      observaciones: up(obs),
    }));
    const nuevos = c.items.map((oc) => {
      const prod = matchProducto(oc, productos, modalidad === "generico" ? null : modalidad);
      const hint = [oc.producto, oc.presentacion, oc.loteOc ? `lote OC: ${oc.loteOc}` : ""].filter(Boolean).join(" · ");
      if (!prod) {
        return {
          ...itemVacio(),
          libre: true,
          cantidad: String(oc.cantidad || ""),
          descripcion: up([oc.producto, oc.presentacion, oc.extra].filter(Boolean).join(" · ")),
          kgUnidad: oc.cantidad && oc.kilos ? String(Math.round((oc.kilos / oc.cantidad) * 1000) / 1000) : "",
          hint: `Sin coincidencia en el catálogo: ${hint}`,
        };
      }
      const ls = lotesDe(prod.id);
      const porTexto = oc.loteOc ? ls.find((l) => up(l.lote) === up(oc.loteOc)) : null;
      return {
        ...itemVacio(),
        productoId: prod.id,
        loteId: porTexto ? porTexto.id : ls.length === 1 ? ls[0].id : "",
        cantidad: String(oc.cantidad || ""),
        extra: oc.extra || "",
        hint,
      };
    });
    setItems(nuevos.length ? nuevos : [itemVacio()]);
    setMostrarPreview(false);
  };

  // ---------- transporte / chofer ----------
  const applyTransportista = (id) => {
    const t = transportistas.find((x) => x.id === id);
    setRemito((r) => ({
      ...r,
      transportistaId: t ? id : "",
      transportista: t ? up(t.nombre) : "",
      transpCuit: t ? fmtCuit(t.cuit) : "",
      transpDomicilio: t ? up(t.domicilio) : "",
    }));
  };
  const guardarNuevoTransp = async () => {
    setErrorTransp("");
    if (!nuevoTransp?.nombre?.trim()) return setErrorTransp("Completá el nombre o la razón social.");
    const cuit = (nuevoTransp.cuit || "").replace(/\D/g, "");
    if (cuit && cuit.length !== 11) return setErrorTransp("El CUIT tiene que tener 11 dígitos, sin guiones.");
    const { data, error } = await supabase
      .from("transportistas")
      .insert({ nombre: up(nuevoTransp.nombre).trim(), cuit: cuit || null, domicilio: up(nuevoTransp.domicilio).trim() || null })
      .select()
      .single();
    if (error) {
      if (error.code === "23505" && cuit) {
        const { data: ex } = await supabase.from("transportistas").select("*").eq("cuit", cuit).maybeSingle();
        if (ex) {
          setTransportistas((ts) => (ts.find((x) => x.id === ex.id) ? ts : [...ts, ex]));
          setNuevoTransp(null);
          setRemito((r) => ({ ...r, transportistaId: ex.id, transportista: up(ex.nombre), transpCuit: fmtCuit(ex.cuit), transpDomicilio: up(ex.domicilio) }));
          return;
        }
      }
      return setErrorTransp(friendlyError(error));
    }
    setTransportistas((ts) => [...ts, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setNuevoTransp(null);
    setRemito((r) => ({ ...r, transportistaId: data.id, transportista: up(data.nombre), transpCuit: fmtCuit(data.cuit), transpDomicilio: up(data.domicilio) }));
  };

  const applyChofer = (id) => {
    setNuevoChofer(null);
    setErrorChofer("");
    const c = choferes.find((x) => x.id === id);
    setRemito((r) => ({
      ...r,
      choferId: c ? id : "",
      chofer: c ? up(c.nombre) : "",
      choferDni: c ? fmtCuit(c.dni) : "",
      chasis: c ? patente(c.chasis) : "",
      acoplado: c ? patente(c.acoplado) : "",
    }));
  };
  const guardarNuevoChofer = async () => {
    setErrorChofer("");
    if (!nuevoChofer?.nombre?.trim()) return setErrorChofer("Completá el nombre.");
    const dni = (nuevoChofer.dni || "").replace(/\D/g, "");
    if (dni.length !== 11) return setErrorChofer("El CUIL tiene que tener 11 dígitos numéricos.");
    const { data, error } = await supabase
      .from("choferes")
      .insert({ nombre: up(nuevoChofer.nombre), dni, chasis: up(nuevoChofer.chasis), acoplado: up(nuevoChofer.acoplado) })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        const { data: ex } = await supabase.from("choferes").select("*").eq("dni", dni).maybeSingle();
        if (ex) {
          setChoferes((cs) => (cs.find((x) => x.id === ex.id) ? cs : [...cs, ex]));
          setNuevoChofer(null);
          setRemito((r) => ({ ...r, choferId: ex.id, chofer: up(ex.nombre), choferDni: fmtCuit(ex.dni), chasis: up(ex.chasis), acoplado: up(ex.acoplado) }));
          return setErrorChofer("Ese CUIL ya estaba cargado: lo seleccioné de la lista.");
        }
      }
      return setErrorChofer(friendlyError(error));
    }
    setChoferes((cs) => [...cs, data]);
    applyChofer(data.id);
  };

  // ---------- modalidad / reinicio ----------
  const reiniciar = (m = modalidad) => {
    setModalidad(m);
    setOcData(null);
    setClienteSel("");
    setFileName("");
    setParseError("");
    setRemito(remitoVacio());
    setItems([itemVacio()]);
    setMostrarPreview(false);
    setEmitido(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---------- emitir ----------
  const datosHoja = {
    fecha: remito.fecha,
    destinatario: remito.destinatario,
    cuit: remito.cuit,
    domicilio: remito.domicilio,
    iva: remito.iva,
    entregarEn: remito.entregarEn,
    transportista: remito.transportista,
    transpCuit: remito.transpCuit,
    transpDomicilio: remito.transpDomicilio,
    chasis: remito.chasis,
    acoplado: remito.acoplado,
    chofer: remito.chofer,
    choferDni: remito.choferDni,
    items: itemsCalc.filter((i) => i.cant > 0).map((i) => ({ cantidad: i.cant, descripcion: i.desc })),
    totalUnidades,
    totalKgs: remito.totalKgs,
    observaciones: remito.observaciones,
  };

  const validar = () => {
    if (!planta) return "No hay una planta asignada. Elegí una planta (o pedile al administrador que te asigne una).";
    if (remito.numero.length !== 8) return "El número de remito tiene que tener 8 dígitos.";
    if (!remito.destinatario.trim()) return "Falta el destinatario.";
    const validos = itemsCalc.filter((i) => i.cant > 0);
    if (!validos.length) return "Cargá al menos un ítem con cantidad.";
    if (validos.length > 9) return "El remito preimpreso admite hasta 9 ítems. Dividilo en dos remitos.";
    for (const [i, it] of validos.entries()) {
      if (!it.desc) return `Ítem ${i + 1}: falta el producto o la descripción.`;
      if (!it.libre) {
        if (!it.loteId) return `Ítem ${i + 1}: elegí el lote.`;
        const l = loteDe(it.loteId);
        if (l && it.cant > Number(l.stock)) return `Ítem ${i + 1}: el lote ${l.lote} tiene ${fmtNum(l.stock)} disponibles y pedís ${fmtNum(it.cant)}.`;
      }
    }
    return "";
  };

  const emitir = async () => {
    setError("");
    const msg = validar();
    if (msg) return setError(msg);
    const libres = itemsCalc.filter((i) => i.cant > 0 && i.libre).length;
    if (libres && modalidad !== "generico" && !window.confirm(`Hay ${libres} ítem(s) sin lote del stock: no descuentan stock. ¿Registrar de todas formas?`)) return;
    setSaving(true);
    const payload = {
      punto_venta: puntoVenta,
      numero: remito.numero,
      fecha: remito.fecha,
      modalidad,
      planta_id: esAdmin ? plantaId : undefined,
      cliente_nombre: remito.destinatario,
      cliente_cuit: remito.cuit,
      cliente_domicilio: remito.domicilio,
      cliente_iva: remito.iva,
      entregar_en: remito.entregarEn,
      transportista_id: remito.transportistaId || null,
      transportista_nombre: remito.transportista,
      transportista_cuit: remito.transpCuit,
      transportista_domicilio: remito.transpDomicilio,
      chofer_id: remito.choferId || null,
      chofer_nombre: remito.chofer,
      chofer_cuil: remito.choferDni,
      chasis: remito.chasis,
      acoplado: remito.acoplado,
      total_kgs: remito.totalKgs || null,
      observaciones: remito.observaciones,
    };
    const lista = itemsCalc
      .filter((i) => i.cant > 0)
      .map((i) => ({
        producto_id: i.libre ? null : i.productoId,
        lote_id: i.libre ? null : i.loteId,
        descripcion: i.desc,
        cantidad: i.cant,
        kg_unidad: i.kgu,
      }));
    const { data, error: err } = await supabase.rpc("emitir_remito", { p_remito: payload, p_items: lista });
    setSaving(false);
    if (err) return setError(friendlyError(err));
    if (patentesCambiadas) {
      const { error: errP } = await supabase.from("choferes").update({ chasis: remito.chasis || null, acoplado: remito.acoplado || null }).eq("id", remito.choferId);
      if (errP) setError("El remito quedó registrado, pero no se pudieron actualizar las patentes del chofer. Corregilas desde Choferes.");
      else setChoferes((cs) => cs.map((c) => (c.id === remito.choferId ? { ...c, chasis: remito.chasis || null, acoplado: remito.acoplado || null } : c)));
    }
    setEmitido({ id: data, pv: puntoVenta, numero: remito.numero });
    cargarLotes(plantaId);
    cargarSugerido(puntoVenta);
    setMostrarPreview(true);
    setTimeout(() => window.print(), 200);
  };

  const guardarCalibracion = (c) => {
    setCalibracion(c);
    try {
      localStorage.setItem("calibracion_local", JSON.stringify(c));
    } catch {}
  };

  const bloqueado = !!emitido;

  const abrirPreview = () => {
    setError("");
    setMostrarPreview(true);
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <NavBar profile={profile}>
      <div className="print-reset max-w-4xl mx-auto px-6 py-8 space-y-5">
        <header className="no-print mb-2">
          <h1 className="text-[22px] font-semibold text-stone-900">Nuevo remito</h1>
          <p className="text-stone-500 text-[13.5px]">Completá los datos de arriba hacia abajo. Al final podés ver cómo queda en el formulario antes de imprimir.</p>
        </header>

        {emitido && (
          <div className="no-print panel border-emerald-200 bg-emerald-50 p-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="font-semibold text-emerald-800">Remito {emitido.pv}-{emitido.numero} registrado</div>
              <div className="text-[13px] text-emerald-700">El stock ya fue descontado. Si no salió la impresión, podés reimprimir.</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="btn-secundario">Imprimir de nuevo</button>
              <button onClick={() => reiniciar()} className="btn-primario">Nuevo remito</button>
            </div>
          </div>
        )}

        <fieldset disabled={bloqueado} className="no-print space-y-5 disabled:opacity-60 min-w-0">
          <Paso n="1" titulo="Origen" ayuda="Qué tipo de remito es y desde qué planta sale.">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <span className={lab}>Modalidad</span>
                <div className="flex gap-2">
                  {MODALIDADES.filter((m) => modalidadesPermitidas.includes(m.id)).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => reiniciar(m.id)}
                      className={`flex-1 px-3 py-2 rounded-md text-[13.5px] font-medium border transition ${
                        modalidad === m.id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300 hover:border-emerald-400"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={lab}>Planta</span>
                {esAdmin ? (
                  <select value={plantaId} onChange={(e) => { setPlantaId(e.target.value); setItems([itemVacio()]); }} className={inp}>
                    {plantas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} (PV {p.punto_venta})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={profile.planta ? `${profile.planta.nombre} (PV ${profile.planta.punto_venta})` : "Sin planta asignada"} readOnly className={inp} />
                )}
                {!planta && <div className="text-[12px] text-red-600 mt-1">Pedile al administrador que te asigne una planta.</div>}
              </div>
            </div>

            {modalidad !== "generico" && (
              <div className="mt-5 pt-5 border-t border-stone-200 grid gap-4 md:grid-cols-2 items-end">
                <div>
                  <span className={lab}>Orden de carga (Excel, opcional)</span>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-[13px] text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-[13px] file:text-stone-700 hover:file:bg-stone-200" />
                  {fileName && <div className="text-[12px] text-stone-400 mt-1">{fileName} · no se guarda, solo se lee en este navegador</div>}
                  {parseError && <div className="text-[12px] text-red-600 mt-1">{parseError}</div>}
                </div>
                <div>
                  {ocData ? (
                    <>
                      <span className={lab}>Cliente de la orden ({ocData.clientes.length})</span>
                      <select value={clienteSel} onChange={(e) => selectCliente(e.target.value)} className={inp}>
                        <option value="">Elegir cliente…</option>
                        {ocData.clientes.map((c) => (
                          <option key={c.cliente} value={c.cliente}>
                            {c.cliente} — {c.totalCantidad} u. / {c.totalKilos} kg
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <div className="text-[12.5px] text-stone-400">Sin Excel, cargá los datos a mano en los pasos siguientes.</div>
                  )}
                </div>
              </div>
            )}
          </Paso>

          <Paso n="2" titulo="Datos del remito" ayuda="El número es el que viene impreso en la hoja del talonario.">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={lab}>Punto de venta</label>
                <input value={puntoVenta} readOnly className={inp} />
              </div>
              <div>
                <label className={lab}>Número (8 dígitos)</label>
                <input
                  value={remito.numero}
                  onChange={(e) => setRemito((r) => ({ ...r, numero: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                  placeholder="00000001"
                  inputMode="numeric"
                  className={inp}
                />
                {sugerido && remito.numero !== sugerido && (
                  <button type="button" onClick={() => setRemito((r) => ({ ...r, numero: sugerido }))} className="text-[12px] text-emerald-700 hover:underline mt-1">
                    Usar el siguiente: {sugerido}
                  </button>
                )}
              </div>
              <div>
                <label className={lab}>Fecha</label>
                <input type="date" value={remito.fecha} onChange={(e) => setRemito((r) => ({ ...r, fecha: e.target.value }))} className={inp} />
              </div>
            </div>
          </Paso>

          <Paso n="3" titulo="Destinatario">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className={lab}>Nombre o razón social</label>
                <input value={remito.destinatario} onChange={(e) => setRemito((r) => ({ ...r, destinatario: up(e.target.value) }))} className={inp} />
              </div>
              <div>
                <label className={lab}>CUIT</label>
                <input value={remito.cuit} onChange={(e) => setRemito((r) => ({ ...r, cuit: up(e.target.value) }))} className={inp} />
              </div>
              <div className="md:col-span-2">
                <label className={lab}>Domicilio</label>
                <input value={remito.domicilio} onChange={(e) => setRemito((r) => ({ ...r, domicilio: up(e.target.value) }))} className={inp} />
              </div>
              <div>
                <label className={lab}>Condición de IVA</label>
                <select value={remito.iva} onChange={(e) => setRemito((r) => ({ ...r, iva: e.target.value }))} className={inp}>
                  {ivaOptions.map((op) => (
                    <option key={op}>{op}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className={lab}>Entregar en</label>
                <input value={remito.entregarEn} onChange={(e) => setRemito((r) => ({ ...r, entregarEn: up(e.target.value) }))} className={inp} />
              </div>
            </div>
          </Paso>

          <Paso n="4" titulo="Transporte" ayuda="Elegí de la lista o cargá los datos a mano. Los choferes nuevos quedan guardados para todos.">
            <div className="grid gap-8 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className={lab}>Transportista</label>
                  <select
                    value={remito.transportistaId}
                    onChange={(e) => {
                      if (e.target.value === "__nuevo__") {
                        setNuevoTransp({ nombre: "", cuit: "", domicilio: "" });
                        setRemito((r) => ({ ...r, transportistaId: "" }));
                      } else {
                        setNuevoTransp(null);
                        setErrorTransp("");
                        applyTransportista(e.target.value);
                      }
                    }}
                    className={inp}
                  >
                    <option value="">Cargar a mano…</option>
                    {transportistas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                    <option value="__nuevo__">+ Agregar transporte nuevo…</option>
                  </select>
                </div>
                {nuevoTransp && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                    <input value={nuevoTransp.nombre} onChange={(e) => setNuevoTransp((n) => ({ ...n, nombre: e.target.value }))} placeholder="Nombre o razón social" className={`${inp} uppercase`} />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={nuevoTransp.cuit} onChange={(e) => setNuevoTransp((n) => ({ ...n, cuit: e.target.value.replace(/\D/g, "").slice(0, 11) }))} placeholder="CUIT (11 dígitos)" inputMode="numeric" className={inp} />
                      <input value={nuevoTransp.domicilio} onChange={(e) => setNuevoTransp((n) => ({ ...n, domicilio: e.target.value }))} placeholder="Domicilio" className={`${inp} uppercase`} />
                    </div>
                    {errorTransp && <div className="text-[12px] text-amber-700">{errorTransp}</div>}
                    <div className="flex gap-2">
                      <button type="button" onClick={guardarNuevoTransp} className="btn-primario !py-1.5">Guardar transporte</button>
                      <button type="button" onClick={() => { setNuevoTransp(null); setErrorTransp(""); }} className="btn text-stone-500 !py-1.5">Cancelar</button>
                    </div>
                  </div>
                )}
                {!remito.transportistaId && !nuevoTransp ? (
                  <>
                    <input value={remito.transportista} onChange={(e) => setRemito((r) => ({ ...r, transportista: up(e.target.value) }))} placeholder="Nombre o razón social" className={inp} />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={remito.transpCuit} onChange={(e) => setRemito((r) => ({ ...r, transpCuit: up(e.target.value) }))} placeholder="CUIT" className={inp} />
                      <input value={remito.transpDomicilio} onChange={(e) => setRemito((r) => ({ ...r, transpDomicilio: up(e.target.value) }))} placeholder="Domicilio" className={inp} />
                    </div>
                  </>
                ) : nuevoTransp ? null : (
                  <div className="text-[12.5px] text-stone-500">
                    CUIT {remito.transpCuit || "—"} · {remito.transpDomicilio || "sin domicilio"}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className={lab}>Chofer</label>
                  <select
                    value={remito.choferId}
                    onChange={(e) => {
                      if (e.target.value === "__nuevo__") {
                        setNuevoChofer({ nombre: "", dni: "", chasis: "", acoplado: "" });
                        setRemito((r) => ({ ...r, choferId: "" }));
                      } else applyChofer(e.target.value);
                    }}
                    className={inp}
                  >
                    <option value="">Cargar a mano…</option>
                    {choferes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} — {c.dni}
                      </option>
                    ))}
                    <option value="__nuevo__">+ Agregar chofer nuevo…</option>
                  </select>
                </div>
                {nuevoChofer && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                    <input value={nuevoChofer.nombre} onChange={(e) => setNuevoChofer((n) => ({ ...n, nombre: e.target.value }))} placeholder="Nombre y apellido" className={`${inp} uppercase`} />
                    <input
                      value={nuevoChofer.dni}
                      onChange={(e) => setNuevoChofer((n) => ({ ...n, dni: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                      placeholder="CUIL (11 dígitos)"
                      inputMode="numeric"
                      className={inp}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={nuevoChofer.chasis} onChange={(e) => setNuevoChofer((n) => ({ ...n, chasis: e.target.value }))} placeholder="Patente chasis" className={`${inp} uppercase`} />
                      <input value={nuevoChofer.acoplado} onChange={(e) => setNuevoChofer((n) => ({ ...n, acoplado: e.target.value }))} placeholder="Patente acoplado" className={`${inp} uppercase`} />
                    </div>
                    {errorChofer && <div className="text-[12px] text-amber-700">{errorChofer}</div>}
                    <div className="flex gap-2">
                      <button type="button" onClick={guardarNuevoChofer} className="btn-primario !py-1.5">Guardar chofer</button>
                      <button type="button" onClick={() => { setNuevoChofer(null); setErrorChofer(""); }} className="btn text-stone-500 !py-1.5">Cancelar</button>
                    </div>
                  </div>
                )}
                {!remito.choferId && !nuevoChofer && (
                  <>
                    <input value={remito.chofer} onChange={(e) => setRemito((r) => ({ ...r, chofer: up(e.target.value) }))} placeholder="Nombre y apellido" className={inp} />
                    <input value={remito.choferDni} onChange={(e) => setRemito((r) => ({ ...r, choferDni: up(e.target.value) }))} placeholder="CUIL" className={inp} />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={remito.chasis} onChange={(e) => setRemito((r) => ({ ...r, chasis: up(e.target.value) }))} placeholder="Patente chasis" className={inp} />
                      <input value={remito.acoplado} onChange={(e) => setRemito((r) => ({ ...r, acoplado: up(e.target.value) }))} placeholder="Patente acoplado" className={inp} />
                    </div>
                  </>
                )}
                {remito.choferId && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lab}>Patente chasis</label>
                        <input value={remito.chasis} onChange={(e) => setRemito((r) => ({ ...r, chasis: patente(e.target.value) }))} className={inp} />
                      </div>
                      <div>
                        <label className={lab}>Patente acoplado</label>
                        <input value={remito.acoplado} onChange={(e) => setRemito((r) => ({ ...r, acoplado: patente(e.target.value) }))} className={inp} />
                      </div>
                    </div>
                    {patentesCambiadas && (
                      <div className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        Las patentes son distintas de las guardadas para este chofer. Al registrar el remito se actualizan también en el chofer.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Paso>

          <Paso n="5" titulo="Mercadería" ayuda="Elegí el producto y el lote de tu planta. El stock se descuenta al registrar el remito.">
            <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_96px_28px] gap-3 mb-1">
              <span className={lab}>Producto</span>
              <span className={lab}>Lote</span>
              <span className={lab}>Cantidad</span>
              <span />
            </div>
            <div className="divide-y divide-stone-200">
              {itemsCalc.map((it, idx) => {
                const ls = lotesDe(it.productoId);
                const l = loteDe(it.loteId);
                return (
                  <div key={it.id} className="py-3 first:pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_96px_28px] gap-3 items-center">
                      {it.libre ? (
                        <>
                          <input value={it.descripcion} onChange={(e) => updItem(it.id, { descripcion: up(e.target.value) })} placeholder="Descripción" className={`${inp} col-span-2 md:col-span-1`} />
                          <input value={it.kgUnidad} onChange={(e) => updItem(it.id, { kgUnidad: e.target.value.replace(",", ".") })} placeholder="Kg por unidad" inputMode="decimal" className={inp} />
                        </>
                      ) : (
                        <>
                          <select value={it.productoId} onChange={(e) => selProducto(it.id, e.target.value)} className={`${inp} col-span-2 md:col-span-1`}>
                            <option value="">Elegir producto…</option>
                            {productosDisponibles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nombre} {p.presentacion}
                              </option>
                            ))}
                            {it.productoId && !productosDisponibles.find((p) => p.id === it.productoId) && productoDe(it.productoId) && (
                              <option value={it.productoId}>{productoDe(it.productoId).nombre} (sin stock)</option>
                            )}
                          </select>
                          <select value={it.loteId} onChange={(e) => updItem(it.id, { loteId: e.target.value })} className={inp} disabled={!it.productoId}>
                            <option value="">{it.productoId && !ls.length ? "Sin lotes con stock" : "Elegir lote…"}</option>
                            {ls.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.lote} · {fmtNum(x.stock)} disp.
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <input value={it.cantidad} onChange={(e) => updItem(it.id, { cantidad: e.target.value.replace(",", ".") })} placeholder="0" inputMode="decimal" className={`${inp} text-right`} />
                      {items.length > 1 ? (
                        <button type="button" onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))} className="text-stone-400 hover:text-red-600 text-lg leading-none justify-self-end" aria-label={`Quitar ítem ${idx + 1}`}>
                          ×
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 flex-wrap text-[12px]">
                      <div className="text-stone-400 min-w-0">
                        {it.hint && <span className="text-amber-700 mr-2">{it.hint}</span>}
                        {it.cant > 0 && l && it.cant > Number(l.stock) && <span className="text-red-600 mr-2">Supera el stock del lote ({fmtNum(l.stock)}).</span>}
                        {it.desc && <span>Se imprime: {it.desc}{it.kgu ? ` · ${fmtNum(it.cant * it.kgu)} kg` : ""}</span>}
                      </div>
                      <div className="flex gap-x-4 gap-y-1 flex-wrap">
                        {!it.libre && (
                          <input value={it.extra} onChange={(e) => updItem(it.id, { extra: up(e.target.value) })} placeholder="Detalle (precinto, calibre…)" className="px-2 py-1 text-[12px] w-52" />
                        )}
                        <button type="button" onClick={() => updItem(it.id, { libre: !it.libre, productoId: "", loteId: "" })} className="text-emerald-700 hover:underline">
                          {it.libre ? "Elegir del stock" : "Cargar sin stock"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setItems((a) => [...a, itemVacio()])} className="mt-3 text-[13.5px] font-medium text-emerald-700 hover:text-emerald-800">
              + Agregar ítem
            </button>
          </Paso>

          <Paso n="6" titulo="Totales y observaciones">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <label className={lab}>Total de unidades</label>
                <input value={fmtNum(totalUnidades)} readOnly className={inp} />
              </div>
              <div>
                <label className={lab}>Total de kg</label>
                <input value={remito.totalKgs} onChange={(e) => setRemito((r) => ({ ...r, totalKgs: e.target.value.replace(",", ".") }))} className={inp} />
              </div>
              <div className="sm:col-span-2">
                <label className={lab}>Observaciones</label>
                <textarea value={remito.observaciones} onChange={(e) => setRemito((r) => ({ ...r, observaciones: up(e.target.value) }))} rows={2} className={inp} />
              </div>
            </div>
          </Paso>
        </fieldset>

        {error && <div className="no-print rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13.5px] p-4">{error}</div>}

        {!bloqueado && (
          <div className="no-print flex justify-end pt-1">
            <button onClick={abrirPreview} className="btn-primario px-8 py-2.5">
              Vista previa
            </button>
          </div>
        )}

        <div ref={previewRef} className="print-reset space-y-4" style={{ display: mostrarPreview ? "block" : "none" }}>
          <div className="no-print flex items-end justify-between flex-wrap gap-3 pt-2">
            <div>
              <h2 className="text-[17px] font-semibold text-stone-900">Vista previa</h2>
              <p className="text-[13px] text-stone-500">Así se imprime sobre el remito preimpreso. Revisá los datos antes de registrar.</p>
            </div>
            {!bloqueado && (
              <div className="flex gap-2">
                <button onClick={() => { setMostrarPreview(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="btn-secundario">
                  Volver a editar
                </button>
                <button onClick={emitir} disabled={saving} className="btn-primario">
                  {saving ? "Registrando…" : "Registrar e imprimir"}
                </button>
              </div>
            )}
          </div>
          <div className="print-reset bg-stone-200 rounded-xl p-6 overflow-x-auto flex justify-center">
            <RemitoSheet d={datosHoja} calibracion={calibracion} visible={mostrarPreview} />
          </div>
          <details className="no-print panel p-5">
            <summary className="cursor-pointer text-[13.5px] font-medium text-stone-700">Ajustar posición de impresión</summary>
            <p className="paso-ayuda mt-2">Se guarda en este navegador. Imprimí una prueba y ajustá hasta que el texto caiga sobre las líneas.</p>
            <div className="grid gap-4 md:grid-cols-3 mt-3">
              {[
                ["offsetX", "Horizontal (mm)", -10, 10, 0.5],
                ["offsetY", "Vertical (mm)", -10, 10, 0.5],
                ["fontSize", "Tamaño de letra (pt)", 7, 13, 0.5],
              ].map(([k, label, min, max, step]) => (
                <label key={k} className={lab}>
                  {label}: <span className="text-stone-800">{calibracion[k]}</span>
                  <input type="range" min={min} max={max} step={step} value={calibracion[k]} onChange={(e) => guardarCalibracion({ ...calibracion, [k]: Number(e.target.value) })} className="w-full accent-emerald-700" />
                </label>
              ))}
            </div>
            {esAdmin && (
              <button
                onClick={async () => {
                  await supabase.from("configuracion").upsert({ clave: "calibracion_default", valor: calibracion });
                }}
                className="text-[12.5px] text-emerald-700 hover:underline mt-3"
              >
                Guardar como posición predeterminada para todos
              </button>
            )}
          </details>
        </div>
      </div>
    </NavBar>
  );
}
