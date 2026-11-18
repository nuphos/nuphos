import { useSyncExternalStore } from 'react'

// One choice for every Bot chat, kept across launches: switching Bots keeps the panel as it was.
const KEY = 'nuphos.botDetailsOpen'
const listeners = new Set<() => void>()
let open: boolean | undefined

export function isBotDetailsOpen(): boolean {
  if (open === undefined) {
    try {
      open = localStorage.getItem(KEY) === '1'
    } catch {
      open = false
    }
  }

  return open
}

export function setBotDetailsOpen(next: boolean): void {
  open = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // Without storage the choice still holds until the app closes.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useBotDetailsOpen(): boolean {
  return useSyncExternalStore(subscribe, isBotDetailsOpen, () => false)
}
