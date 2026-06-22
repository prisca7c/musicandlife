import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        sage: {
          50:  '#EBF5EE',
          100: '#D6EBE0',
          200: '#A8D4B8',
          300: '#78C096',
          400: '#5BA97A',
          500: '#4A9067',
          600: '#3D7A55',
          700: '#2A5A3D',
          800: '#1E4230',
          900: '#142B20',
          DEFAULT: '#3D7A55',
        },
        coral: {
          50:  '#FEE2E2',
          100: '#FECACA',
          400: '#F05050',
          500: '#E03030',
          600: '#C0392B',
          DEFAULT: '#C0392B',
        },
        'sky-brand': {
          50:  '#EBF4FF',
          200: '#90BEF0',
          600: '#2B6CB0',
          DEFAULT: '#2B6CB0',
        },
        plum: {
          50:  '#EDE9FE',
          200: '#C4B5FD',
          600: '#5B3F9E',
          DEFAULT: '#5B3F9E',
        },
        'amber-brand': {
          50:  '#FEF3C7',
          200: '#F5C76A',
          600: '#B45309',
          DEFAULT: '#B45309',
        },
        'app-bg': '#F0F4F8',
      },
    },
  },
  plugins: [],
};

export default config;
