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
            claveUnica="dni"
            columns={[
              { key: "nombre", label: "Nombre y apellido", upper: true, required: true, span: 2, ejemplo: "PEREZ JUAN", aliases: ["nombre", "chofer", "apellido y nombre", "nombre del chofer", "conductor"] },
              { key: "dni", label: "CUIL", digits: 11, exact: true, required: true, format: "cuit", placeholder: "11 dígitos, sin guiones", ejemplo: "20-12345678-3", aliases: ["cuil", "dni", "cuil dni", "c u i l", "documento", "cuil chofer"] },
              { key: "chasis", label: "Patente chasis", upper: true, compact: true, ejemplo: "AB123CD", aliases: ["chasis", "patente", "patente chasis", "dominio", "patente tractor", "tractor"] },
              { key: "acoplado", label: "Patente acoplado", upper: true, compact: true, ejemplo: "AC456DE", aliases: ["acoplado", "patente acoplado", "semi", "semirremolque", "patente semi"] },
            ]}
          />
        </NavBar>
      )}
    </AuthGuard>
  );
}
