"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import Field from "@/components/Field";
import { supabase } from "@/lib/supabaseClient";
import { parseOrdenDeCarga } from "@/lib/parseOrdenDeCarga";
import {
  FIELD_COORDS,
  IVA_DEFAULT,
  CALIBRACION_DEFAULT,
  MODALIDADES,
  uid,
  todayParts,
} from "@/lib/fieldCoords";

function emptyRemito() {
  return {
    numero: "",
    fechaDD: todayParts().dd,
    fechaMM: todayParts().mm,
    fechaAA: todayParts().aa,
    destinatario: "",
    cuit: "",
    domicilio: "",
    iva: IVA_DEFAULT[0],
    entregarEn: "",
    transportistaId: "",
    transportista: "",
    transpCuit: "",
    transpDomicilio: "",
    chasis: "",
    acoplado: "",
    chofer: "",
    choferDni: "",
    items: [{ id: uid(), cantidad: "", descripcion: "" }],
    totalUnidades: "",
    totalKgs: "",
    observaciones: "",
  };
}

export default function GenerarPage() {
  return <AuthGuard>{(profile) => <GenerarInner profile={profile} />}</AuthGuard>;
}

function GenerarInner({ profile }) {
  const modalidadesPermitidas =
    profile?.modalidades && profile.modalidades.length ? profile.modalidades : ["soja", "maiz", "generico"];

  const [modalidad, setModalidad] = useState(modalidadesPermitidas[0]);
  const [ivaOptions, setIvaOptions] = useState(IVA_DEFAULT);
  const [transportistas, setTransportistas] = useState([]);
  const [calibracion, setCalibracion] = useState(CALIBRACION_DEFAULT);
  const [ocData, setOcData] = useState(null);
  const [clienteSel, setClienteSel] = useState("");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);
  const [remito, setRemito] = useState(emptyRemito());
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data: cfg } = await supabase.from("configuracion").select("*");
      if (cfg) {
        const iva = cfg.find((c) => c.clave === "iva_options");
        const cal = cfg.find((c) => c.clave === "calibracion_default");
        if (iva) setIvaOptions(iva.valor);
        if (cal) setCalibracion(cal.valor);
      }
      const { data: trans } = await supabase.from("transportistas").select("*").order("nombre");
      if (trans) setTransportistas(trans);
    })();
  }, []);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const parsed = parseOrdenDeCarga(rows);
        setOcData(parsed);
        setClienteSel("");
      } catch (err) {
        setParseError(err.message || "No pude leer el archivo.");
        setOcData(null);
      }
    };
    reader.readAsArrayBuffer(file);
    // El archivo nunca se sube ni se guarda: se procesa solo en el navegador.
  };

  const selectCliente = (nombreCliente) => {
    setClienteSel(nombreCliente);
    if (!ocData) return;
    const c = ocData.clientes.find((x) => x.cliente === nombreCliente);
    if (!c) return;
    const obs = [c.contacto ? `Contacto: ${c.contacto}` : "", c.telefono ? `Tel: ${c.telefono}` : ""]
      .filter(Boolean)
      .join(" — ");
    setRemito((r) => ({
      ...r,
      destinatario: c.cliente,
      cuit: String(c.cuit || ""),
      domicilio: String(c.domicilio || ""),
      entregarEn: String(c.entregarEn || ""),
      items: c.items.length ? c.items : [{ id: uid(), cantidad: "", descripcion: "" }],
      totalUnidades: String(c.totalCantidad || ""),
      totalKgs: String(c.totalKilos || ""),
      observaciones: obs,
    }));
  };

  useEffect(() => {
    const suma = remito.items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
    if (suma) setRemito((r) => ({ ...r, totalUnidades: String(suma) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(remito.items.map((i) => i.cantidad))]);

  const updateItem = (id, field, value) => {
    setRemito((r) => ({ ...r, items: r.items.map((it) => (it.id === id ? { ...it, [field]: value } : it)) }));
  };
  const addItem = () => setRemito((r) => ({ ...r, items: [...r.items, { id: uid(), cantidad: "", descripcion: "" }] }));
  const removeItem = (id) => setRemito((r) => ({ ...r, items: r.items.filter((it) => it.id !== id) }));

  const applyTransportista = (id) => {
    const t = transportistas.find((x) => x.id === id);
    if (!t) {
      setRemito((r) => ({ ...r, transportistaId: "" }));
      return;
    }
    setRemito((r) => ({
      ...r,
      transportistaId: id,
      transportista: t.nombre,
      transpCuit: t.cuit,
      transpDomicilio: t.domicilio,
      chasis: t.chasis,
      acoplado: t.acoplado,
      chofer: t.chofer,
      choferDni: t.dni,
    }));
  };

  const changeModalidad = (m) => {
    setModalidad(m);
    setOcData(null);
    setClienteSel("");
    setFileName("");
    setParseError("");
    setRemito(emptyRemito());
  };

  const registrarEImprimir = async () => {
    setSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await supabase.from("remitos_generados").insert({
      numero: remito.numero || "(sin registrar)",
      cliente: remito.destinatario || "(sin nombre)",
      modalidad,
      usuario_id: session?.user?.id,
      usuario_nombre: profile?.nombre || "",
      total_unidades: remito.totalUnidades,
      total_kgs: remito.totalKgs,
      fecha: `${remito.fechaDD}/${remito.fechaMM}/${remito.fechaAA}`,
    });
    setSaving(false);
    window.print();
  };

  const offset = { offsetX: calibracion.offsetX, offsetY: calibracion.offsetY };
  const fontSize = calibracion.fontSize;
  const visibleItems = remito.items.slice(0, 9);
  const rowH = (FIELD_COORDS.tablaBottom - FIELD_COORDS.tablaTop - 3) / Math.max(visibleItems.length, 6);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 flex flex-col">
      <NavBar profile={profile} />

      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6">
        <div className="no-print w-full lg:w-[420px] flex-shrink-0 space-y-5">
          <div className="bg-white rounded-lg border border-stone-200 p-4">
            <div className="text-xs font-semibold text-stone-500 uppercase mb-2">Modalidad</div>
            <div className="flex gap-2">
              {MODALIDADES.filter((m) => modalidadesPermitidas.includes(m.id)).map((m) => (
                <button
                  key={m.id}
                  onClick={() => changeModalidad(m.id)}
                  className={`flex-1 px-3 py-2 rounded text-sm font-medium border ${
                    modalidad === m.id
                      ? "bg-emerald-700 text-white border-emerald-700"
                      : "bg-white text-stone-600 border-stone-300 hover:border-emerald-400"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {modalidad !== "generico" && (
            <div className="bg-white rounded-lg border border-stone-200 p-4 space-y-3">
              <div className="text-xs font-semibold text-stone-500 uppercase">Orden de carga (Excel)</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-sm" />
              {fileName && <div className="text-xs text-stone-500">Archivo: {fileName} (no se guarda, solo se procesa)</div>}
              {parseError && <div className="text-xs text-red-600">{parseError}</div>}
              {ocData && (
                <div>
                  <div className="text-xs font-semibold text-stone-500 uppercase mt-2 mb-1">
                    Cliente ({ocData.clientes.length})
                  </div>
                  <select
                    value={clienteSel}
                    onChange={(e) => selectCliente(e.target.value)}
                    className="w-full border border-stone-300 rounded px-2 py-2 text-sm"
                  >
                    <option value="">Elegir cliente…</option>
                    {ocData.clientes.map((c) => (
                      <option key={c.cliente} value={c.cliente}>
                        {c.cliente} — {c.totalCantidad} u. / {c.totalKilos} kg
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg border border-stone-200 p-4 space-y-3">
            <div className="text-xs font-semibold text-stone-500 uppercase">Datos del remito</div>
            <label className="block text-xs text-stone-500">
              N° de remito impreso en la hoja (para registro, no se imprime)
              <input
                value={remito.numero}
                onChange={(e) => setRemito((r) => ({ ...r, numero: e.target.value }))}
                placeholder="0025-00000001"
                className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs text-stone-500">
              Condición de IVA del destinatario
              <select
                value={remito.iva}
                onChange={(e) => setRemito((r) => ({ ...r, iva: e.target.value }))}
                className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm"
              >
                {ivaOptions.map((op) => (
                  <option key={op}>{op}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="bg-white rounded-lg border border-stone-200 p-4 space-y-3">
            <div className="text-xs font-semibold text-stone-500 uppercase">Transportista</div>
            <select
              value={remito.transportistaId}
              onChange={(e) => applyTransportista(e.target.value)}
              className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Cargar manualmente…</option>
              {transportistas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>

          {modalidad === "generico" && (
            <div className="bg-white rounded-lg border border-stone-200 p-4 space-y-2">
              <div className="text-xs font-semibold text-stone-500 uppercase">Ítems</div>
              {remito.items.map((it) => (
                <div key={it.id} className="flex gap-2">
                  <input
                    value={it.cantidad}
                    onChange={(e) => updateItem(it.id, "cantidad", e.target.value)}
                    placeholder="Cant."
                    className="w-16 border border-stone-300 rounded px-2 py-1 text-sm"
                  />
                  <input
                    value={it.descripcion}
                    onChange={(e) => updateItem(it.id, "descripcion", e.target.value)}
                    placeholder="Descripción"
                    className="flex-1 border border-stone-300 rounded px-2 py-1 text-sm"
                  />
                  <button onClick={() => removeItem(it.id)} className="text-stone-400 hover:text-red-500 px-1">
                    ✕
                  </button>
                </div>
              ))}
              <button onClick={addItem} className="text-emerald-700 text-sm font-medium">
                + Agregar ítem
              </button>
              <label className="block text-xs text-stone-500 pt-2">
                Total kgs./lts.
                <input
                  value={remito.totalKgs}
                  onChange={(e) => setRemito((r) => ({ ...r, totalKgs: e.target.value }))}
                  className="mt-1 w-full border border-stone-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          )}

          <div className="bg-white rounded-lg border border-stone-200 p-4 space-y-3">
            <div className="text-xs font-semibold text-stone-500 uppercase">Calibración de impresión</div>
            <p className="text-xs text-stone-400 -mt-1">
              Imprimí una hoja de prueba, apoyala contra un remito en blanco a trasluz y ajustá los sliders
              hasta que el texto caiga sobre las líneas.
            </p>
            <label className="block text-xs text-stone-500">
              Desplazar horizontal (mm): {calibracion.offsetX}
              <input
                type="range"
                min={-10}
                max={10}
                step={0.5}
                value={calibracion.offsetX}
                onChange={(e) => setCalibracion((c) => ({ ...c, offsetX: Number(e.target.value) }))}
                className="w-full"
              />
            </label>
            <label className="block text-xs text-stone-500">
              Desplazar vertical (mm): {calibracion.offsetY}
              <input
                type="range"
                min={-10}
                max={10}
                step={0.5}
                value={calibracion.offsetY}
                onChange={(e) => setCalibracion((c) => ({ ...c, offsetY: Number(e.target.value) }))}
                className="w-full"
              />
            </label>
            <label className="block text-xs text-stone-500">
              Tamaño de letra (pt): {calibracion.fontSize}
              <input
                type="range"
                min={7}
                max={13}
                step={0.5}
                value={calibracion.fontSize}
                onChange={(e) => setCalibracion((c) => ({ ...c, fontSize: Number(e.target.value) }))}
                className="w-full"
              />
            </label>
            {profile?.rol === "admin" && (
              <button
                onClick={async () => {
                  await supabase
                    .from("configuracion")
                    .upsert({ clave: "calibracion_default", valor: calibracion });
                }}
                className="text-xs text-emerald-700 font-medium hover:underline"
              >
                Guardar como calibración predeterminada (para todos)
              </button>
            )}
          </div>

          <button
            onClick={registrarEImprimir}
            disabled={saving}
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-3 rounded-lg transition"
          >
            {saving ? "Registrando…" : "Registrar e imprimir remito"}
          </button>
        </div>

        <div className="flex-1 flex justify-center overflow-auto">
          <div className="print-page bg-white shadow-lg relative" style={{ width: "210mm", height: "297mm", flexShrink: 0 }}>
            <Field coords={FIELD_COORDS.fechaDD} offset={offset} fontSize={fontSize} align="center" value={remito.fechaDD} onChange={(e) => setRemito((r) => ({ ...r, fechaDD: e.target.value }))} />
            <Field coords={FIELD_COORDS.fechaMM} offset={offset} fontSize={fontSize} align="center" value={remito.fechaMM} onChange={(e) => setRemito((r) => ({ ...r, fechaMM: e.target.value }))} />
            <Field coords={FIELD_COORDS.fechaAA} offset={offset} fontSize={fontSize} align="center" value={remito.fechaAA} onChange={(e) => setRemito((r) => ({ ...r, fechaAA: e.target.value }))} />

            <Field coords={FIELD_COORDS.destinatario} offset={offset} fontSize={fontSize} value={remito.destinatario} onChange={(e) => setRemito((r) => ({ ...r, destinatario: e.target.value }))} />
            <Field coords={FIELD_COORDS.destCuit} offset={offset} fontSize={fontSize} value={remito.cuit} onChange={(e) => setRemito((r) => ({ ...r, cuit: e.target.value }))} />
            <Field coords={FIELD_COORDS.domicilio} offset={offset} fontSize={fontSize} value={remito.domicilio} onChange={(e) => setRemito((r) => ({ ...r, domicilio: e.target.value }))} />
            <Field coords={FIELD_COORDS.destIva} offset={offset} fontSize={fontSize} value={remito.iva} onChange={(e) => setRemito((r) => ({ ...r, iva: e.target.value }))} />
            <Field coords={FIELD_COORDS.entregarEn} offset={offset} fontSize={fontSize} value={remito.entregarEn} onChange={(e) => setRemito((r) => ({ ...r, entregarEn: e.target.value }))} />

            <Field coords={FIELD_COORDS.transportista} offset={offset} fontSize={fontSize} value={remito.transportista} onChange={(e) => setRemito((r) => ({ ...r, transportista: e.target.value }))} />
            <Field coords={FIELD_COORDS.transpCuit} offset={offset} fontSize={fontSize} value={remito.transpCuit} onChange={(e) => setRemito((r) => ({ ...r, transpCuit: e.target.value }))} />
            <Field coords={FIELD_COORDS.transpDomicilio} offset={offset} fontSize={fontSize} value={remito.transpDomicilio} onChange={(e) => setRemito((r) => ({ ...r, transpDomicilio: e.target.value }))} />
            <Field coords={FIELD_COORDS.chasis} offset={offset} fontSize={fontSize} value={remito.chasis} onChange={(e) => setRemito((r) => ({ ...r, chasis: e.target.value }))} />
            <Field coords={FIELD_COORDS.acoplado} offset={offset} fontSize={fontSize} value={remito.acoplado} onChange={(e) => setRemito((r) => ({ ...r, acoplado: e.target.value }))} />
            <Field coords={FIELD_COORDS.chofer} offset={offset} fontSize={fontSize} value={remito.chofer} onChange={(e) => setRemito((r) => ({ ...r, chofer: e.target.value }))} />
            <Field coords={FIELD_COORDS.choferDni} offset={offset} fontSize={fontSize} value={remito.choferDni} onChange={(e) => setRemito((r) => ({ ...r, choferDni: e.target.value }))} />

            {visibleItems.map((it, idx) => {
              const top = FIELD_COORDS.tablaTop + 2 + idx * rowH;
              return (
                <div key={it.id}>
                  <Field
                    coords={{ left: FIELD_COORDS.colCantidadLeft, top, width: FIELD_COORDS.colCantidadWidth, height: rowH }}
                    offset={offset}
                    fontSize={fontSize}
                    align="center"
                    value={String(it.cantidad ?? "")}
                    readOnly
                  />
                  <Field
                    coords={{ left: FIELD_COORDS.colDescLeft, top, width: FIELD_COORDS.colDescWidth, height: rowH }}
                    offset={offset}
                    fontSize={fontSize}
                    value={it.descripcion}
                    readOnly
                  />
                </div>
              );
            })}

            <Field coords={FIELD_COORDS.totalUnidades} offset={offset} fontSize={fontSize} align="center" value={remito.totalUnidades} onChange={(e) => setRemito((r) => ({ ...r, totalUnidades: e.target.value }))} />
            <Field coords={FIELD_COORDS.totalKgs} offset={offset} fontSize={fontSize} align="center" value={remito.totalKgs} onChange={(e) => setRemito((r) => ({ ...r, totalKgs: e.target.value }))} />
            <Field coords={FIELD_COORDS.observaciones} offset={offset} fontSize={fontSize} textarea value={remito.observaciones} onChange={(e) => setRemito((r) => ({ ...r, observaciones: e.target.value }))} />
          </div>
        </div>
      </div>
    </div>
  );
}
