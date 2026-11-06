import containerQueries from '@tailwindcss/container-queries'

import { tokenColors, tokenVariables } from '../../packages/design-tokens/src/tailwind.mjs'

/** @type {import('tailwindcss').Config} */
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue) {
      return `rgba(var(${variableName}), ${opacityValue})`
    }
    return `rgb(var(${variableName}))`
  }
}

// Text tokens live under textColor, so classes read `text-primary`, not `text-text-primary`.
const { text: textTokens, ...colorTokens } = tokenColors()

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './node_modules/streamdown/dist/*.js'],
  darkMode: 'selector',
  theme: {
    extend: {
      colors: {
        // Semantic tokens from packages/design-tokens (#1632).
        ...colorTokens,
        surface: {
          ...colorTokens.surface,
          // Legacy `bg-surface`, kept as the group default until it is migrated.
          DEFAULT: withOpacity('--color-background-surface'),
        },
        success: withOpacity('--color-success'),
        error: withOpacity('--color-error'),
        warning: withOpacity('--color-warning'),
      },
      textColor: {
        ...textTokens,
        // Legacy `text-main`, the same color as `text-primary`.
        main: withOpacity('--color-text-base'),
        slack: withOpacity('--color-slack-text'),
      },
      borderColor: {
        main: withOpacity('--color-border'),
      },
      backgroundColor: {
        main: withOpacity('--color-background-base'),
        elevated: withOpacity('--color-background-elevated'),
        appBg: withOpacity('--color-appBg'),
        agentCanvas: withOpacity('--color-agent-canvas'),
        composer: withOpacity('--color-composer-surface'),
        heatmap: {
          0: withOpacity('--color-heatmap-0'),
          1: withOpacity('--color-heatmap-1'),
          2: withOpacity('--color-heatmap-2'),
          3: withOpacity('--color-heatmap-3'),
          4: withOpacity('--color-heatmap-4'),
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [
    containerQueries,
    // Desktop defaults to dark on <html> and switches with `html.light`.
    ({ addBase }) => addBase(tokenVariables({ light: 'html.light', dark: 'html' })),
  ],
}
