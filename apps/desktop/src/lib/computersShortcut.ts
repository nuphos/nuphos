import type { ShortcutInput } from './sessionShortcuts.ts'

/** Match the physical key so shifted or non-Latin layouts keep the same shortcut. */
export function computersShortcut(
  input: Omit<ShortcutInput, 'key'>,
  mac: boolean,
): 'open-computers' | null {
  const modifier = mac ? input.meta && !input.control : input.control && !input.meta

  return modifier && input.code === 'KeyE' && input.shift && !input.alt && !input.isComposing
    ? 'open-computers'
    : null
}
