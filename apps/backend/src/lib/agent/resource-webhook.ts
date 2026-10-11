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
  pull_request: pr
    .extend({ state: z.string().optional(), merged: z.boolean().optional() })
    .optional(),
  issue: pr.extend({ pull_request: z.unknown().optional() }).optional(),
  check_suite: z
    .object({ pull_requests: z.array(pr), status: z.string(), conclusion: z.string().nullable() })
    .optional(),
  // Commit status events carry the commit, not its PRs.
  sha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  state: z.string().optional(),
  context: z.string().max(255).optional(),
})

type Payload = z.infer<typeof payloadSchema>

function ownEvent(body: Payload) {
  const appSlug = getGithubAppSlug()

  return appSlug !== undefined && body.sender?.login === `${appSlug}[bot]`
}

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

/** Only route PR-related events; ignore edits and intermediate CI churn. */
export function githubResourceEvents(event: string, payload: unknown) {
  const parsed = payloadSchema.safeParse(payload)

  if (!parsed.success) return []
  const body = parsed.data
  const action = body.action ?? ''
  let numbers: number[] = []
  let actor: { login: string; repository: string } | undefined

  if (
    event === 'check_suite' &&
    action === 'completed' &&
    body.check_suite?.status === 'completed'
  ) {
    // CI results are reported against our own pushes, so only they skip the self-event filter.
    numbers = body.check_suite.pull_requests.map((pull) => pull.number)
  } else if (ownEvent(body)) {
    return []
  } else if (
    event === 'pull_request' &&
    ['opened', 'reopened', 'closed', 'synchronize', 'ready_for_review'].includes(action)
  ) {
    if (body.pull_request) numbers = [body.pull_request.number]
  } else if (event === 'pull_request_review' && ['submitted', 'dismissed'].includes(action)) {
    if (body.pull_request && body.sender?.type === 'Bot') {
      // Review Apps (council bots, Copilot) have no repository permission to check.
      numbers = [body.pull_request.number]
    } else if (body.pull_request && body.sender && body.repository.full_name) {
      numbers = [body.pull_request.number]
      actor = { login: body.sender.login, repository: body.repository.full_name }
    }
  } else if (event === 'issue_comment' && action === 'created' && body.issue?.pull_request) {
    // Bot comments stay out so bots replying to each other cannot loop a session.
    if (body.sender && body.sender.type !== 'Bot' && body.repository.full_name) {
      numbers = [body.issue.number]
      actor = { login: body.sender.login, repository: body.repository.full_name }
    }
  }

  return [...new Set(numbers)].map((number) => ({
    key: `github/${body.installation.id}/${body.repository.id}/${number}`,
    installationId: body.installation.id,
    actor,
    summary: `GitHub ${event}.${action}.`,
  }))
}

/** A finished commit status (pending is churn); its PRs are resolved by `statusEvents`. */
export function githubStatusCommit(event: string, payload: unknown) {
  if (event !== 'status') return null
  const parsed = payloadSchema.safeParse(payload)

  if (!parsed.success) return null
  const body = parsed.data

  if (!body.sha || !body.repository.full_name || ownEvent(body)) return null
  if (!['success', 'failure', 'error'].includes(body.state ?? '')) return null

  return {
    installationId: body.installation.id,
    repositoryId: body.repository.id,
    repository: body.repository.full_name,
    sha: body.sha,
    state: body.state,
    context: body.context ?? '',
  }
}

async function statusEvents(commit: NonNullable<ReturnType<typeof githubStatusCommit>>) {
  const prefix = `github/${String(commit.installationId)}/${String(commit.repositoryId)}/`
  // Statuses are frequent; only ask GitHub which PRs hold the commit when one is linked here.
  const linked = await agentConversations().findOne(
    { 'linkedResources.key': { $regex: `^${prefix}` }, archivedAt: { $exists: false } },
    { projection: { _id: 1 } },
  )

  if (!linked) return []
  const { token } = await getInstallationToken(commit.installationId)
  const response = await githubFetch(
    `${GITHUB_API}/repos/${commit.repository}/commits/${commit.sha}/pulls`,
    { headers: githubHeaders(token) },
  )

  if (!response.ok) {
    logEvent('warn', 'github.resource.commit_pulls_lookup_failed', {
      installation_id: commit.installationId,
      status: response.status,
    })

    return []
  }
  const pulls = (await response.json()) as {
    number: number
    state: string
    head: { sha: string }
  }[]

  // The lookup also returns merged PRs and PRs that moved past this commit; skip them.
  return pulls
    .filter((pull) => pull.state === 'open' && pull.head.sha === commit.sha)
    .map((pull) => ({
      key: `${prefix}${String(pull.number)}`,
      installationId: commit.installationId,
      actor: undefined,
      summary: `GitHub status.${commit.state ?? ''} (${commit.context}).`,
    }))
}

/**
 * The PR state a linked tag should show after an open/close. Unlike wakeups this
 * includes our own events: agents merge through the App, and a tag that only
 * refreshed on a wake would stay "open" after every such merge.
 */
export function githubPullState(event: string, payload: unknown) {
  const parsed = payloadSchema.safeParse(payload)

  if (event !== 'pull_request' || !parsed.success) return null
  const { action, installation, repository, pull_request: pull } = parsed.data

  if (!pull?.state || !['closed', 'reopened'].includes(action ?? '')) return null

  return {
    key: `github/${String(installation.id)}/${String(repository.id)}/${String(pull.number)}`,
    state: pull.merged ? 'merged' : pull.state,
  }
}

export type ResourceTurn = {
  sessionId: string
  resourceId: string
  messageId: string
  summary: string
}

export async function routeResourceWebhook(event: string, payload: unknown, deliveryId: string) {
  const pullState = githubPullState(event, payload)

  if (pullState) {
    await agentConversations().updateMany(
      { 'linkedResources.key': pullState.key },
      { $set: { 'linkedResources.$[resource].state': pullState.state } },
      { arrayFilters: [{ 'resource.key': pullState.key }] },
    )
  }
  const commit = githubStatusCommit(event, payload)
  const events = commit ? await statusEvents(commit) : githubResourceEvents(event, payload)

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
