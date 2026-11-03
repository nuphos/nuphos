/** The share levels released desktops send; any but `off` now means use (see box-access). */
export type LocalShareLevel = 'off' | 'approve' | 'full'

export const LOCAL_SHARE_LEVELS: readonly LocalShareLevel[] = ['off', 'approve', 'full']

/** A team's stored ceiling; unset means owners may share with their approval of each conversation. */
export function localShareCeiling(value: unknown): LocalShareLevel {
  return LOCAL_SHARE_LEVELS.find((level) => level === value) ?? 'approve'
}
