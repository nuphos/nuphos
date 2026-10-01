import containerQueries from '@tailwindcss/container-queries'

/** @type {import('tailwindcss').Config} */
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue) {
      return `rgba(var(${variableName}), ${opacityValue})`
    }
    return `rgb(var(${variableName}))`
  }
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './node_modules/@streamdown/code/dist/*.js'],
  darkMode: 'selector',
  theme: {
    extend: {
      colors: {
        zGray: {
          50: withOpacity('--color-zGray-50'),
          100: withOpacity('--color-zGray-100'),
          150: withOpacity('--color-zGray-150'),
          200: withOpacity('--color-zGray-200'),
          250: withOpacity('--color-zGray-250'),
          300: withOpacity('--color-zGray-300'),
          400: withOpacity('--color-zGray-400'),
          500: withOpacity('--color-zGray-500'),
          600: withOpacity('--color-zGray-600'),
          700: withOpacity('--color-zGray-700'),
          750: withOpacity('--color-zGray-750'),
          800: withOpacity('--color-zGray-800'),
          850: withOpacity('--color-zGray-850'),
          900: withOpacity('--color-zGray-900'),
          950: withOpacity('--color-zGray-950'),
        },
        zViolet: {
          50: withOpacity('--color-zViolet-50'),
          100: withOpacity('--color-zViolet-100'),
          200: withOpacity('--color-zViolet-200'),
          300: withOpacity('--color-zViolet-300'),
          400: withOpacity('--color-zViolet-400'),
          500: withOpacity('--color-zViolet-500'),
          600: withOpacity('--color-zViolet-600'),
          700: withOpacity('--color-zViolet-700'),
          800: withOpacity('--color-zViolet-800'),
          900: withOpacity('--color-zViolet-900'),
          950: withOpacity('--color-zViolet-950'),
          accent: withOpacity('--color-zViolet-accent'),
        },
        zOrangered: {
          400: withOpacity('--color-zOrangered-400'),
          500: withOpacity('--color-zOrangered-500'),
          600: withOpacity('--color-zOrangered-600'),
          700: withOpacity('--color-zOrangered-700'),
        },
        zBlue: {
          400: withOpacity('--color-zBlue-400'),
          500: withOpacity('--color-zBlue-500'),
          600: withOpacity('--color-zBlue-600'),
          700: withOpacity('--color-zBlue-700'),
          accent: withOpacity('--color-zBlue-accent'),
          hover: withOpacity('--color-zBlue-hover'),
          active: withOpacity('--color-zBlue-active'),
        },
        success: withOpacity('--color-success'),
        error: withOpacity('--color-error'),
        warning: withOpacity('--color-warning'),
      },
      textColor: {
        main: withOpacity('--color-text-base'),
        secondary: withOpacity('--color-text-secondary'),
        tertiary: withOpacity('--color-text-tertiary'),
      },
      borderColor: {
        main: withOpacity('--color-border'),
      },
      backgroundColor: {
        main: withOpacity('--color-background-base'),
        surface: withOpacity('--color-background-surface'),
        elevated: withOpacity('--color-background-elevated'),
        appBg: withOpacity('--color-appBg'),
        field: withOpacity('--color-input-surface'),
        agentCanvas: withOpacity('--color-agent-canvas'),
        composer: withOpacity('--color-composer-surface'),
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [containerQueries],
}
