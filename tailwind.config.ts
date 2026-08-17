import type { Config } from 'tailwindcss';

/**
 * Sentinel Memory design tokens.
 * Dark "emergency command center" palette — amber for warnings, red reserved
 * strictly for critical hazards, teal/green for safe & completed states.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#07111F',
        panel: '#0D1B2A',
        panel2: '#112235',
        edge: '#24364B',
        ink: '#F4F7FA',
        muted: '#93A4B8',
        warn: '#F59E0B',
        critical: '#EF4444',
        success: '#10B981',
        info: '#38BDF8',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        knob: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      keyframes: {
        pulseRing: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 2.4s ease-in-out infinite',
        riseIn: 'riseIn 220ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
