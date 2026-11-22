// What a client sees of a Box's machine, inside its device.

import type { BoxState } from './device-types.ts'

/** Who may use a Box besides its owner and managers, who always may. */
export type BoxAccess = { everyone: boolean; userIds: string[] }

export type BoxStatus = {
  provider: 'instabox'
  /** Only for those who manage the Box; useTerminal lets those who only use it open a terminal. */
  access?: BoxAccess
  useTerminal?: boolean
  /** Set once the machine exists. */
  sandboxId?: string
  state: BoxState
  /** Why instabox paused it on its own, such as `memory_pressure`. Absent when a person did. */
  pausedBy?: string
  /** While an update restarts its host: when it began. Absent from older backends. */
  updateStartedAt?: string
}
