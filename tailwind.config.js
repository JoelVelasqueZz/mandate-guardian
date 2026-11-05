/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paypal: {
          navy: "#001C64",
          dark: "#002C8A",
          blue: "#003087",
          vibrant: "#0070BA",
          light: "#EAF3FB",
          surface: "#F5F9FD",
          gold: "#FFC439",
          goldHover: "#F2BA36",
        },
        channel3: {
          dark: "#090D16",
          slate: "#0F172A",
          card: "#131C2E",
          border: "#1E293B",
          accent: "#6366F1",
          accentLight: "#EEF2FF",
          accentHover: "#4F46E5",
          cyan: "#06B6D4",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'soft': '0 2px 10px rgba(0, 28, 100, 0.04), 0 1px 3px rgba(0, 0, 0, 0.03)',
        'card': '0 4px 20px -2px rgba(0, 28, 100, 0.06), 0 2px 6px -1px rgba(0, 0, 0, 0.04)',
        'elevated': '0 20px 25px -5px rgba(0, 28, 100, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
};

