import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'

export const THEME_NAME = 'nuphos-code'

// Monaco themes need concrete hex colors, not the `rgb(var(--…))` expressions
// the rest of the app uses. Resolve each expression against the live DOM so the
// editor tracks the active light/dark palette (the variables flip on
// `html.light`) without maintaining a second copy of the colors here.
function resolveCssColor(expr: string): string {
  const probe = document.createElement('span')

  probe.style.color = expr
  probe.style.position = 'absolute'
  probe.style.opacity = '0'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color // "rgb(r, g, b)" / "rgba(r, g, b, a)"

  probe.remove()

  return rgbToHex(computed)
}

function rgbToHex(color: string): string {
  const open = color.indexOf('(')
  const close = color.lastIndexOf(')')

  if (open === -1 || close <= open + 1) return '#000000'
  const parts = color
    .slice(open + 1, close)
    .split(',')
    .map((p) => p.trim())
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const [r, g, b] = parts.slice(0, 3).map((p) => parseInt(p, 10))
  let hex = `#${byte(r)}${byte(g)}${byte(b)}`

  if (parts[3] !== undefined) hex += byte(parseFloat(parts[3]) * 255)

  return hex
}

function buildThemeData(): monaco.editor.IStandaloneThemeData {
  const isLight = document.documentElement.classList.contains('light')
  // Token rule colors are hex WITHOUT the leading '#'; `colors` entries keep it.
  const tok = (expr: string) => resolveCssColor(expr).slice(1, 7)

  return {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: tok('rgb(var(--color-text-secondary))') },
      // Mapping keys (`foo:`) — the most useful signal when scanning a manifest.
      { token: 'type', foreground: tok('rgb(var(--color-zViolet-accent))') },
      { token: 'string', foreground: tok('rgb(var(--color-success))') },
      { token: 'number', foreground: tok('rgb(var(--color-warning))') },
      { token: 'keyword', foreground: tok('rgb(var(--color-zOrangered-500))') },
      { token: 'comment', foreground: tok('rgb(var(--color-text-tertiary))'), fontStyle: 'italic' },
      { token: 'tag', foreground: tok('rgb(var(--color-warning))') },
      { token: 'operators', foreground: tok('rgb(var(--color-text-tertiary))') },
      { token: 'delimiter', foreground: tok('rgb(var(--color-text-tertiary))') },
    ],
    colors: {
      'editor.background': resolveCssColor('rgb(var(--color-zGray-950))'),
      'editor.foreground': resolveCssColor('rgb(var(--color-text-secondary))'),
      'editorGutter.background': resolveCssColor('rgb(var(--color-zGray-950))'),
      'editorLineNumber.foreground': resolveCssColor('rgb(var(--color-text-tertiary))'),
      'editorLineNumber.activeForeground': resolveCssColor('rgb(var(--color-text-secondary))'),
      'editor.lineHighlightBackground': resolveCssColor('rgba(var(--color-zGray-800), 0.35)'),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': resolveCssColor('rgba(var(--color-zViolet-400), 0.30)'),
      'editorCursor.foreground': resolveCssColor('rgb(var(--color-text-base))'),
      'editorBracketMatch.background': resolveCssColor('rgba(var(--color-zViolet-400), 0.25)'),
      'editorBracketMatch.border': '#00000000',
      'editor.findMatchBackground': resolveCssColor('rgba(var(--color-zViolet-accent), 0.55)'),
      'editor.findMatchHighlightBackground': resolveCssColor(
        'rgba(var(--color-zViolet-400), 0.26)',
      ),
      'editorWidget.background': resolveCssColor('rgb(var(--color-zGray-900))'),
      'editorWidget.border': resolveCssColor('rgb(var(--color-zGray-800))'),
      'input.background': resolveCssColor('rgb(var(--color-zGray-950))'),
      'input.border': resolveCssColor('rgb(var(--color-zGray-700))'),
    },
  }
}

export function applyTheme() {
  monaco.editor.defineTheme(THEME_NAME, buildThemeData())
  monaco.editor.setTheme(THEME_NAME)
}
