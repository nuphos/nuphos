/**
 * Keyboard shortcuts for the open chat's ⋯ menu (Codex desktop parity). Pure
 * data + matching so electron/main/windows.ts and the renderer share one
 * keymap and node:test can cover it. Combos use the 'mod+key' notation from
 * src/lib/platform.ts.
 */

export type SessionShortcutAction =
  'rename-chat' | 'toggle-pin-chat' | 'copy-chat-link' | 'archive-chat'

type SessionShortcut = {
  action: SessionShortcutAction
  combo: string
  /** Physical key: ⌥ turns input.key into a composed character on macOS (⌥R → ®). */
  code: string
  alt: boolean
  shift: boolean
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
  },
  {
    action: 'archive-chat',
    combo: 'mod+shift+a',
    code: 'KeyA',
    alt: false,
    shift: true,
  },
]

export function sessionShortcutCombo(action: SessionShortcutAction): string {
  return SESSION_SHORTCUTS.find((shortcut) => shortcut.action === action)?.combo ?? ''
}

/** The subset of Electron's before-input-event `Input` the matcher reads. */
export type ShortcutInput = {
  key: string
  code: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

export function matchSessionShortcut(
  input: ShortcutInput,
  mac: boolean,
): SessionShortcutAction | null {
  // mod is ⌘ on macOS and Ctrl elsewhere; the other modifier must be up.
  const mod = mac ? input.meta && !input.control : input.control && !input.meta

  if (!mod) return null
  const shortcut = SESSION_SHORTCUTS.find(
    (entry) => entry.code === input.code && entry.alt === input.alt && entry.shift === input.shift,
  )

  if (!shortcut) return null
  // Off macOS, Ctrl+Alt is AltGr on many layouts: if it typed another
  // character, the user is entering text, not pressing a shortcut.
  const letter = shortcut.code.slice(3).toLowerCase()

  if (!mac && shortcut.alt && input.key.length === 1 && input.key.toLowerCase() !== letter)
    return null

  return shortcut.action
}
