import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#081327',
        panel: '#0f1d35',
        accent: '#3cf0d0',
        accentSoft: '#89f4e1',
      },
      boxShadow: {
        glow: '0 24px 80px rgba(60, 240, 208, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
