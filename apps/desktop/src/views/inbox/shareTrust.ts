import type { LocalShareApproval, ShareTrustDuration } from '../../api/device-types'

/**
 * The requests left after answering one. Approving with trust also lets the same
 * teammate's other requests on that computer go, so they leave the list too.
 */
export function afterAnswer<T extends Pick<LocalShareApproval, 'id' | 'actorId' | 'deviceId'>>(
  approvals: readonly T[],
  answered: T,
  trust: ShareTrustDuration | undefined,
): T[] {
  return approvals.filter((entry) =>
    trust
      ? entry.actorId !== answered.actorId || entry.deviceId !== answered.deviceId
      : entry.id !== answered.id,
  )
}
