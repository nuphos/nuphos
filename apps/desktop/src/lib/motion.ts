/**
 * Reads a motion-token duration (e.g. `--text-swap-dur`) in milliseconds so JS
 * timers stay in sync with the CSS. The production CSS minifier rewrites
 * `150ms` as `.15s`, so a bare parseFloat would read 0.15.
 */
export function cssDurationMs(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parsed = parseFloat(raw)

  if (!Number.isFinite(parsed)) return fallback

  return raw.endsWith('ms') ? parsed : parsed * 1000
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
