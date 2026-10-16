/**
 * Keyboard shortcuts for the open chat's ⋯ menu (Codex desktop parity). Pure
 * data + matching so electron/main/windows.ts and the renderer share one
 * keymap and node:test can cover it. Combos use the 'mod+key' notation from
 * src/lib/platform.ts.
 */

import { isMac } from './platform.ts'

export type SessionShortcutAction =
  'rename-chat' | 'toggle-pin-chat' | 'copy-chat-link' | 'archive-chat'

type SessionShortcut = {
  action: SessionShortcutAction
  combo: string
  /** Physical key: ⌥ turns input.key into a composed character on macOS (⌥R → ®). */
  code: string
  alt: boolean
  shift: boolean
  /** Off macOS the combo is Ctrl+Shift+C, which terminals and editors use for copy. */
  macOnly?: boolean
}

export const SESSION_SHORTCUTS: SessionShortcut[] = [
  {
    action: 'rename-chat',
    combo: 'mod+alt+r',
    code: 'KeyR',
    alt: true,
    shift: false,
  },
  {
    action: 'toggle-pin-chat',
    combo: 'mod+alt+p',
    code: 'KeyP',
    alt: true,
    shift: false,
  },
  {
    action: 'copy-chat-link',
    combo: 'mod+shift+c',
    code: 'KeyC',
    alt: false,
    shift: true,
    macOnly: true,
  },
  {
    action: 'archive-chat',
    combo: 'mod+shift+a',
    code: 'KeyA',
    alt: false,
    shift: true,
  },
]

/** '' when the action has no shortcut on this platform. */
export function sessionShortcutCombo(action: SessionShortcutAction, mac: boolean = isMac): string {
  const shortcut = SESSION_SHORTCUTS.find((entry) => entry.action === action)

  return shortcut && (mac || !shortcut.macOnly) ? shortcut.combo : ''
}

/** The subset of Electron's before-input-event `Input` the matcher reads. */
export type ShortcutInput = {
  key: string
  code: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
  isComposing: boolean
}

export function matchSessionShortcut(
  input: ShortcutInput,
  mac: boolean,
): SessionShortcutAction | null {
  // mod is ⌘ on macOS and Ctrl elsewhere; the other modifier must be up.
  const mod = mac ? input.meta && !input.control : input.control && !input.meta

  if (!mod || input.isComposing) return null
  const shortcut = SESSION_SHORTCUTS.find(
    (entry) => entry.code === input.code && entry.alt === input.alt && entry.shift === input.shift,
  )

  if (!shortcut || (shortcut.macOnly && !mac)) return null
  // Off macOS, Ctrl+Alt is AltGr on many layouts: if it typed another
  // character, the user is entering text, not pressing a shortcut.
  const letter = shortcut.code.slice(3).toLowerCase()

  if (!mac && shortcut.alt && input.key.length === 1 && input.key.toLowerCase() !== letter)
    return null

  return shortcut.action
}
