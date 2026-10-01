import { Hono } from 'hono'

import { getReadableConversation } from '@/lib/agent/db'
import { conversationSessionConfig } from '@/lib/claude-code-preview/session-config'
import { AppError } from '@/lib/errors'

import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

import type { AuthVariables } from '@/middleware/auth'

export const sessionConfigRoutes = new Hono<{ Variables: AuthVariables }>()

sessionConfigRoutes.get('/conversations/:sessionId/model-config', async (c) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const conversation = await getReadableConversation(
    c.req.param('sessionId'),
    c.get('userId'),
    teamId,
  )

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json(await conversationSessionConfig(conversation, undefined, c.get('userId')))
})

sessionConfigRoutes.patch('/conversations/:sessionId/model-config', async (c) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(403, 'forbidden', 'Workspace membership is required')
  const conversation = await assertConversationWritable(
    c.req.param('sessionId'),
    c.get('userId'),
    teamId,
  )

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const body: unknown = await c.req.json()

  if (
    !body ||
    typeof body !== 'object' ||
    !('configId' in body) ||
    !('value' in body) ||
    typeof body.configId !== 'string' ||
    typeof body.value !== 'string' ||
    body.configId.length > 200 ||
    body.value.length > 500
  ) {
    throw new AppError(400, 'invalid_request', 'configId and value must be strings')
  }

  // Runtime admission orders configuration writes against prompts. A request
  // still preparing its context has not entered the runtime; a setting applied
  // then is valid for that next prompt. Redis stream ownership is not execution
  // state and may outlive runtime completion, so it cannot veto this action.
  return c.json(
    await conversationSessionConfig(
      conversation,
      { configId: body.configId, value: body.value },
      c.get('userId'),
    ),
  )
})
