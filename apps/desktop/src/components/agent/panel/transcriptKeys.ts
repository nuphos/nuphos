/** PageUp / PageDown scroll the transcript a screen at a time, even from the composer. */
export function transcriptPageStep(
  event: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'
  >,
): 1 | -1 | null {
  if (event.defaultPrevented || event.isComposing) return null
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === 'PageDown') return 1
  if (event.key === 'PageUp') return -1

  return null
}
