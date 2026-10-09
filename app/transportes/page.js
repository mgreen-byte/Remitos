"use client";

import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import Directorio from "@/components/Directorio";

export default function TransportesPage() {
  return (
    <AuthGuard>
      {(profile) => (
        <NavBar profile={profile}>
          <Directorio
            table="transportistas"
            titulo="Transportes"
            singular="Transporte"
            profile={profile}
            ayuda="Empresas de transporte compartidas por todas las plantas. Si falta una, agregala acá o desde el remito y queda disponible para todos."
            vacioTexto="Todavía no hay transportes cargados."
            columns={[
              { key: "nombre", label: "Nombre o razón social", upper: true, required: true, span: 2 },
              { key: "cuit", label: "CUIT", digits: 11, exact: true, format: "cuit", placeholder: "11 dígitos, sin guiones" },
              { key: "domicilio", label: "Domicilio", upper: true, span: 3 },
            ]}
          />
        </NavBar>
      )}
    </AuthGuard>
  );
}
