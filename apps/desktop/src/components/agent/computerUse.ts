import { isNotFound, parseAtlasError } from '../../api/errors.ts'

/** An invite refused because some invitees cannot use the session's computer yet. */
export function needsComputerUse(error: unknown): boolean {
  return parseAtlasError(error).code === 'computer_use_required'
}

/**
 * The same invite again, now also giving the invitees use of the computer. `computer` is its
 * name and `userIds` who would be given it, both as the refusal named them.
 */
export type ComputerUseRequest = {
  count: number
  computer: string | null
  userIds: string[]
  confirm: () => Promise<void>
}

/** What the backend's computer_use_required refusal says: the computer, and who lacks it. */
export function computerUseNeeded(error: unknown): { computer: string | null; userIds: string[] } {
  const details = parseAtlasError(error).details as
    { userIds?: unknown; computer?: { label?: unknown } } | undefined
  const label = details?.computer?.label
  const ids = Array.isArray(details?.userIds) ? details.userIds : []

  return {
    computer: typeof label === 'string' && label.trim() ? label : null,
    userIds: ids.filter((id): id is string => typeof id === 'string'),
  }
}

/**
 * A stop that had nothing to take back: they no longer use the computer by name, or the
 * backend predates the stop route, so its 404 is about the route and nothing changed.
 */
export function nothingToStop(error: unknown): boolean {
  const { code } = parseAtlasError(error)

  if (code === 'nothing_to_stop' || code === 'route_not_found') return true

  return code === 'not_found' && !isNotFound(error)
}
