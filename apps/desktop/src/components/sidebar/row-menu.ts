/** Keys that press a row's More button, as they would a native button. */
export function opensRowMenu(key: string): boolean {
  return key === 'Enter' || key === ' '
}

/** Where the row menu opens: under the button, lined up with its left edge. */
export function rowMenuAnchor(rect: Pick<DOMRect, 'left' | 'bottom'>): {
  clientX: number
  clientY: number
} {
  return { clientX: rect.left, clientY: rect.bottom }
}
