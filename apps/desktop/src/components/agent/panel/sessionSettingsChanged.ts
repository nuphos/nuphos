const EVENT = 'nuphos:session-settings-changed'

/** Tells every open composer that a conversation's model or permission mode was saved. */
export function announceSettingsChanged(sessionId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: sessionId }))
}

/**
 * Calls `changed` when `sessionId`'s settings were saved, from any composer: a Bot's chat
 * and its own page show the same Bot, and either may stay open behind the other.
 */
export function onSettingsChanged(sessionId: string, changed: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === sessionId) changed()
  }

  window.addEventListener(EVENT, listener)

  return () => window.removeEventListener(EVENT, listener)
}
