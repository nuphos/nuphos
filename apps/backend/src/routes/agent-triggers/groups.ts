import { chunkGroupMembers, groupWebhookUrl } from '@/lib/agent/tools-triggers-shared'
import { assertTeamTriggerRole } from '@/lib/agent/trigger-access'
import {
  createTriggerGroup,
  listTriggerGroups,
  testTriggerGroup,
  transferTriggerGroupExecutionPrincipal,
  updateTriggerGroup,
} from '@/lib/agent/trigger-group-service'
import { AppError } from '@/lib/errors'
import { jsonObjectBody, parseSlackDestination, triggerActor } from '@/routes/agent-triggers/shared'

import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

// Watch Groups manage one shared ingress per provider/integration partition.
// Keep these routes above /:triggerId so "groups" is never parsed as a trigger
// id.
export function registerTriggerGroupRoutes(
  agentTriggersRoutes: Hono<{ Variables: AuthVariables }>,
) {
  agentTriggersRoutes.get('/groups', async (c) => {
    const actor = await triggerActor(c, c.req.query('teamId'))

    await assertTeamTriggerRole(actor, 'read')

    return c.json(await listTriggerGroups(actor))
  })

  agentTriggersRoutes.post('/groups', async (c) => {
    const body = await jsonObjectBody(c)

    if (typeof body.name !== 'string') {
      throw new AppError(400, 'invalid_request', 'name is required')
    }
    if (typeof body.messageTemplate !== 'string') {
      throw new AppError(400, 'invalid_request', 'messageTemplate is required')
    }
    if (
      !Array.isArray(body.memberKeys) ||
      !body.memberKeys.every((key) => typeof key === 'string')
    ) {
      throw new AppError(400, 'invalid_request', 'memberKeys must be an array of strings')
    }
    const slackDestination = parseSlackDestination(body.slackDestination)

    const created = await createTriggerGroup(
      {
        name: body.name,
        memberKeys: body.memberKeys,
        messageTemplate: body.messageTemplate,
        ...(typeof body.minIntervalSeconds === 'number'
          ? { minIntervalSeconds: body.minIntervalSeconds }
          : {}),
        ...(slackDestination ? { slackDestination } : {}),
      },
      await triggerActor(c, body.teamId),
    )

    return c.json(
      {
        group: created.group,
        ingresses: created.ingresses.map((ingress) => ({
          ...ingress,
          webhookUrl: groupWebhookUrl(ingress.id, ingress.partitionKey),
          attachmentBatches: chunkGroupMembers(ingress.memberKeys),
          secretHeader: 'X-Webhook-Secret',
        })),
      },
      201,
    )
  })

  agentTriggersRoutes.patch('/groups/:groupId', async (c) => {
    const { groupId } = c.req.param()
    const body = await jsonObjectBody(c)

    return c.json(
      await updateTriggerGroup(
        groupId,
        await triggerActor(c, body.teamId ?? c.req.query('teamId')),
        {
          ...(typeof body.name === 'string' ? { name: body.name } : {}),
          ...(typeof body.messageTemplate === 'string'
            ? { messageTemplate: body.messageTemplate }
            : {}),
          ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        },
      ),
    )
  })

  // Administrator-only: move who a Watch Group runs as. Separate from PATCH by
  // design — editing a Group must never promote it to the editor's permissions.
  agentTriggersRoutes.post('/groups/:groupId/execution-principal', async (c) => {
    const { groupId } = c.req.param()
    const body = await jsonObjectBody(c)

    if (typeof body.userId !== 'string') {
      throw new AppError(400, 'invalid_request', 'userId is required')
    }

    return c.json(
      await transferTriggerGroupExecutionPrincipal(
        groupId,
        await triggerActor(c, body.teamId ?? c.req.query('teamId')),
        body.userId,
      ),
    )
  })

  agentTriggersRoutes.post('/groups/:groupId/test-fire', async (c) => {
    const { groupId } = c.req.param()

    return c.json(await testTriggerGroup(groupId, await triggerActor(c, c.req.query('teamId'))))
  })
}
