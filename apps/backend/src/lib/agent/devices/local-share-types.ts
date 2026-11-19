/** The share levels released desktops send; any but `off` now means use (see box-access). */
export type LocalShareLevel = 'off' | 'approve' | 'full'

export const LOCAL_SHARE_LEVELS: readonly LocalShareLevel[] = ['off', 'approve', 'full']
