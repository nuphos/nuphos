import { afterAll, beforeEach } from 'bun:test'

import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { TurnRunner } from './turn-runner'

/**
 * Installs `base` before every test in the calling file and hands the module
 * back clean when the file ends. Registering both hooks here is the point: a
 * suite that wired the seam by hand and forgot the restore would leak its
 * recorder into whichever file runs next — the class of bug this seam replaced.
 *
 * Returns an installer for the rare per-test override; call it with no
 * arguments to drop back to `base`.
 */
export function useTurnRunner(base: Partial<TurnRunner>): (extra?: Partial<TurnRunner>) => void {
  const install = (extra: Partial<TurnRunner> = {}) => {
    installTurnRunner({ ...base, ...extra })
  }

  install()
  beforeEach(() => {
    install()
  })
  afterAll(resetTurnRunner)

  return install
}
