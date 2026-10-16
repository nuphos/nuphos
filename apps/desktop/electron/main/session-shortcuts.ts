import { ipcMain } from 'electron'

import { matchSessionShortcut } from '../../src/lib/sessionShortcuts'

import type { SessionShortcutAction } from '../../src/lib/sessionShortcuts'
import type { Input, WebContents } from 'electron'

// Renderers whose visible chat owns the session shortcuts (SessionHeaderMenu
// reports this). Elsewhere, such as Settings, no open chat, or another page
// load, the combo is left to the page instead of being swallowed.
const live = new WeakSet<WebContents>()
const tracked = new WeakSet<WebContents>()

ipcMain.on('app:sessionShortcutsActive', (event, active: unknown) => {
  const contents = event.sender

  if (active !== true) {
    live.delete(contents)

    return
  }
  live.add(contents)
  if (tracked.has(contents)) return
  tracked.add(contents)
  // A reload drops the page that reported; its successor reports again.
  contents.on('did-navigate', () => live.delete(contents))
})

export function liveSessionShortcut(
  contents: WebContents,
  input: Input,
): SessionShortcutAction | null {
  if (!live.has(contents)) return null

  return matchSessionShortcut(input, process.platform === 'darwin')
}
