/** @type {import('tailwindcss').Config} */
// MARCA (Brand Manual Stine 2023): colores y tipografías de toda la plataforma.
// emerald = verde Stine · sky = azul Stine · amber = dorado · ink = verde oscuro (menú) · stone = grises cálidos.
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Tipografías del manual de marca Stine 2023: Montserrat (textos) y Oswald (títulos y subtítulos).
      // Abolition W00 (títulos destacados) es una fuente paga: mientras no esté, los títulos usan Oswald.
      fontFamily: {
        sans: ["Montserrat", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Abolition W00"', "Oswald", "Montserrat", "sans-serif"],
        titulo: ["Oswald", "Montserrat", "sans-serif"],
      },
      // Paleta del manual de marca Stine 2023.
      colors: {
        // Verde Stine (PANTONE 355 C, #009D57) = 600
        emerald: {
          50: "#eaf7f0",
          100: "#cdeedb",
          200: "#9bdcb8",
          300: "#5fc690",
          400: "#24b06d",
          500: "#0aa864",
          600: "#009D57",
          700: "#008249",
          800: "#00663a",
          900: "#004d2c",
        },
        // Azul Stine (PANTONE 286 C, #005FAE) = 700
        sky: {
          50: "#eaf2fb",
          100: "#d0e3f6",
          200: "#a2c6ed",
          300: "#6ea5e0",
          400: "#3a84d0",
          500: "#0f6fc0",
          600: "#0066b8",
          700: "#005FAE",
          800: "#004c8b",
          900: "#003a6b",
        },
        // Dorado de la paleta secundaria (PANTONE 142 C, #DFB062) = 400; se usa para avisos
        amber: {
          50: "#fcf7ec",
          100: "#f8ecd2",
          200: "#f1d9a6",
          300: "#e8c47c",
          400: "#DFB062",
          500: "#c9973f",
          600: "#a87a2c",
          700: "#855f22",
          800: "#6a4c1d",
          900: "#4f3916",
        },
        // Fondo del menú lateral: verde muy oscuro (el de antes, mejor contraste)
        ink: {
          700: "#1c3326",
          800: "#14281d",
          900: "#0c1812",
        },
        // Grises cálidos, con el negro de marca (PROCESS BLACK C, #231F20) = 900
        stone: {
          50: "#f8f7f4",
          100: "#f1efea",
          200: "#e5e2db",
          300: "#d1ccc2",
          400: "#a39d92",
          500: "#77716a",
          600: "#5a5550",
          700: "#433f3c",
          800: "#2f2b2a",
          900: "#231F20",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(24, 32, 29, 0.04), 0 4px 16px rgba(24, 32, 29, 0.04)",
      },
    },
  },
  plugins: [],
};
