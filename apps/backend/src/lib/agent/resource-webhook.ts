import { createHash } from 'node:crypto'

import { z } from 'zod'

import { getGithubAppSlug } from '@/lib/byos/github-app-auth'

import { agentConversations, getConversationBySessionId } from './db'
import { resourceCredentialAllowed } from './session-resources'
import { enqueueResourceTurn } from './thread-queue'

import type { SessionResource } from './session-resources'

const pr = z.object({ number: z.number().int().positive() })
const payloadSchema = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive() }),
  action: z.string().max(100).optional(),
  sender: z.object({ type: z.string(), login: z.string() }).optional(),
  pull_request: pr.optional(),
  issue: pr.extend({ pull_request: z.unknown().optional() }).optional(),
  check_run: z
    .object({ pull_requests: z.array(pr), status: z.string(), conclusion: z.string().nullable() })
    .optional(),
  check_suite: z
    .object({ pull_requests: z.array(pr), status: z.string(), conclusion: z.string().nullable() })
    .optional(),
  workflow_run: z
    .object({ pull_requests: z.array(pr), status: z.string(), conclusion: z.string().nullable() })
    .optional(),
})

/** Only route PR-related events; ignore edits and intermediate CI churn. */
export function githubResourceEvents(event: string, payload: unknown) {
  const parsed = payloadSchema.safeParse(payload)

  if (!parsed.success) return []
  const body = parsed.data
  const appSlug = getGithubAppSlug()

  if (appSlug && body.sender?.login === `${appSlug}[bot]`) return []
  const action = body.action ?? ''
  let numbers: number[] = []

  if (
    event === 'pull_request' &&
    ['opened', 'reopened', 'closed', 'synchronize', 'ready_for_review'].includes(action)
  ) {
    if (body.pull_request) numbers = [body.pull_request.number]
  } else if (event === 'pull_request_review' && ['submitted', 'dismissed'].includes(action)) {
    if (body.pull_request) numbers = [body.pull_request.number]
  } else if (event === 'issue_comment' && action === 'created' && body.issue?.pull_request) {
    // Avoid waking on our own replies; review bots report through review/check events.
    if (body.sender?.type !== 'Bot') numbers = [body.issue.number]
  } else if (
    ['check_run', 'check_suite', 'workflow_run'].includes(event) &&
    action === 'completed'
  ) {
    const check =
      event === 'check_run'
        ? body.check_run
        : event === 'check_suite'
          ? body.check_suite
          : body.workflow_run

    if (check?.status === 'completed') numbers = check.pull_requests.map((pull) => pull.number)
  }

  return [...new Set(numbers)].map((number) => ({
    key: `github/${body.installation.id}/${body.repository.id}/${number}`,
    summary: `GitHub ${event}.${action}. Inspect the linked PR for current details and continue the existing task.`,
  }))
}

export type ResourceTurn = {
  sessionId: string
  resourceId: string
  messageId: string
  summary: string
}

export async function routeResourceWebhook(event: string, payload: unknown, deliveryId: string) {
  const events = githubResourceEvents(event, payload)

  if (!events.length) return
  if (!deliveryId || deliveryId.length > 200)
    throw new Error('A bounded GitHub delivery ID is required')
  for (const routed of events) {
    const conversations = agentConversations().find({
      'linkedResources.key': routed.key,
      archivedAt: { $exists: false },
    })

    for await (const conversation of conversations) {
      const resource = conversation.linkedResources?.find((entry) => entry.key === routed.key)

      if (!resource || !(await resourceCredentialAllowed(conversation, resource))) continue
      const messageId = createHash('sha256')
        .update(JSON.stringify([conversation.sessionId, resource.id, deliveryId]))
        .digest('hex')

      await enqueueResourceTurn({
        sessionId: conversation.sessionId,
        resourceId: resource.id,
        messageId,
        summary: routed.summary,
      })
    }
  }
}

export async function authorizedResourceTurn(data: ResourceTurn) {
  const conversation = await getConversationBySessionId(data.sessionId)
  const resource: SessionResource | undefined = conversation?.linkedResources?.find(
    (entry) => entry.id === data.resourceId,
  )

  if (
    !conversation ||
    conversation.archivedAt ||
    !resource ||
    !(await resourceCredentialAllowed(conversation, resource))
  )
    return null

  return { conversation, resource }
}
