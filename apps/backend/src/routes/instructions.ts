import { Hono } from 'hono'

import { getConversationBySessionId } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { createInstructionSchema, updateInstructionSchema } from '@/lib/instructions/schema'
import {
  createInstruction,
  deleteInstruction,
  listInstructions,
  updateInstruction,
} from '@/lib/instructions/service'
import { zv } from '@/lib/validate'

import type { InstructionActor } from '@/lib/instructions/schema'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConversationTeamAuthVariables } from '@/routes/teams/conversation-auth'
import type { Context, MiddlewareHandler } from 'hono'

type InstructionsVariables = TeamAuthVariables &
  Pick<ConversationTeamAuthVariables, 'conversationAgent'>

export const instructionsRoutes = new Hono<{ Variables: InstructionsVariables }>()

function actorOf(c: Context<{ Variables: InstructionsVariables }>): InstructionActor {
  return { teamId: c.get('teamId'), userId: c.get('userId'), role: c.get('teamRole') }
}

// Runtime writes are allowed only while a user-originated turn is live, the
// same boundary as the built-in tools; with no such turn this fails closed.
const refuseNonUserConversationWrites: MiddlewareHandler<{
  Variables: InstructionsVariables
}> = async (c, next) => {
  const agent = c.get('conversationAgent')

  if (agent) {
    const conversation = await getConversationBySessionId(agent.sessionId)
    const context = conversation?.claudeCodePreviewContext

    if (!context?.activeTurnKey || context.activeTurnOrigin !== 'user') {
      throw new AppError(
        403,
        'instructions_user_conversation_required',
        'Instructions can only be changed from a conversation with the user',
      )
    }
  }
  await next()
}

instructionsRoutes.get('/', async (c) => c.json(await listInstructions(actorOf(c))))

instructionsRoutes.post(
  '/',
  refuseNonUserConversationWrites,
  zv('json', createInstructionSchema),
  async (c) => c.json(await createInstruction(actorOf(c), c.req.valid('json')), 201),
)

instructionsRoutes.patch(
  '/:instructionId',
  refuseNonUserConversationWrites,
  zv('json', updateInstructionSchema),
  async (c) =>
    c.json(await updateInstruction(actorOf(c), c.req.param('instructionId'), c.req.valid('json'))),
)

instructionsRoutes.delete('/:instructionId', refuseNonUserConversationWrites, async (c) => {
  await deleteInstruction(actorOf(c), c.req.param('instructionId'))

  return c.body(null, 204)
})
