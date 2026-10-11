import { createHash } from 'node:crypto'

import { z } from 'zod'

import { getInstallationToken } from '@/lib/byos/github'
import { getGithubAppSlug } from '@/lib/byos/github-app-auth'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

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
    .object({
      head_sha: z.string().regex(/^[0-9a-f]{40}$/),
      pull_requests: z.array(pr),
      status: z.string(),
      conclusion: z.string().nullable(),
    })
    .optional(),
})

function githubHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
}

// author_association reports private org members as CONTRIBUTOR/NONE, so ask GitHub directly.
async function canPush(installationId: number, repository: string, login: string) {
  const { token } = await getInstallationToken(installationId)
  const response = await githubFetch(
    `${GITHUB_API}/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
    { headers: githubHeaders(token) },
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

/**
 * One wake per commit once all of its CI is done, instead of one per reporting App.
 * Returns a key naming that finished set, or null while any suite is still running.
 * When GitHub cannot say, `fallback` keeps the wake: at worst one extra for the commit.
 */
async function finishedCi(
  installationId: number,
  repository: string,
  sha: string,
  fallback: string,
) {
  const { token } = await getInstallationToken(installationId)
  const response = await githubFetch(
    `${GITHUB_API}/repos/${repository}/commits/${sha}/check-suites?per_page=100`,
    { headers: githubHeaders(token) },
  )

  if (!response.ok) {
    logEvent('warn', 'github.resource.check_suites_lookup_failed', {
      installation_id: installationId,
      status: response.status,
    })

    return fallback
  }
  const { total_count: total, check_suites: suites } = (await response.json()) as {
    total_count: number
    check_suites: {
      id: number
      status: string
      updated_at: string
      latest_check_runs_count: number
    }[]
  }

  if (total > suites.length) return fallback
  // Apps with checks permission get an empty suite that stays queued forever.
  const running = suites.filter((suite) => suite.latest_check_runs_count > 0)

  if (running.some((suite) => suite.status !== 'completed')) return null

  // A suite that shows up later, or a re-run finishing again, changes the key.
  return `ci:${sha}:${running
    .map((suite) => `${String(suite.id)}@${suite.updated_at}`)
    .sort((a, b) => a.localeCompare(b))
    .join(',')}`
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
  let ci: { sha: string; repository: string } | undefined

  if (
    event === 'check_suite' &&
    action === 'completed' &&
    body.check_suite?.status === 'completed'
  ) {
    if (body.repository.full_name) {
      numbers = body.check_suite.pull_requests.map((pull) => pull.number)
      ci = { sha: body.check_suite.head_sha, repository: body.repository.full_name }
    }
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
    ci,
    summary: `GitHub ${event}.${action}. Inspect the linked PR for current details and continue the existing task.`,
  }))
}

export type ResourceTurn = {
  sessionId: string
  resourceId: string
  messageId: string
  summary: string
  /** A review or comment from someone with push access; never rate limited. */
  fromPerson?: boolean
}

export async function routeResourceWebhook(event: string, payload: unknown, deliveryId: string) {
  const events = githubResourceEvents(event, payload)

  if (!events.length) return
  if (!deliveryId || deliveryId.length > 200)
    throw new Error('A bounded GitHub delivery ID is required')
  let actorAllowed: Promise<boolean> | undefined
  let ciKey: Promise<string | null> | undefined

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
      // Every suite reports separately; wait for the last and wake once for the commit.
      if (routed.ci) {
        ciKey ??= finishedCi(routed.installationId, routed.ci.repository, routed.ci.sha, deliveryId)
      }
      const dedupe = routed.ci ? await ciKey : deliveryId

      if (!dedupe) return
      const messageId = createHash('sha256')
        .update(JSON.stringify([conversation.sessionId, resource.id, dedupe]))
        .digest('hex')

      await enqueueResourceTurn({
        sessionId: conversation.sessionId,
        resourceId: resource.id,
        messageId,
        summary: routed.summary,
        fromPerson: Boolean(routed.actor),
      })
    }
  }
}

// Backstop for a session that keeps waking itself (push, CI result, push again): after this
// many push or CI wakes in a row with no review or comment from a person, they stop.
const UNATTENDED_WAKES = 10

/** A person's review or comment re-arms push and CI wakeups for the binding. */
export async function resetWakeSlots(data: ResourceTurn) {
  await withRedis((redis) => redis.del(wakeKey(data)))
}

function wakeKey(data: ResourceTurn) {
  return `atlas:resource-wakes:${data.sessionId}:${data.resourceId}`
}

export async function takeWakeSlot(data: ResourceTurn) {
  const key = wakeKey(data)
  const count = await withRedis(async (redis) => {
    // The day-long expiry only clears bindings nobody returns to.
    const results = await redis.multi().set(key, 0, 'EX', 86400, 'NX').incr(key).exec()

    return Number(results?.[1]?.[1])
  })

  // Redis is required to enqueue at all; a failed count must not swallow a real wakeup.
  if (count === null || !Number.isFinite(count) || count <= UNATTENDED_WAKES) return true
  logEvent('warn', 'agent.resource.rate_limited', {
    session_id: data.sessionId,
    resource_id: data.resourceId,
  })

  return false
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
