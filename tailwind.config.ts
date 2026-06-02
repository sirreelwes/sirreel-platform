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
        // ── Light-theme tokens (additive). Pilot on /jobs in this
        //    commit; intended to roll out app-wide in later commits.
        //    Naming: `lt-*` for the core surface/text palette,
        //    `pill-*` for Job-status pills, `chip-*` for sub-row chips.
        //    Existing sirreel/status/tier namespaces are untouched so
        //    no current consumer regresses.
        lt: {
          page:     '#F5F6F8',
          card:     '#FFFFFF',
          hairline: '#E7E9ED',
          inner:    '#EEF0F3',
          inner2:   '#F1F2F4',
          fg:       '#16191D', // primary text + primary CTA bg
          fg2:      '#687078', // secondary text
          fg3:      '#9CA3AD', // muted / mono / placeholder
        },
        pill: {
          'quoted-bg':  '#EEEDFE', 'quoted-fg':  '#3C3489',
          'active-bg':  '#E1F5EE', 'active-fg':  '#0F6E56',
          'hold-bg':    '#FAEEDA', 'hold-fg':    '#633806',
          'wrapped-bg': '#F1EFE8', 'wrapped-fg': '#444441',
          'lost-bg':    '#FCEBEB', 'lost-fg':    '#791F1F',
        },
        chip: {
          'neutral-bg':    '#F1EFE8', 'neutral-fg':    '#444441',
          'good-bg':       '#EAF3DE', 'good-fg':       '#27500A',
          'warn-bg':       '#FAEEDA', 'warn-fg':       '#633806',
          'bad-bg':        '#FCEBEB', 'bad-fg':        '#791F1F',
          'muted-fg':      '#888780',
          'muted-border':  '#D3D1C7',
        },
        // Operational cadence palette — temperature scheme keyed on
        // event timing: outbound blue (cool, future) → on-rental green
        // → inbound amber/orange (warming as return-day approaches) →
        // returned purple → invoiced teal → wrapped grey. The `-bar`
        // tone is the saturated edge color, `-bg/-fg` is the tinted
        // pill label. `pre-bar` is the single muted grey for the pre-
        // booked Job states (Quoted / Hold / Lost) which keep their
        // existing pill colors via the `pill.*` namespace.
        cadence: {
          'booked-bg':           '#DBEAFE', 'booked-fg':           '#1E3A8A', 'booked-bar':           '#3B82F6',
          'picking-tmw-bg':      '#BFDBFE', 'picking-tmw-fg':      '#1E3A8A', 'picking-tmw-bar':      '#2563EB',
          'picking-today-bg':    '#C7D2FE', 'picking-today-fg':    '#1E1B4B', 'picking-today-bar':    '#4338CA',
          'on-rental-bg':        '#D1FAE5', 'on-rental-fg':        '#065F46', 'on-rental-bar':        '#10B981',
          'returning-tmw-bg':    '#FEF3C7', 'returning-tmw-fg':    '#78350F', 'returning-tmw-bar':    '#F59E0B',
          'returning-today-bg':  '#FFEDD5', 'returning-today-fg':  '#7C2D12', 'returning-today-bar':  '#F97316',
          'returned-bg':         '#F3E8FF', 'returned-fg':         '#581C87', 'returned-bar':         '#A855F7',
          'invoiced-bg':         '#CCFBF1', 'invoiced-fg':         '#134E4A', 'invoiced-bar':         '#0F766E',
          'wrapped-bg':          '#F1EFE8', 'wrapped-fg':          '#444441', 'wrapped-bar':          '#9CA3AF',
          'pre-bar':             '#9CA3AF',
        },
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
export default config;
