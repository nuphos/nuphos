// Pure color helpers for the palette tool. `resolveCssColor` / `rgbToHex` are
// copied (not imported) from src/components/YamlEditor.tsx — importing that
// module would pull Monaco into this dev-only bundle.

export function resolveCssColor(expr: string): string {
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

export function rgbToHex(color: string): string {
  const open = color.indexOf('(')
  const close = open === -1 ? -1 : color.indexOf(')', open + 1)

  if (close === -1 || close === open + 1) return '#000000'
  const parts = color
    .slice(open + 1, close)
    .split(/[\s,/]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const [r, g, b] = parts.slice(0, 3).map((p) => parseInt(p, 10))
  let hex = `#${byte(r)}${byte(g)}${byte(b)}`

  if (parts[3] !== undefined) hex += byte(parseFloat(parts[3]) * 255)

  return hex
}

export type Rgba = {
  r: number
  g: number
  b: number
  a: number
}

// Parse an `rgb(...)` / `rgba(...)` string. Tolerates comma- and space/slash-
// separated forms ("28, 29, 31" and "28 29 31 / 0.5").
export function parseRgbFunc(str: string): Rgba | null {
  const m = /rgba?\(([^)]+)\)/i.exec(str)

  if (!m) return null
  const parts = m[1]
    .split(/[\s,/]+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length < 3) return null
  const r = parseFloat(parts[0])
  const g = parseFloat(parts[1])
  const b = parseFloat(parts[2])
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1

  if ([r, g, b].some((n) => Number.isNaN(n))) return null

  return { r, g, b, a: Number.isNaN(a) ? 1 : a }
}

// Canonical "r, g, b" key for reverse-mapping a computed color to a token.
// Returns null when the color is opacity-modified (alpha < 1) — those usages
// (e.g. `bg-main/50`) can't match an opaque token triple, so we don't guess.
export function normalizeComputedRgb(str: string): string | null {
  const c = parseRgbFunc(str)

  if (!c) return null
  if (c.a < 0.999) return null

  return `${String(Math.round(c.r))}, ${String(Math.round(c.g))}, ${String(Math.round(c.b))}`
}

export function hexToTriple(hex: string): string | null {
  const m = hex.trim().replace(/^#/, '')

  if (!/^[0-9a-fA-F]{3}$/.test(m) && !/^[0-9a-fA-F]{6}$/.test(m)) return null
  const full =
    m.length === 3
      ? m
          .split('')
          .map((c) => c + c)
          .join('')
      : m
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)

  return `${String(r)}, ${String(g)}, ${String(b)}`
}

// "25, 24, 27" → "#19181B". Returns null for non-triple values.
export function tripleToHex(triple: string): string | null {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(triple)

  if (!m) return null
  const byte = (n: string) =>
    Math.max(0, Math.min(255, parseInt(n, 10)))
      .toString(16)
      .padStart(2, '0')

  return `#${byte(m[1])}${byte(m[2])}${byte(m[3])}`
}
