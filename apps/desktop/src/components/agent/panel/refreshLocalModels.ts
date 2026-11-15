import type { SessionConfigState } from '../../../api/session-config-types'

/** Time for this computer's new list to reach the backend before reading it back. */
export const REPORT_SETTLE_MS = 1_500

/**
 * An opened model picker asks this computer's running agents for their lists
 * again, and reads the picker again when one changed. A model the provider
 * added since the agent started then shows at once, not at the next periodic
 * read. Pickers for agents elsewhere lose nothing: an unchanged list reads
 * nothing again, and a failed ask is the same as none.
 */
export function refreshLocalModels(ask: () => Promise<boolean>, readAgain: () => void) {
  // Asked inside the chain, so a build without a local runtime throws nowhere.
  void Promise.resolve()
    .then(ask)
    .then(
      (changed) => {
        if (changed) setTimeout(readAgain, REPORT_SETTLE_MS)
      },
      () => undefined,
    )
}

/**
 * The server lists a started chat's models but names none as current: the
 * session runs a model the computer's last reported list lacks, and the chip
 * would read only "Model settings". A fresh read from this computer fixes it.
 */
export function namesNoModel(data: SessionConfigState | undefined): boolean {
  return Boolean(data?.options.some((option) => option.kind === 'model' && !option.currentValue))
}
