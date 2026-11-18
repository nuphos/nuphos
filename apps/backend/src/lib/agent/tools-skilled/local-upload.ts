import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { assertConversationSendable } from '@/routes/agent/team-scope'

import { isActiveTeamMember } from '../devices/store'
import { dispatchLocalUpload } from '../devices/upload'

import { withLabel } from './labeling'
import { describeDevices, pickDevice, wakeRefusal } from './local-tools'
import { createLocalExecAudit } from './local-tools-audit'

import type { LocalExecDevice, LocalExecTurn } from './local-tools'
import type { TransferScope } from '@/lib/file-transfer/service'

/** Runs one audited file operation on a selected computer; raw errors, which may carry a signed URL, never surface. */
export function onSelectedComputer(devices: LocalExecDevice[], turn: LocalExecTurn) {
  const audit = createLocalExecAudit(devices, turn)

  return async <T extends object>(
    device: string | undefined,
    command: string,
    failed: string,
    run: (
      deviceId: string,
      actorId: string,
      scope: TransferScope,
    ) => Promise<T | { error: string }>,
  ): Promise<T | { error: string }> => {
    const deviceId = pickDevice(devices, device)

    if (!deviceId)
      return {
        error: `Select an available computer: ${describeDevices(devices)}. Pass device=<deviceId>.`,
      }
    if (!(await isActiveTeamMember(turn.userId, turn.teamId)))
      return { error: 'You are no longer a member of this team.' }
    if (!(await assertConversationSendable(turn.sessionId, turn.userId, turn.teamId)))
      return { error: 'This conversation is no longer available.' }
    const refusal = await wakeRefusal(
      deviceId,
      devices.find((item) => item.deviceId === deviceId)?.wake,
    )

    if (refusal) return { error: refusal.error }
    const requestedAt = new Date()
    const actorId = turn.conversationOwnerUserId ?? turn.userId

    await audit(deviceId, command, requestedAt, { outcome: 'unknown' })
    const result = await run(deviceId, actorId, {
      teamId: new ObjectId(turn.teamId),
      userId: actorId,
      sessionId: turn.sessionId,
    }).catch(() => ({ error: failed }))

    await audit(deviceId, command, requestedAt, { outcome: 'error' in result ? 'error' : 'ok' })

    return result
  }
}

export function createLocalUploadTool(devices: LocalExecDevice[], turn: LocalExecTurn) {
  const onComputer = onSelectedComputer(devices, turn)

  return withLabel(
    {
      description:
        'Upload one user-requested file from a conversation-selected computer into the agent file-transfer store. ' +
        'Use this when the person names a file on their computer; do not ask them to attach it again. ' +
        'Pass an absolute path (or ~/path) and optionally a device ID, as for local_exec. No shell expansion is performed. ' +
        'Returns {groupId, fileName, size} as soon as the upload starts, not when it ends. Immediately run bash skills/file-transfer/scripts/transfer-pull.sh <TEAM> <groupId> <dest-dir> in your workspace: it waits for the upload and reports whether it arrived. ' +
        'Signed URLs and credentials stay internal. Do not use local_exec with signed URLs or third-party staging for this transfer. ' +
        'Requires an online computer with local exec allowed and an updated Desktop or CLI host. The existing file-transfer limits apply. ' +
        'If it returns file_transfer_rate_limited, do not retry: tell the person the team hit its hourly file-transfer limit and when it resets (retryAfter).',
      execute: ({ path, device }: { path: string; device?: string }) =>
        onComputer(
          device,
          `local_upload ${JSON.stringify(path)}`,
          'upload_failed',
          (id, actor, scope) => dispatchLocalUpload(actor, id, path, scope),
        ),
    },
    {
      path: z
        .string()
        .min(1)
        .max(4096)
        .describe('Absolute path or ~/path to the requested file on the selected computer.'),
      device: z
        .string()
        .optional()
        .describe('Selected device ID. Omit when only one device is available.'),
    },
    { onExecuteError: () => ({ error: 'upload_failed' }) },
  )
}
