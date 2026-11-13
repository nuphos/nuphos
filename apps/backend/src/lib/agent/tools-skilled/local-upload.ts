import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { assertConversationSendable } from '@/routes/agent/team-scope'

import { isActiveTeamMember } from '../devices/store'
import { dispatchLocalUpload } from '../devices/upload'

import { withLabel } from './labeling'
import { describeDevices, pickDevice, wakeRefusal } from './local-tools'
import { createLocalExecAudit } from './local-tools-audit'

import type { LocalExecDevice, LocalExecTurn } from './local-tools'

export function createLocalUploadTool(devices: LocalExecDevice[], turn: LocalExecTurn) {
  const audit = createLocalExecAudit(devices, turn)

  return withLabel(
    {
      description:
        'Upload one user-requested file from a conversation-selected computer into the agent file-transfer store. ' +
        'Use this when the person names a file on their computer; do not ask them to attach it again. ' +
        'Pass an absolute path (or ~/path) and optionally a device ID, as for local_exec. No shell expansion is performed. ' +
        'Returns {groupId, fileName, size}. Immediately run bash skills/file-transfer/scripts/transfer-pull.sh <TEAM> <groupId> <dest-dir> in your workspace to finish importing it. ' +
        'Signed URLs and credentials stay internal. Do not use local_exec with signed URLs or third-party staging for this transfer. ' +
        'Requires an online computer with local exec allowed and an updated Desktop or CLI host. Transfers are bounded to two minutes and the existing file-transfer limits.',
      execute: async ({ path, device }: { path: string; device?: string }) => {
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
        const command = `local_upload ${JSON.stringify(path)}`

        await audit(deviceId, command, requestedAt, { outcome: 'unknown' })
        // Neither raw transport/service errors nor signed capabilities may escape
        // through a tool result or an exception captured in the transcript.
        let result

        try {
          result = await dispatchLocalUpload(
            turn.conversationOwnerUserId ?? turn.userId,
            deviceId,
            path,
            {
              teamId: new ObjectId(turn.teamId),
              userId: turn.conversationOwnerUserId ?? turn.userId,
              sessionId: turn.sessionId,
            },
          )
        } catch {
          result = { error: 'upload_failed' }
        }
        await audit(deviceId, command, requestedAt, { outcome: 'error' in result ? 'error' : 'ok' })

        return result
      },
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
