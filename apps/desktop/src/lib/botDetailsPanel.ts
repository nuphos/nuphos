import { useSyncExternalStore } from 'react'

// One choice for every Bot chat, kept across launches: switching Bots keeps the panel as it was.
const KEY = 'nuphos.botDetailsOpen'
const listeners = new Set<() => void>()
let open: boolean | undefined
// The Bot chat whose floating details a press outside closed, without changing the choice.
let dismissedFor: string | null = null
// Bot chats with no room for the details beside them: there the details start closed and
// open only as a popover, peeked at without changing the choice the chat goes back to.
const narrow = new Set<string>()
let peek: string | null = null
// Asks to show a Bot's Access section; the section scrolls itself into view and takes the ask.
let accessAsks = 0
let accessAsked = false
// Asks to show one of a Bot's Triggers; its row opens, scrolls into view and takes the ask.
let triggerAsks = 0
let triggerAsked: string | null = null

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
  if (narrow.has(bot)) return peek === bot

  return saved() && dismissedFor !== bot
}

/** Tells the store whether this Bot's chat has room for its details; either way they close. */
export function setBotDetailsNarrow(bot: string, next: boolean): void {
  if (next === narrow.has(bot)) return
  if (next) narrow.add(bot)
  else narrow.delete(bot)
  if (peek === bot) peek = null
  notify()
}

export function setBotDetailsOpen(bot: string, next: boolean): void {
  if (narrow.has(bot)) {
    peek = next ? bot : null
    notify()

    return
  }
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
  // Narrow, only the look closes: wide again, the details are back as saved.
  if (narrow.has(bot)) peek = null
  else dismissedFor = bot
  notify()
}

/** Opens Bot details at its Access section, as the chat's choose-access banner does. */
export function showBotAccess(bot: string): void {
  accessAsks++
  accessAsked = true
  setBotDetailsOpen(bot, true)
}

/** Whether the Access section was asked for since it last looked; asking again changes `useBotAccessAsks`. */
export function takeBotAccessAsk(): boolean {
  const asked = accessAsked

  accessAsked = false

  return asked
}

/** Opens Bot details at one Trigger, as a chat line naming it does. */
export function showBotTrigger(bot: string, triggerId: string): void {
  triggerAsks++
  triggerAsked = triggerId
  setBotDetailsOpen(bot, true)
}

/** The Trigger asked for since the section last looked, if it is one of `ids`. */
export function takeBotTriggerAsk(ids: string[]): string | null {
  const asked = triggerAsked && ids.includes(triggerAsked) ? triggerAsked : null

  if (asked) triggerAsked = null

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

export function useBotTriggerAsks(): number {
  return useSyncExternalStore(
    subscribe,
    () => triggerAsks,
    () => 0,
  )
}
