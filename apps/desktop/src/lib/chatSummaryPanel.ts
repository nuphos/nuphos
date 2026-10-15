import { useEffect, useState, useSyncExternalStore } from 'react'

// One value per window: each Electron window has its own sessionStorage,
// which also survives a reload of that window.
const OPEN_KEY = 'nuphos.chatSummaryOpen'
const COLLAPSED_KEY = 'nuphos.chatSummaryCollapsed'
const EXIT_MS = 160
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Without storage the state still holds for this page's life.
  }
}

function readCollapsed(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(COLLAPSED_KEY) ?? '[]')

    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const inWindow = typeof window !== 'undefined'
let open = inWindow && read(OPEN_KEY) === '1'
let collapsed = inWindow ? readCollapsed() : []

function notify() {
  for (const listener of listeners) listener()
}

export function setChatSummaryOpen(next: boolean): void {
  open = next
  write(OPEN_KEY, next ? '1' : '0')
  notify()
}

export function toggleChatSummary(): void {
  setChatSummaryOpen(!open)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useChatSummaryOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}

/** A section's collapsed state, kept for the window like the panel's own. */
export function useSectionOpen(title: string): [boolean, () => void] {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => !collapsed.includes(title),
    () => true,
  )
  const toggle = () => {
    collapsed = isOpen ? [...collapsed, title] : collapsed.filter((entry) => entry !== title)
    write(COLLAPSED_KEY, JSON.stringify(collapsed))
    notify()
  }

  return [isOpen, toggle]
}

/** Keeps the panel mounted through its exit animation; none under reduced motion. */
export function usePresence(shown: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(shown)

  if (shown && !mounted) setMounted(true)
  useEffect(() => {
    if (shown || !mounted) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setMounted(false), still ? 0 : EXIT_MS)

    return () => window.clearTimeout(timer)
  }, [shown, mounted])

  return { mounted, leaving: mounted && !shown }
}

/** ⌘I on macOS, Ctrl+I elsewhere; the physical key, so a layout or ⌥ cannot change it. */
export function isChatSummaryShortcut(
  event: Pick<
    KeyboardEvent,
    'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'
  >,
  mac: boolean,
): boolean {
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === 'KeyI' &&
    !event.isComposing
  )
}
