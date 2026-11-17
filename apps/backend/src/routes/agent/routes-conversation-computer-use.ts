import { Hono } from 'hono'

import { conversationParticipantIds } from '@/lib/agent/db/participants'
import { revokeBoxStreams } from '@/lib/agent/devices/box-access'
import { dropShareApprovals } from '@/lib/agent/devices/local-share-store'
import { dropShareTrusts } from '@/lib/agent/devices/local-share-trust'
import { computerStillShared, dropTeamUse } from '@/lib/agent/devices/conversation-computer-use'
import { AppError } from '@/lib/errors'

import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { AuthVariables } from '@/middleware/auth'

/**
 * After someone is removed from a chat, its owner may also stop sharing the chat's computer
 * with them: being invited may have given them use of the whole computer, which removal from
 * the chat does not take back.
 */
export const conversationComputerUseRoutes = new Hono<{ Variables: AuthVariables }>()

conversationComputerUseRoutes.post(
  '/conversations/:sessionId/participants/:userId/stop-computer-use',
  async (c) => {
    const actorId = c.get('userId')
    const targetId = c.req.param('userId')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

    if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
    const conversation = await assertConversationWritable(c.req.param('sessionId'), actorId, teamId)

    if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
    // Only for someone no longer in it: taking the computer from a participant is the Share dialog's.
    if (conversationParticipantIds(conversation).includes(targetId))
      throw new AppError(409, 'still_participant', 'Remove them from the conversation first')
    const shared = await computerStillShared(conversation, actorId, targetId)

    if (!shared)
      throw new AppError(409, 'nothing_to_stop', 'They no longer use this computer by name')
    const by = { actorUserId: actorId, via: 'conversation_remove' as const }

    // Changed in between (the Share dialog, say): nothing of theirs left to take.
    if (!(await dropTeamUse(shared.device, teamId, targetId, by)))
      throw new AppError(409, 'nothing_to_stop', 'They no longer use this computer by name')
    // The same clean-up as losing use in the Share dialog (routes-devices-share.ts).
    await revokeBoxStreams([shared.device], [targetId], teamId)
    await dropShareApprovals(shared.device.userId, shared.device.deviceId, teamId, [targetId])
    await dropShareTrusts(shared.device.userId, shared.device.deviceId, teamId, [targetId])

    return c.json({ stopped: true, computer: shared.offer })
  },
)
