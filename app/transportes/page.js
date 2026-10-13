"use client";

import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import Directorio from "@/components/Directorio";

export default function TransportesPage() {
  return (
    <AuthGuard roles={["admin"]}>
      {(profile) => (
        <NavBar profile={profile}>
          <Directorio
            table="transportistas"
            titulo="Transportes"
            singular="Transporte"
            profile={profile}
            ayuda="Maestro de empresas de transporte, compartido por todas las plantas. Las plantas pueden dar de alta una nueva desde el remito; solo el administrador edita y borra."
            vacioTexto="Todavía no hay transportes cargados."
            claveUnica="cuit"
            columns={[
              { key: "nombre", label: "Nombre o razón social", upper: true, required: true, span: 2, ejemplo: "TRANSPORTES EJEMPLO SRL", aliases: ["nombre", "razon social", "nombre razon social", "transportista", "transporte", "empresa", "razon social transportista"] },
              { key: "cuit", label: "CUIT", digits: 11, exact: true, format: "cuit", placeholder: "11 dígitos, sin guiones", ejemplo: "30-12345678-9", aliases: ["cuit", "c u i t", "cuit transportista", "cuit transporte"] },
              { key: "domicilio", label: "Domicilio", upper: true, span: 3, ejemplo: "RUTA 9 KM 100 - ROSARIO", aliases: ["domicilio", "direccion", "domicilio transportista"] },
            ]}
          />
        </NavBar>
      )}
    </AuthGuard>
  );
}
