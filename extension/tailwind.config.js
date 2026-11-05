import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(here, 'src/**/*.{ts,tsx,html}')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d4fe',
          500: '#4f6ef7',
          600: '#3b5bf6',
          700: '#2847e8',
        },
      },
      width: { popup: '380px' },
    },
  },
  plugins: [],
};
