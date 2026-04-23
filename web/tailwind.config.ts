import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // LumaScout luxury dark palette
        bg: '#0A0A0A',
        surface: {
          1: '#141416',
          2: '#1C1C1F',
          3: '#26262B',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.08)',
          strong: 'rgba(255,255,255,0.14)',
        },
        ink: {
          DEFAULT: '#F5F5F7',
          muted: '#A1A1AA',
          dim: '#6B6B72',
        },
        brand: {
          DEFAULT: '#F5A623',
          600: '#E49520',
          700: '#C67F1A',
          50: 'rgba(245,166,35,0.08)',
          ring: 'rgba(245,166,35,0.35)',
        },
        success: '#7BC47F',
        danger: '#FF5F56',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Playfair Display', 'serif'],
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.02em',
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -20px rgba(0,0,0,0.6)',
        lift: '0 20px 60px -30px rgba(245,166,35,0.35)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #F5A623 0%, #E06400 100%)',
        'radial-spot': 'radial-gradient(ellipse at top, rgba(245,166,35,0.10), transparent 60%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out both',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.21,0.61,0.35,1) both',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};

export default config;
