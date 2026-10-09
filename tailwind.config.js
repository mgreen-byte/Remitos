/** @type {import('tailwindcss').Config} */
// PALETA DE MARCA: para cambiar los colores de toda la plataforma, editá los
// valores de "emerald" (color principal) y "stone" (grises) acá abajo.
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        emerald: {
          50: "#f0f6f3",
          100: "#e0ede7",
          200: "#c2dbd0",
          300: "#98c2b0",
          400: "#5f9f87",
          500: "#2f7a62",
          600: "#276a55",
          700: "#215a48",
          800: "#1b4a3b",
          900: "#143a2e",
        },
        stone: {
          50: "#f9faf9",
          100: "#f3f5f4",
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
