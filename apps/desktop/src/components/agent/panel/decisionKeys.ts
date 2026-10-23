export type DecisionKey = { kind: 'approve' } | { kind: 'deny' } | { kind: 'option'; index: number }

/**
 * Keys for the card waiting on the user: ⌘↵ approves, ⌘⌫ denies, ⌥1–⌥9 pick
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

  if (mod && !event.altKey) {
    if (event.key === 'Enter') return { kind: 'approve' }
    if (event.key === 'Backspace' && !typing) return { kind: 'deny' }

    return null
  }
  // The physical key: ⌥ turns event.key into a composed character on macOS.
  const digit = /^Digit([1-9])$/.exec(event.code)

  if (event.altKey && !event.metaKey && !event.ctrlKey && digit) {
    return { kind: 'option', index: Number(digit[1]) - 1 }
  }

  return null
}

/** Whether the focused element is a text box that already holds text. */
export function focusedBoxHasText(active: Element | null): boolean {
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.value !== ''
  }

  return active instanceof HTMLElement && active.isContentEditable && active.textContent !== ''
}
