import { SIDEBAR_PAGES } from './swipe-gesture.ts'

import type { SidebarPage } from './swipe-gesture.ts'

/** Pages keep their meaning (0 Bots, 1 Tasks, 2 Inbox); only where they sit on screen changes. */
export type SidebarTabOrder = readonly SidebarPage[]

export const DEFAULT_TAB_ORDER: SidebarTabOrder = [0, 1, 2]

const STORAGE_KEY = 'nuphos.sidebar.tabOrder.v1'

/** Anything that is not exactly one of each page falls back to the default. */
export function parseTabOrder(raw: unknown): SidebarTabOrder {
  if (typeof raw !== 'string') return DEFAULT_TAB_ORDER
  const ids = raw.split(',')
  const pages = ids.map((id) => SIDEBAR_PAGES.indexOf(id as (typeof SIDEBAR_PAGES)[number]))
  const valid =
    pages.length === SIDEBAR_PAGES.length &&
    pages.every((page) => page >= 0) &&
    new Set(pages).size === pages.length

  return valid ? (pages as SidebarPage[]) : DEFAULT_TAB_ORDER
}

export function serializeTabOrder(order: SidebarTabOrder): string {
  return order.map((page) => SIDEBAR_PAGES[page]).join(',')
}

/** Move a page by `delta` slots, clamped to the ends. Returns the same array when nothing moves. */
export function moveTab(order: SidebarTabOrder, page: SidebarPage, delta: number): SidebarTabOrder {
  const from = order.indexOf(page)
  const to = Math.max(0, Math.min(order.length - 1, from + delta))

  if (from < 0 || from === to) return order
  const next = order.filter((item) => item !== page)

  next.splice(to, 0, page)

  return next
}

export function slotOf(order: SidebarTabOrder, page: SidebarPage): SidebarPage {
  return Math.max(0, order.indexOf(page)) as SidebarPage
}

/** The neighbour on screen, for arrow keys; stays put at the ends. */
export function pageBeside(order: SidebarTabOrder, page: SidebarPage, delta: number) {
  const slot = Math.max(0, Math.min(order.length - 1, slotOf(order, page) + delta))

  return order[slot]
}

/** Without a conversation the leftmost list of chats opens; the Inbox is a queue, so it is skipped. */
export function defaultPage(order: SidebarTabOrder): SidebarPage {
  return order.find((page) => page !== 2) ?? 0
}

export function sameOrder(a: SidebarTabOrder, b: SidebarTabOrder) {
  return a.length === b.length && a.every((page, index) => page === b[index])
}

let current: SidebarTabOrder | null = null
const listeners = new Set<() => void>()

export function sidebarTabOrder(): SidebarTabOrder {
  if (current) return current
  try {
    current = parseTabOrder(localStorage.getItem(STORAGE_KEY))
  } catch {
    current = DEFAULT_TAB_ORDER
  }

  return current
}

export function setSidebarTabOrder(order: SidebarTabOrder) {
  if (sameOrder(order, sidebarTabOrder())) return
  current = [...order]
  try {
    localStorage.setItem(STORAGE_KEY, serializeTabOrder(current))
  } catch {
    /* Storage is optional; the order still holds for this run. */
  }
  for (const listener of listeners) listener()
}

export function subscribeSidebarTabOrder(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
