/** @type {import('tailwindcss').Config} */
// PALETA DE MARCA: para cambiar los colores de toda la plataforma, editá los
// valores de "emerald" (verde Stine #15964B) e "ink" (fondo oscuro del menú) y "stone" (grises) acá abajo.
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        emerald: {
          50: "#eefaf2",
          100: "#d5f2de",
          200: "#aee5c0",
          300: "#78d196",
          400: "#3fb86a",
          500: "#1fa458",
          600: "#15964b",
          700: "#117a3e",
          800: "#0f6033",
          900: "#0d4a29",
        },
        ink: {
          700: "#1c3326",
          800: "#14281d",
          900: "#0c1812",
        },
        stone: {
          50: "#f6faf7",
          100: "#eef3ef",
          200: "#e6eae8",
          300: "#d3dad7",
          400: "#9ba7a2",
          500: "#6a7873",
          600: "#4e5b56",
          700: "#38433f",
          800: "#26302d",
          900: "#18201d",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(24, 32, 29, 0.04), 0 4px 16px rgba(24, 32, 29, 0.04)",
      },
    },
  },
  plugins: [],
};
