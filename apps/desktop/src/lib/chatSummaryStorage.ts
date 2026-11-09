// The summary panel's state, per window: each Electron window has its own
// sessionStorage, which also survives a reload of that window.

const OPEN_KEY = 'nuphos.chatSummaryOpenChats'
/** Enough open chats for a long day; the oldest are forgotten first. */
const OPEN_LIMIT = 200

export const inWindow = typeof window !== 'undefined'

export function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Without storage the state still holds for this page's life.
  }
}

/** The chats whose panel was open in this window. */
export function loadOpenChats(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(OPEN_KEY) ?? '[]')

    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Saves the open chats, oldest first, keeping the most recent OPEN_LIMIT. */
export function saveOpenChats(chats: string[]) {
  write(OPEN_KEY, JSON.stringify(chats.slice(-OPEN_LIMIT)))
}
