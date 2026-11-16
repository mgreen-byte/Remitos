// Confirmación propia de la app (reemplaza a la ventana del navegador). Uso: if (!(await confirmar("¿Seguro?"))) return;
export function confirmar(mensaje, { aceptar = "Aceptar", cancelar = "Cancelar", peligro = false } = {}) {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const fondo = document.createElement("div");
    fondo.className = "no-print";
    fondo.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(15,23,20,.55);display:flex;align-items:center;justify-content:center;padding:16px;";
    const caja = document.createElement("div");
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-modal", "true");
    caja.style.cssText = "background:#fff;border-radius:12px;max-width:440px;width:100%;padding:20px 20px 16px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit;";
    const txt = document.createElement("div");
    txt.textContent = mensaje;
    txt.style.cssText = "font-size:15px;line-height:1.45;color:#1c1917;white-space:pre-wrap;";
    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:18px;";
    const bNo = document.createElement("button");
    bNo.type = "button";
    bNo.textContent = cancelar;
    bNo.style.cssText = "padding:8px 16px;border-radius:8px;border:1px solid #d6d3d1;background:#fff;color:#44403c;font-size:14px;cursor:pointer;";
    const bSi = document.createElement("button");
    bSi.type = "button";
    bSi.textContent = aceptar;
    bSi.style.cssText = `padding:8px 16px;border-radius:8px;border:0;background:${peligro ? "#b91c1c" : "#15803d"};color:#fff;font-size:14px;font-weight:600;cursor:pointer;`;
    const cerrar = (v) => { document.removeEventListener("keydown", tecla); fondo.remove(); resolve(v); };
    const tecla = (e) => { if (e.key === "Escape") cerrar(false); if (e.key === "Enter") cerrar(true); };
    bNo.onclick = () => cerrar(false);
    bSi.onclick = () => cerrar(true);
    fondo.onclick = (e) => { if (e.target === fondo) cerrar(false); };
    document.addEventListener("keydown", tecla);
    fila.append(bNo, bSi);
    caja.append(txt, fila);
    fondo.append(caja);
    document.body.append(fondo);
    bSi.focus();
  });
}
