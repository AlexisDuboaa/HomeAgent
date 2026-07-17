/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: {
          primary: '#0D0D17',
          card: '#1C1C2A',
          hover: '#242436',
          sidebar: '#111118',
        },
        accent: {
          orange: '#FFB347',
          'orange-dark': '#FF6B35',
          blue: '#60A5FA',
          purple: '#A78BFA',
          green: '#34D399',
        },
        text: {
          primary: '#FFFFFF',
          secondary: '#888899',
          muted: '#555566',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
