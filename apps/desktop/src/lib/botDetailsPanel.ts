import { useSyncExternalStore } from 'react'

// One choice for every Bot chat, kept across launches: switching Bots keeps the panel as it was.
const KEY = 'nuphos.botDetailsOpen'
const listeners = new Set<() => void>()
let open: boolean | undefined
// The Bot chat whose floating details a press outside closed, without changing the choice.
let dismissedFor: string | null = null
// Asks to show a Bot's Access section; the section scrolls itself into view and takes the ask.
let accessAsks = 0
let accessAsked = false

function saved(): boolean {
  if (open === undefined) {
    try {
      open = localStorage.getItem(KEY) === '1'
    } catch {
      open = false
    }
  }

  return open
}

function notify() {
  for (const listener of listeners) listener()
}

export function isBotDetailsOpen(bot: string): boolean {
  return saved() && dismissedFor !== bot
}

export function setBotDetailsOpen(next: boolean): void {
  open = next
  dismissedFor = null
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // Without storage the choice still holds until the app closes.
  }
  notify()
}

/** Closes a floating popover as a press outside does: in this Bot's chat only, saving nothing. */
export function dismissBotDetails(bot: string): void {
  dismissedFor = bot
  notify()
}

/** Opens Bot details at its Access section, as the chat's choose-access banner does. */
export function showBotAccess(): void {
  accessAsks++
  accessAsked = true
  setBotDetailsOpen(true)
}

/** Whether the Access section was asked for since it last looked; asking again changes `useBotAccessAsks`. */
export function takeBotAccessAsk(): boolean {
  const asked = accessAsked

  accessAsked = false

  return asked
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useBotDetailsOpen(bot: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isBotDetailsOpen(bot),
    () => false,
  )
}

export function useBotAccessAsks(): number {
  return useSyncExternalStore(
    subscribe,
    () => accessAsks,
    () => 0,
  )
}
