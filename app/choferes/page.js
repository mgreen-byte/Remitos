"use client";

import AuthGuard from "@/components/AuthGuard";
import NavBar from "@/components/NavBar";
import Directorio from "@/components/Directorio";

export default function ChoferesPage() {
  return (
    <AuthGuard>
      {(profile) => (
        <NavBar profile={profile}>
          <Directorio
            table="choferes"
            titulo="Choferes"
            singular="Chofer"
            profile={profile}
            ayuda="Choferes con las patentes de su camión, compartidos por todas las plantas. El CUIL no se puede repetir."
            vacioTexto="Todavía no hay choferes cargados."
            columns={[
              { key: "nombre", label: "Nombre y apellido", upper: true, required: true, span: 2 },
              { key: "dni", label: "CUIL", digits: 11, exact: true, required: true, format: "cuit", placeholder: "11 dígitos, sin guiones" },
              { key: "chasis", label: "Patente chasis", upper: true },
              { key: "acoplado", label: "Patente acoplado", upper: true },
            ]}
          />
        </NavBar>
      )}
    </AuthGuard>
  );
}
