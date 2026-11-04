import { parseAtlasError } from '../../api/errors.ts'

/** An invite refused because some invitees cannot use the session's computer yet. */
export function needsComputerUse(error: unknown): boolean {
  return parseAtlasError(error).code === 'computer_use_required'
}

/** The same invite again, now also giving the invitees use of the computer. */
export type ComputerUseRequest = { count: number; confirm: () => Promise<void> }
