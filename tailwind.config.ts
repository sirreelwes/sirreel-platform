import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sirreel: {
          bg: '#f5f5f7',
          surface: '#ffffff',
          border: '#e2e2e8',
          'border-hover': '#ccccdd',
          text: '#1a1a2e',
          'text-muted': '#5c5c78',
          'text-dim': '#8888a0',
          accent: '#000000',
        },
        status: { available: '#16a34a', booked: '#4466dd', maintenance: '#dc2626', transit: '#d97706', warehouse: '#7c3aed', retired: '#999999' },
        tier: { vip: '#b8860b', preferred: '#2563eb', standard: '#666666', new: '#16a34a' },
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
export default config;
