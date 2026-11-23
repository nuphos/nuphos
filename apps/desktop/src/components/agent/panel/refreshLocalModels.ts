import type { SessionConfigState } from '../../../api/session-config-types'

/** Time for this computer's new list to reach the backend before reading it back. */
export const REPORT_SETTLE_MS = 1_500

/**
 * An opened model picker asks this computer's running agents for their lists
 * again, then reads the picker again once a new list could have reached the
 * backend. A model the provider added since the agent started shows at once
 * rather than at the next periodic read, and so does the first list of an agent
 * whose earlier read failed — which is what "try again in a moment" asks for.
 * Only a failed ask reads nothing again: a build without a local runtime has no
 * computer to ask.
 */
export function refreshLocalModels(ask: () => Promise<unknown>, readAgain: () => void) {
  // Asked inside the chain, so a build without a local runtime throws nowhere.
  void Promise.resolve()
    .then(ask)
    .then(
      () => setTimeout(readAgain, REPORT_SETTLE_MS),
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
