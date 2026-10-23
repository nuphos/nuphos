export type DecisionKey = { kind: 'approve' } | { kind: 'deny' } | { kind: 'option'; index: number }

/**
 * Keys for the card waiting on the user: ⌘↵ approves, ⌘⌫ denies, ⌥⌘1–⌥⌘9 pick
 * an option. While the focused box holds text, ⌘⌫ keeps deleting.
 */
export function decisionKey(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
  >,
  mac: boolean,
  typing: boolean,
): DecisionKey | null {
  if (event.isComposing || event.shiftKey) return null
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

  if (!mod) return null
  if (!event.altKey) {
    if (event.key === 'Enter') return { kind: 'approve' }
    if (event.key === 'Backspace' && !typing) return { kind: 'deny' }

    return null
  }
  // The physical key, since ⌥ alone types characters on many layouts. Off macOS
  // Ctrl+Alt is AltGr there, so the key must still read as the digit.
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1]

  if (!digit || (!mac && event.key !== digit)) return null

  return { kind: 'option', index: Number(digit) - 1 }
}

/** Whether the focused element is a text box that already holds text. */
export function focusedBoxHasText(active: Element | null): boolean {
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.value !== ''
  }

  return active instanceof HTMLElement && active.isContentEditable && active.textContent !== ''
}
