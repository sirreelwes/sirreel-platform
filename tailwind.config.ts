import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sirreel: {
          bg: '#0a0a0a',
          surface: '#111111',
          border: '#1a1a1a',
          'border-hover': '#2a2a2a',
          text: '#dddddd',
          'text-muted': '#666666',
          'text-dim': '#444444',
          accent: '#ffffff',
        },
        status: {
          available: '#22cc44',
          booked: '#6688ff',
          maintenance: '#ff6644',
          transit: '#ffaa22',
          warehouse: '#aa88ff',
          retired: '#666666',
        },
        tier: {
          vip: '#ffd700',
          preferred: '#4488ff',
          standard: '#888888',
          new: '#44cc66',
        },
        booking: {
          active: '#44ff44',
          confirmed: '#8888ff',
          pending: '#ffaa00',
          cancelled: '#666666',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
