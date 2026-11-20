import { parseAtlasError } from '../../api/errors.ts'

/** An invite refused because some invitees cannot use the session's computer yet. */
export function needsComputerUse(error: unknown): boolean {
  return parseAtlasError(error).code === 'computer_use_required'
}

/** The same invite again, now also giving the invitees use of the computer, named as the refusal named it. */
export type ComputerUseRequest = {
  count: number
  computer: string | null
  confirm: () => Promise<void>
}

/** The computer the backend's computer_use_required refusal names. */
export function computerUseNeeded(error: unknown): { computer: string | null } {
  const details = parseAtlasError(error).details as { computer?: { label?: unknown } } | undefined
  const label = details?.computer?.label

  return { computer: typeof label === 'string' && label.trim() ? label : null }
}
