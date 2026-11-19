import type { AppShortcutAction } from '../../src/api/window-shell.ts'
import type { ShortcutInput } from '../../src/lib/sessionShortcuts.ts'

/** Route sidebar number keys before the workspace's broader Command/Control handler. */
export function sidebarShortcutAction(
  input: ShortcutInput,
  mac: boolean,
): AppShortcutAction | null {
  if (input.isComposing || input.meta || input.shift) return null
  if (mac ? !input.control || input.alt : !input.alt || input.control) return null
  if (!/^[1-3]$/.test(input.key)) return null

  return `select-sidebar-tab-${input.key}` as AppShortcutAction
}
