import { z } from 'zod'

import { getReadableConversation } from '@/lib/agent/db'
import { conversationParticipantIds } from '@/lib/agent/db/participants'
import { computerUseGap } from '@/lib/agent/devices/conversation-computer'
import { addTeamUse } from '@/lib/agent/devices/device-grants'
import { moveConversationRuntime } from '@/lib/claude-code-preview/conversation-runtime-move'
import { AppError } from '@/lib/errors'

import { buildConversationOwnerMap } from './conversation-view'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { AgentConversation } from '@/lib/agent/db'
import type { Context } from 'hono'

/** The conversation, for its owner: only they move it. */
async function ownedConversation(c: Context, teamIdCandidate?: string) {
  const userId = c.get('userId') as string
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, teamIdCandidate))
  const conversation = await getReadableConversation(c.req.param('sessionId') ?? '', userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return { conversation, userId }
}

/** Participants who would lose reply on `runtimeId`: they cannot use its computer. */
function participantsLosingReply(
  conversation: AgentConversation,
  userId: string,
  runtimeId: string,
) {
  const people = conversationParticipantIds(conversation).filter((id) => id !== conversation.userId)

  return computerUseGap({ ...conversation, runtimeId }, userId, people)
}

// Before a move: who would lose reply on the target, and whether the mover can
// give them use of its computer instead, so the app can ask first.
agent.get('/conversations/:sessionId/runtime-move', async (c) => {
  const runtimeId = z.string().min(1).max(200).parse(c.req.query('runtimeId'))
  const { conversation, userId } = await ownedConversation(c)
  const gap = await participantsLosingReply(conversation, userId, runtimeId)
  const names = await buildConversationOwnerMap(conversation.teamId, gap?.needing ?? [])

  return c.json({
    computer: gap?.computer ? { deviceId: gap.computer.deviceId, label: gap.computer.label } : null,
    losing: (gap?.needing ?? []).map((id) => ({ id, name: names.get(id)?.name ?? 'Unknown user' })),
    canGrant: gap?.canGrant ?? false,
  })
})

// `grantComputerUse` gives those participants use of the target computer once
// the move lands. Without it (or from a release that predates it) they keep
// reading only, as the move dialog says.
agent.post('/conversations/:sessionId/runtime', async (c) => {
  const body = z
    .object({
      runtimeId: z.string().min(1).max(200),
      // Sent by older Desktop builds. Only the history moves, whatever it says.
      mode: z.enum(['history', 'workspace']).optional(),
      teamId: z.string().optional(),
      grantComputerUse: z.boolean().optional(),
    })
    .strict()
    .parse(await c.req.json())
  const { conversation, userId } = await ownedConversation(c, body.teamId)
  const gap = body.grantComputerUse
    ? await participantsLosingReply(conversation, userId, body.runtimeId)
    : undefined

  if (gap && (!gap.computer || !gap.canGrant))
    throw new AppError(
      403,
      'computer_manage_required',
      'Only the owner or a manager of that computer can give teammates use of it.',
      { userIds: gap.needing },
    )
  const moved = await moveConversationRuntime(conversation, body.runtimeId, userId)

  const by = { actorUserId: userId, via: 'conversation_move' as const }

  if (
    gap?.computer &&
    !(await addTeamUse(gap.computer, conversation.teamId ?? '', gap.needing, by))
  )
    throw new AppError(404, 'device_not_found', 'Device is not available')

  return c.json(moved)
})
