"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import RemitoSheet from "@/components/RemitoSheet";
import { supabase } from "@/lib/supabaseClient";
import { parseOrdenDeCarga, matchProducto } from "@/lib/parseOrdenDeCarga";
import { IVA_DEFAULT, CALIBRACION_DEFAULT, MODALIDADES, uid } from "@/lib/fieldCoords";
import { up, fmtNum, hoyISO, friendlyError } from "@/lib/util";

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

const inputCls = "w-full border border-stone-300 rounded px-2 py-1.5 text-sm";
const labelCls = "block text-xs text-stone-500";
const cardCls = "bg-white rounded-lg border border-stone-200 p-4 space-y-3";
const titleCls = "text-xs font-semibold text-stone-500 uppercase";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emitido, setEmitido] = useState(null); // {id, pv, numero}
  const [sugerido, setSugerido] = useState("");
  const fileInputRef = useRef(null);

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
      transpCuit: t ? up(t.cuit) : "",
      transpDomicilio: t ? up(t.domicilio) : "",
    }));
  };
  const applyChofer = (id) => {
    setNuevoChofer(null);
    setErrorChofer("");
    const c = choferes.find((x) => x.id === id);
    setRemito((r) => ({
      ...r,
      choferId: c ? id : "",
      chofer: c ? up(c.nombre) : "",
      choferDni: c ? up(c.dni) : "",
      chasis: c ? up(c.chasis) : "",
      acoplado: c ? up(c.acoplado) : "",
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
          setRemito((r) => ({ ...r, choferId: ex.id, chofer: up(ex.nombre), choferDni: ex.dni, chasis: up(ex.chasis), acoplado: up(ex.acoplado) }));
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

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 flex flex-col">
      <NavBar profile={profile} />
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6">
        <div className="no-print w-full lg:w-[480px] flex-shrink-0 space-y-5">
          {emitido && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-4 space-y-2">
              <div className="text-sm font-semibold text-emerald-800">
                Remito {emitido.pv}-{emitido.numero} registrado
              </div>
              <div className="text-xs text-emerald-700">El stock ya fue descontado. Si no salió la impresión, podés reimprimir.</div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-white border border-emerald-700 text-emerald-800 text-sm px-3 py-1.5 rounded">
                  Imprimir de nuevo
                </button>
                <button onClick={() => reiniciar()} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">
                  Nuevo remito
                </button>
              </div>
            </div>
          )}

          <fieldset disabled={bloqueado} className="space-y-5 disabled:opacity-60">
            <div className={cardCls}>
              <div className={titleCls}>Modalidad</div>
              <div className="flex gap-2">
                {MODALIDADES.filter((m) => modalidadesPermitidas.includes(m.id)).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => reiniciar(m.id)}
                    className={`flex-1 px-3 py-2 rounded text-sm font-medium border ${
                      modalidad === m.id ? "bg-emerald-700 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-300 hover:border-emerald-400"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {esAdmin && (
                <label className={labelCls}>
                  Planta
                  <select value={plantaId} onChange={(e) => { setPlantaId(e.target.value); setItems([itemVacio()]); }} className={inputCls}>
                    {plantas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} (PV {p.punto_venta})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!planta && <div className="text-xs text-red-600">Tu usuario no tiene una planta asignada. Pedile al administrador que te la asigne.</div>}
            </div>

            {modalidad !== "generico" && (
              <div className={cardCls}>
                <div className={titleCls}>Orden de carga (Excel) — opcional</div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-sm" />
                {fileName && <div className="text-xs text-stone-500">Archivo: {fileName} (no se guarda, solo se procesa)</div>}
                {parseError && <div className="text-xs text-red-600">{parseError}</div>}
                {ocData && (
                  <select value={clienteSel} onChange={(e) => selectCliente(e.target.value)} className={inputCls}>
                    <option value="">Elegir cliente ({ocData.clientes.length})…</option>
                    {ocData.clientes.map((c) => (
                      <option key={c.cliente} value={c.cliente}>
                        {c.cliente} — {c.totalCantidad} u. / {c.totalKilos} kg
                      </option>
                    ))}
                  </select>
                )}
                <div className="text-xs text-stone-400">Sin Excel, cargá los datos a mano más abajo.</div>
              </div>
            )}

            <div className={cardCls}>
              <div className={titleCls}>Datos del remito</div>
              <div className="flex gap-2">
                <div className="w-24">
                  <div className="text-[10px] text-stone-400 mb-0.5">Punto de venta</div>
                  <input value={puntoVenta} readOnly className={`${inputCls} bg-stone-100`} />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] text-stone-400 mb-0.5">N° impreso en la hoja (8 dígitos)</div>
                  <input
                    value={remito.numero}
                    onChange={(e) => setRemito((r) => ({ ...r, numero: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                    placeholder="00000001"
                    inputMode="numeric"
                    className={inputCls}
                  />
                </div>
                <div className="w-36">
                  <div className="text-[10px] text-stone-400 mb-0.5">Fecha</div>
                  <input type="date" value={remito.fecha} onChange={(e) => setRemito((r) => ({ ...r, fecha: e.target.value }))} className={inputCls} />
                </div>
              </div>
              {sugerido && remito.numero !== sugerido && (
                <button onClick={() => setRemito((r) => ({ ...r, numero: sugerido }))} className="text-xs text-emerald-700 hover:underline">
                  Usar el siguiente número: {sugerido}
                </button>
              )}
              <label className={labelCls}>
                Destinatario
                <input value={remito.destinatario} onChange={(e) => setRemito((r) => ({ ...r, destinatario: up(e.target.value) }))} className={inputCls} />
              </label>
              <div className="flex gap-2">
                <label className={`${labelCls} flex-1`}>
                  CUIT
                  <input value={remito.cuit} onChange={(e) => setRemito((r) => ({ ...r, cuit: up(e.target.value) }))} className={inputCls} />
                </label>
                <label className={`${labelCls} flex-1`}>
                  Condición de IVA
                  <select value={remito.iva} onChange={(e) => setRemito((r) => ({ ...r, iva: e.target.value }))} className={inputCls}>
                    {ivaOptions.map((op) => (
                      <option key={op}>{op}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className={labelCls}>
                Domicilio
                <input value={remito.domicilio} onChange={(e) => setRemito((r) => ({ ...r, domicilio: up(e.target.value) }))} className={inputCls} />
              </label>
              <label className={labelCls}>
                Entregar en
                <input value={remito.entregarEn} onChange={(e) => setRemito((r) => ({ ...r, entregarEn: up(e.target.value) }))} className={inputCls} />
              </label>
            </div>

            <div className={cardCls}>
              <div className={titleCls}>Transporte</div>
              <select value={remito.transportistaId} onChange={(e) => applyTransportista(e.target.value)} className={inputCls}>
                <option value="">Cargar manualmente…</option>
                {transportistas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
              {!remito.transportistaId && (
                <>
                  <input value={remito.transportista} onChange={(e) => setRemito((r) => ({ ...r, transportista: up(e.target.value) }))} placeholder="Nombre / Razón social" className={inputCls} />
                  <div className="flex gap-2">
                    <input value={remito.transpCuit} onChange={(e) => setRemito((r) => ({ ...r, transpCuit: up(e.target.value) }))} placeholder="CUIT" className={inputCls} />
                    <input value={remito.transpDomicilio} onChange={(e) => setRemito((r) => ({ ...r, transpDomicilio: up(e.target.value) }))} placeholder="Domicilio" className={inputCls} />
                  </div>
                </>
              )}
            </div>

            <div className={cardCls}>
              <div className={titleCls}>Chofer</div>
              <select
                value={remito.choferId}
                onChange={(e) => {
                  if (e.target.value === "__nuevo__") {
                    setNuevoChofer({ nombre: "", dni: "", chasis: "", acoplado: "" });
                    setRemito((r) => ({ ...r, choferId: "" }));
                  } else applyChofer(e.target.value);
                }}
                className={inputCls}
              >
                <option value="">Cargar manualmente…</option>
                {choferes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} — {c.dni}
                  </option>
                ))}
                <option value="__nuevo__">+ Agregar chofer nuevo…</option>
              </select>
              {nuevoChofer && (
                <div className="border border-emerald-200 bg-emerald-50 rounded p-2 space-y-2">
                  <input value={nuevoChofer.nombre} onChange={(e) => setNuevoChofer((n) => ({ ...n, nombre: e.target.value }))} placeholder="Nombre y apellido" className={`${inputCls} uppercase`} />
                  <input
                    value={nuevoChofer.dni}
                    onChange={(e) => setNuevoChofer((n) => ({ ...n, dni: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                    placeholder="CUIL (11 dígitos)"
                    inputMode="numeric"
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <input value={nuevoChofer.chasis} onChange={(e) => setNuevoChofer((n) => ({ ...n, chasis: e.target.value }))} placeholder="Patente chasis" className={`${inputCls} uppercase`} />
                    <input value={nuevoChofer.acoplado} onChange={(e) => setNuevoChofer((n) => ({ ...n, acoplado: e.target.value }))} placeholder="Patente acoplado" className={`${inputCls} uppercase`} />
                  </div>
                  {errorChofer && <div className="text-xs text-amber-700">{errorChofer}</div>}
                  <div className="flex gap-2">
                    <button onClick={guardarNuevoChofer} className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded">
                      Guardar chofer
                    </button>
                    <button onClick={() => { setNuevoChofer(null); setErrorChofer(""); }} className="text-stone-500 text-sm px-3 py-1.5">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {!remito.choferId && !nuevoChofer && (
                <>
                  <input value={remito.chofer} onChange={(e) => setRemito((r) => ({ ...r, chofer: up(e.target.value) }))} placeholder="Nombre y apellido" className={inputCls} />
                  <input value={remito.choferDni} onChange={(e) => setRemito((r) => ({ ...r, choferDni: up(e.target.value) }))} placeholder="CUIL" className={inputCls} />
                  <div className="flex gap-2">
                    <input value={remito.chasis} onChange={(e) => setRemito((r) => ({ ...r, chasis: up(e.target.value) }))} placeholder="Patente chasis" className={inputCls} />
                    <input value={remito.acoplado} onChange={(e) => setRemito((r) => ({ ...r, acoplado: up(e.target.value) }))} placeholder="Patente acoplado" className={inputCls} />
                  </div>
                </>
              )}
              {remito.choferId && (
                <div className="text-xs text-stone-500">
                  Chasis: {remito.chasis || "—"} · Acoplado: {remito.acoplado || "—"}
                </div>
              )}
            </div>

            <div className={cardCls}>
              <div className={titleCls}>Ítems</div>
              {itemsCalc.map((it, idx) => {
                const ls = lotesDe(it.productoId);
                const l = loteDe(it.loteId);
                return (
                  <div key={it.id} className="border border-stone-200 rounded p-2 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-stone-400">
                      <span>Ítem {idx + 1}</span>
                      <div className="flex gap-3">
                        <button onClick={() => updItem(it.id, { libre: !it.libre, productoId: "", loteId: "" })} className="hover:text-emerald-700">
                          {it.libre ? "Elegir del stock" : "Cargar libre (sin stock)"}
                        </button>
                        {items.length > 1 && (
                          <button onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))} className="hover:text-red-500">
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>
                    {it.hint && <div className="text-[11px] text-amber-700">{it.hint}</div>}
                    {it.libre ? (
                      <div className="flex gap-1">
                        <input value={it.cantidad} onChange={(e) => updItem(it.id, { cantidad: e.target.value.replace(",", ".") })} placeholder="Cant." inputMode="decimal" className={`${inputCls} w-16`} />
                        <input value={it.descripcion} onChange={(e) => updItem(it.id, { descripcion: up(e.target.value) })} placeholder="Descripción" className={`${inputCls} flex-1`} />
                        <input value={it.kgUnidad} onChange={(e) => updItem(it.id, { kgUnidad: e.target.value.replace(",", ".") })} placeholder="Kg/u" inputMode="decimal" className={`${inputCls} w-16`} />
                      </div>
                    ) : (
                      <>
                        <select value={it.productoId} onChange={(e) => selProducto(it.id, e.target.value)} className={inputCls}>
                          <option value="">Producto…</option>
                          {productosDisponibles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre} {p.presentacion}
                            </option>
                          ))}
                          {it.productoId && !productosDisponibles.find((p) => p.id === it.productoId) && productoDe(it.productoId) && (
                            <option value={it.productoId}>{productoDe(it.productoId).nombre} (sin stock)</option>
                          )}
                        </select>
                        <div className="flex gap-1">
                          <select value={it.loteId} onChange={(e) => updItem(it.id, { loteId: e.target.value })} className={`${inputCls} flex-1`} disabled={!it.productoId}>
                            <option value="">{it.productoId && !ls.length ? "Sin lotes con stock" : "Lote…"}</option>
                            {ls.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.lote} — {fmtNum(x.stock)} disp.
                              </option>
                            ))}
                          </select>
                          <input value={it.cantidad} onChange={(e) => updItem(it.id, { cantidad: e.target.value.replace(",", ".") })} placeholder="Cant." inputMode="decimal" className={`${inputCls} w-20`} />
                        </div>
                        {it.cant > 0 && l && it.cant > Number(l.stock) && <div className="text-[11px] text-red-600">Supera el stock del lote ({fmtNum(l.stock)}).</div>}
                        <input value={it.extra} onChange={(e) => updItem(it.id, { extra: up(e.target.value) })} placeholder="Detalle adicional (opcional): precinto, calibre…" className={`${inputCls} text-xs`} />
                      </>
                    )}
                    {it.desc && <div className="text-[11px] text-stone-400">Se imprime: {it.desc} {it.kgu ? `· ${fmtNum(it.cant * it.kgu)} kg` : ""}</div>}
                  </div>
                );
              })}
              <button onClick={() => setItems((a) => [...a, itemVacio()])} className="text-emerald-700 text-sm font-medium">
                + Agregar ítem
              </button>
              <div className="flex items-center gap-3 text-xs text-stone-500">
                <span>Total unidades: <b>{fmtNum(totalUnidades)}</b></span>
                <label className="flex items-center gap-1">
                  Total kg:
                  <input value={remito.totalKgs} onChange={(e) => setRemito((r) => ({ ...r, totalKgs: e.target.value.replace(",", ".") }))} className="border border-stone-300 rounded px-1.5 py-0.5 w-24 text-sm" />
                </label>
              </div>
              <label className={labelCls}>
                Observaciones
                <textarea value={remito.observaciones} onChange={(e) => setRemito((r) => ({ ...r, observaciones: up(e.target.value) }))} rows={2} className={inputCls} />
              </label>
            </div>
          </fieldset>

          <details className={cardCls}>
            <summary className={`${titleCls} cursor-pointer`}>Calibración de impresión</summary>
            <p className="text-xs text-stone-400 mt-2">Se guarda en este navegador. Imprimí una prueba y ajustá hasta que el texto caiga sobre las líneas.</p>
            {[
              ["offsetX", "Desplazar horizontal (mm)", -10, 10, 0.5],
              ["offsetY", "Desplazar vertical (mm)", -10, 10, 0.5],
              ["fontSize", "Tamaño de letra (pt)", 7, 13, 0.5],
            ].map(([k, label, min, max, step]) => (
              <label key={k} className={`${labelCls} mt-2`}>
                {label}: {calibracion[k]}
                <input type="range" min={min} max={max} step={step} value={calibracion[k]} onChange={(e) => guardarCalibracion({ ...calibracion, [k]: Number(e.target.value) })} className="w-full" />
              </label>
            ))}
            {esAdmin && (
              <button
                onClick={async () => {
                  await supabase.from("configuracion").upsert({ clave: "calibracion_default", valor: calibracion });
                }}
                className="text-xs text-emerald-700 font-medium hover:underline mt-2"
              >
                Guardar como calibración predeterminada (para todos)
              </button>
            )}
          </details>

          {error && <div className="bg-red-50 border border-red-300 text-red-700 text-sm rounded p-3">{error}</div>}

          {!bloqueado && (
            <div className="flex gap-2">
              <button onClick={() => setMostrarPreview((v) => !v)} className="flex-1 bg-white border border-emerald-700 text-emerald-800 font-semibold py-3 rounded-lg hover:bg-emerald-50">
                {mostrarPreview ? "Ocultar vista previa" : "Vista previa"}
              </button>
              <button onClick={emitir} disabled={saving} className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-3 rounded-lg">
                {saving ? "Registrando…" : "Registrar e imprimir"}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 flex justify-center overflow-auto">
          <RemitoSheet d={datosHoja} calibracion={calibracion} visible={mostrarPreview} />
          {!mostrarPreview && (
            <div className="no-print text-stone-400 text-sm self-start mt-10">
              Tocá <span className="font-medium text-emerald-700">"Vista previa"</span> para ver el remito antes de imprimir.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
