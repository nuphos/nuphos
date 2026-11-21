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

// Runtime writes are allowed only while a turn is live; with no turn this
// fails closed.
const refuseIdleConversationWrites: MiddlewareHandler<{
  Variables: InstructionsVariables
}> = async (c, next) => {
  const agent = c.get('conversationAgent')

  if (agent) {
    const conversation = await getConversationBySessionId(agent.sessionId)

    if (!conversation?.claudeCodePreviewContext?.activeTurnKey) {
      throw new AppError(
        403,
        'instructions_active_turn_required',
        'Instructions can only be changed while a turn is running',
      )
    }
  }
  await next()
}

instructionsRoutes.get('/', async (c) => c.json(await listInstructions(actorOf(c))))

instructionsRoutes.post(
  '/',
  refuseIdleConversationWrites,
  zv('json', createInstructionSchema),
  async (c) => c.json(await createInstruction(actorOf(c), c.req.valid('json')), 201),
)

instructionsRoutes.patch(
  '/:instructionId',
  refuseIdleConversationWrites,
  zv('json', updateInstructionSchema),
  async (c) =>
    c.json(await updateInstruction(actorOf(c), c.req.param('instructionId'), c.req.valid('json'))),
)

instructionsRoutes.delete('/:instructionId', refuseIdleConversationWrites, async (c) => {
  await deleteInstruction(actorOf(c), c.req.param('instructionId'))

  return c.body(null, 204)
})
