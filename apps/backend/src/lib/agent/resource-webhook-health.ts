import { z } from 'zod'

import { logEvent } from '@/lib/observability'

import { agentConversations } from './db'
import { fetchPullHealth } from './github-pull-health'

const pr = z.object({ number: z.number().int().positive() })
// The parts of a GitHub webhook that say which linked PR an event is about.
const healthPayload = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional(),
  }),
  action: z.string().max(100).optional(),
  pull_request: pr.optional(),
  check_suite: z
    .object({
      pull_requests: z.array(pr),
      head_sha: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
    })
    .optional(),
})

/**
 * The linked PRs whose tag health an event may change: new pushes, finished
 * CI, reviews. Our own events count too, since agents push through the App.
 */
export function githubHealthTargets(event: string, payload: unknown) {
  const parsed = healthPayload.safeParse(payload)

  if (!parsed.success || !parsed.data.repository.full_name) return []
  const body = parsed.data
  const action = body.action ?? ''
  let numbers: number[] = []

  if (event === 'check_suite' && action === 'completed')
    numbers = body.check_suite?.pull_requests.map((pull) => pull.number) ?? []
  else if (
    event === 'pull_request' &&
    ['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(action)
  )
    numbers = body.pull_request ? [body.pull_request.number] : []
  else if (event === 'pull_request_review' && ['submitted', 'dismissed'].includes(action))
    numbers = body.pull_request ? [body.pull_request.number] : []

  return [...new Set(numbers)].map((number) => ({
    key: `github/${String(body.installation.id)}/${String(body.repository.id)}/${String(number)}`,
    installationId: body.installation.id,
    repository: body.repository.full_name!,
    number,
  }))
}

/**
 * A finished check suite GitHub tied to no PR. A fork head's suite always has
 * empty `pull_requests`, so its PRs have to be found from the commit.
 */
export function githubUnattachedSuiteCommit(event: string, payload: unknown) {
  const parsed = healthPayload.safeParse(payload)

  if (event !== 'check_suite' || !parsed.success) return null
  const { action, check_suite: suite, installation, repository } = parsed.data

  if (action !== 'completed' || !suite?.head_sha || suite.pull_requests.length) return null
  if (!repository.full_name) return null

  return {
    installationId: installation.id,
    repositoryId: repository.id,
    repository: repository.full_name,
    sha: suite.head_sha,
  }
}

/** A linked PR to refresh; a status event knows the repository but not the number, so it comes from the key. */
export type HealthTarget = { key: string; installationId: number; repository: string }

/** Re-reads what blocks a linked PR and stores it on every tag for it. */
async function refreshPullHealth(target: HealthTarget) {
  const linked = await agentConversations().findOne(
    { 'linkedResources.key': target.key },
    { projection: { _id: 1 } },
  )

  if (!linked) return
  const number = Number(target.key.split('/').pop())
  const health = await fetchPullHealth(target.installationId, target.repository, number)

  await agentConversations().updateMany(
    { 'linkedResources.key': target.key },
    { $set: { 'linkedResources.$[resource].health': health } },
    { arrayFilters: [{ 'resource.key': target.key }] },
  )
}

export async function refreshLinkedPullHealth(targets: HealthTarget[]) {
  await Promise.all(
    targets.map((target) =>
      refreshPullHealth(target).catch((error: unknown) => {
        logEvent('warn', 'github.resource.health_refresh_failed', { error: String(error) })
      }),
    ),
  )
}
