import "./globals.css";

export const metadata = {
  title: "Remitos",
  description: "Generador de remitos",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
