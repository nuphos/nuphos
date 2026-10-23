import type { ShortcutInput } from './sessionShortcuts.ts'

export type RegionShortcutAction = 'focus-next-region' | 'focus-previous-region'

/** F6 / ⇧F6, the browser and VS Code key for moving between a window's parts. */
export function regionShortcut(
  input: Pick<ShortcutInput, 'code' | 'meta' | 'control' | 'alt' | 'shift'>,
): RegionShortcutAction | null {
  if (input.code !== 'F6' || input.meta || input.control || input.alt) return null

  return input.shift ? 'focus-previous-region' : 'focus-next-region'
}

/** The region a step lands on, wrapping; from none, forward starts at the first. */
export function nextRegion(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1
  if (current === -1) return step === 1 ? 0 : count - 1

  return (current + step + count) % count
}
