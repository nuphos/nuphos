import { recordDeviceExecAudit } from '../devices/audit'

import type { LocalExecDevice, LocalExecTurn } from './local-tools'
import type { DeviceExecAuditInput } from '../devices/audit'

/** Keeps the requesting participant separate from the computer's transport owner. */
export function createLocalExecAudit(devices: LocalExecDevice[], turn: LocalExecTurn) {
  return (
    deviceId: string,
    command: string,
    requestedAt: Date,
    rest: Pick<
      DeviceExecAuditInput,
      'outcome' | 'dispatchedAt' | 'exitCode' | 'reason' | 'operationId'
    >,
  ) =>
    recordDeviceExecAudit({
      ownerUserId:
        devices.find((device) => device.deviceId === deviceId)?.ownerUserId ?? turn.userId,
      deviceId,
      actorUserId: turn.userId,
      conversationOwnerUserId: turn.conversationOwnerUserId ?? turn.userId,
      origin: turn.origin,
      teamId: turn.teamId,
      sessionId: turn.sessionId,
      command,
      requestedAt,
      finishedAt: rest.outcome === 'unknown' ? null : new Date(),
      ...rest,
    })
}
