import rscPreset from '@readysetcloud/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [rscPreset],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@readysetcloud/ui/dist/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        // App convention: white/black resolve to the themed surface/foreground
        // so hardcoded bg-white/text-black stay correct in dark mode.
        white: 'rgb(var(--surface) / <alpha-value>)',
        black: 'rgb(var(--foreground) / <alpha-value>)',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      // fade-in and slide-up come from the preset; these are app-specific.
      animation: {
        'slide-down': 'slideDown 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
}
