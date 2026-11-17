import "./globals.css";

export const metadata = {
  title: "Despacho y Stock",
  description: "Remitos, stock y traslados",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Montserrat y Oswald: tipografías de marca. Instrument Sans: solo para el remito impreso sobre el preimpreso. */}
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Oswald:wght@400;500;600&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
