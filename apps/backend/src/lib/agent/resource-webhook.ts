import { createHash } from 'node:crypto'

import { z } from 'zod'

import { getInstallationToken } from '@/lib/byos/github'
import { getGithubAppSlug } from '@/lib/byos/github-app-auth'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { logEvent } from '@/lib/observability'

import { agentConversations, getConversationBySessionId } from './db'
import { resourceCredentialAllowed } from './session-resources'
import { enqueueResourceTurn } from './thread-queue'

import type { SessionResource } from './session-resources'

const pr = z.object({ number: z.number().int().positive() })
const payloadSchema = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional(),
  }),
  action: z.string().max(100).optional(),
  sender: z.object({ type: z.string(), login: z.string() }).optional(),
  pull_request: pr.optional(),
  issue: pr.extend({ pull_request: z.unknown().optional() }).optional(),
  check_suite: z
    .object({ pull_requests: z.array(pr), status: z.string(), conclusion: z.string().nullable() })
    .optional(),
})

// author_association reports private org members as CONTRIBUTOR/NONE, so ask GitHub directly.
async function canPush(installationId: number, repository: string, login: string) {
  const { token } = await getInstallationToken(installationId)
  const response = await githubFetch(
    `${GITHUB_API}/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  )

  if (!response.ok) {
    logEvent('warn', 'github.resource.permission_lookup_failed', {
      installation_id: installationId,
      status: response.status,
    })

    return false
  }
  // Legacy `permission` folds maintain into write and triage into read; role_name would not.
  const { permission } = (await response.json()) as { permission?: string }

  return permission === 'admin' || permission === 'write'
}

/** Only route PR-related events; ignore edits and intermediate CI churn. */
export function githubResourceEvents(event: string, payload: unknown) {
  const parsed = payloadSchema.safeParse(payload)

  if (!parsed.success) return []
  const body = parsed.data
  const appSlug = getGithubAppSlug()

  // CI results are reported against our own pushes, so only they skip the self-event filter.
  const ownEvent = appSlug !== undefined && body.sender?.login === `${appSlug}[bot]`
  const action = body.action ?? ''
  let numbers: number[] = []
  let actor: { login: string; repository: string } | undefined

  if (
    event === 'check_suite' &&
    action === 'completed' &&
    body.check_suite?.status === 'completed'
  ) {
    numbers = body.check_suite.pull_requests.map((pull) => pull.number)
  } else if (ownEvent) {
    return []
  } else if (
    event === 'pull_request' &&
    ['opened', 'reopened', 'closed', 'synchronize', 'ready_for_review'].includes(action)
  ) {
    if (body.pull_request) numbers = [body.pull_request.number]
  } else if (event === 'pull_request_review' && ['submitted', 'dismissed'].includes(action)) {
    if (body.pull_request && body.sender && body.repository.full_name) {
      numbers = [body.pull_request.number]
      actor = { login: body.sender.login, repository: body.repository.full_name }
    }
  } else if (event === 'issue_comment' && action === 'created' && body.issue?.pull_request) {
    // Avoid waking on our own replies; review bots report through review/check events.
    if (body.sender && body.sender.type !== 'Bot' && body.repository.full_name) {
      numbers = [body.issue.number]
      actor = { login: body.sender.login, repository: body.repository.full_name }
    }
  }

  return [...new Set(numbers)].map((number) => ({
    key: `github/${body.installation.id}/${body.repository.id}/${number}`,
    installationId: body.installation.id,
    actor,
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
  let actorAllowed: Promise<boolean> | undefined

  for (const routed of events) {
    const conversations = agentConversations().find({
      'linkedResources.key': routed.key,
      archivedAt: { $exists: false },
    })

    for await (const conversation of conversations) {
      const resource = conversation.linkedResources?.find((entry) => entry.key === routed.key)

      if (!resource || !(await resourceCredentialAllowed(conversation, resource))) continue
      // Only people who can push may wake a session; checked once, after a linked PR matches.
      if (routed.actor) {
        actorAllowed ??= canPush(routed.installationId, routed.actor.repository, routed.actor.login)
        if (!(await actorAllowed)) return
      }
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
