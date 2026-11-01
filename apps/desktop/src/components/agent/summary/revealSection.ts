/**
 * Scrolls a section into view, as when a badge opens the panel on it, and
 * focuses its chosen filter or else its first button.
 */
export function revealSection(section: HTMLElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const target =
    section.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
    section.querySelector<HTMLElement>('button')

  section.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  target?.focus({ preventScroll: true })
}
