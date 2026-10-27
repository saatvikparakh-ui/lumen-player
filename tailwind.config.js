/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lumen: {
          bg: '#080A10',
          panel: '#111521',
          panelHover: '#171D2F',
          surface: '#1A2135',
          border: '#232D48',
          borderSubtle: '#161E33',
          cyan: '#63E8FF',
          violet: '#9A76FF',
          text: '#F1F4FC',
          textMuted: '#9AA5BA',
          textDim: '#5B6882'
        }
      },
      boxShadow: {
        'led-cyan': '0 0 15px -2px rgba(99, 232, 255, 0.45)',
        'led-cyan-lg': '0 0 25px 0px rgba(99, 232, 255, 0.55)',
        'led-violet': '0 0 15px -2px rgba(154, 118, 255, 0.45)',
        'panel': '0 10px 30px -10px rgba(0, 0, 0, 0.7)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        syne: ['Syne', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
