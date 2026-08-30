# Remitos — Etapa 2

Sistema web de generación de remitos con login, roles (admin/operador) y
calibración de impresión sobre el papel preimpreso. El Excel de orden de
carga nunca se sube ni se guarda: se procesa en el navegador.

## 1. Crear las tablas en Supabase

1. Entrá al panel de tu proyecto en supabase.com.
2. Andá a **SQL Editor → New query**.
3. Pegá **todo** el contenido de `supabase/schema.sql` y tocá **Run**.

Esto crea las tablas, activa la seguridad por fila, y deja precargadas las
condiciones de IVA por defecto.

## 2. Configurar las variables de entorno

1. Copiá `.env.local.example` a un archivo nuevo llamado `.env.local`.
2. Completá los dos valores con los datos de tu proyecto (Supabase →
   **Settings → API**):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 3. Instalar y correr en tu compu

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000` en el navegador.

## 4. Crear tu primer usuario (vos, como admin)

1. Supabase → **Authentication → Users → Add user** (o "Invite").
2. Cargá tu email y una contraseña (o mandate la invitación por mail).
3. Iniciá sesión en la app con ese usuario. Vas a entrar como "operador"
   por defecto.
4. Para convertirte en admin: Supabase → **Table Editor → profiles**,
   buscá tu fila y cambiá la columna `rol` a `admin` a mano (solo esta
   primera vez — después ya podés hacerlo vos mismo desde el panel Admin
   de la app).

## 5. Crear al resto de los usuarios

Desde la app, pestaña **Admin**, vas a poder asignarle rol y modalidades
a cada usuario que invites — pero primero tenés que invitarlos desde
Supabase (**Authentication → Users → Invite user**). Apenas aceptan la
invitación, aparecen automáticamente en el panel Admin.

## 6. Desplegar (para que se use desde cualquier lado)

1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a vercel.com, conectá tu cuenta de GitHub e importá el repo.
3. En la configuración del proyecto en Vercel, agregá las mismas dos
   variables de entorno del paso 2.
4. Deploy. Vercel te da una URL pública (tipo `remitos-tuempresa.vercel.app`)
   accesible desde cualquier celular o compu.

## Estructura del proyecto

```
app/
  login/          → inicio de sesión
  generar/        → pantalla principal: Excel, cliente, calco, impresión
  historial/      → remitos generados
  admin/          → IVA, transportistas, calibración, usuarios
lib/
  supabaseClient.js     → conexión a Supabase
  fieldCoords.js        → coordenadas del calco + constantes compartidas
  parseOrdenDeCarga.js  → lector del Excel (soja/maíz)
components/
  AuthGuard.js    → protege páginas según sesión/rol
  NavBar.js       → barra superior
  Field.js        → campo posicionado sobre el remito
supabase/
  schema.sql      → tablas + seguridad por fila
```
