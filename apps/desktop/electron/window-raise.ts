// Bringing a window back to the user. show() alone leaves a minimized window in
// the Dock and focus() alone leaves a hidden one hidden, so every path that
// raises a window — deep links, notification clicks — goes through this.

export type RaisableWindow = {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  isVisible(): boolean
  show(): void
  focus(): void
}

/** Returns false when there was no live window to raise. */
export function raiseWindow(win: RaisableWindow | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()

  return true
}
