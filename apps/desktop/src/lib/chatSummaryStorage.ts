// The summary panel's list filters, per window: each Electron window has its own
// sessionStorage, which also survives a reload of that window.

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
