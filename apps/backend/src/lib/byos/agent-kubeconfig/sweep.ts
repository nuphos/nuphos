import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { parseRelayedKubeconfig } from './render'

import type { AgentClusterContext } from './render'
import type { ObjectId } from 'mongodb'

export type ContextSink = { seen: Set<string>; contexts: AgentClusterContext[] }

/**
 * Take the first context name that is still free. Names are what the agent
 * types on every command, so the readable form wins; the fallbacks exist
 * because one account can hold two clusters with the same name in different
 * regions, and a silent collision would hide one of them.
 *
 * Claiming is synchronous and happens before any credential fetch, so a name
 * never depends on which cloud API answered first.
 */
export function claimContextName(sink: ContextSink, candidates: string[]): string | null {
  for (const name of candidates) {
    if (sink.seen.has(name)) continue
    sink.seen.add(name)

    return name
  }

  return null
}

// Scanned rather than matched with /^-+|-+$/: an anchored run of dashes makes
// the regex engine retry from every offset, which is quadratic on hostile input.
function trimDashes(value: string): string {
  let start = 0
  let end = value.length

  while (start < end && value[start] === '-') start += 1
  while (end > start && value[end - 1] === '-') end -= 1

  return value.slice(start, end)
}

function slugSegment(label: string): string {
  const collapsed = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')

  return trimDashes(collapsed).slice(0, 40)
}

/**
 * Binding id → the account segment of its context names. Labels are what the
 * user recognises, so prefer them, and fall back to the binding id when two
 * labels slug the same — an ambiguous segment is worse than an ugly one.
 */
export function accountSegments(bindings: { id: ObjectId; label: string }[]): Map<string, string> {
  const slugs = bindings.map((binding) => slugSegment(binding.label))
  const counts = new Map<string, number>()

  for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1)

  return new Map(
    bindings.map((binding, i) => {
      const slug = slugs[i] ?? ''

      return [
        binding.id.toHexString(),
        slug && counts.get(slug) === 1 ? slug : binding.id.toHexString(),
      ]
    }),
  )
}

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++]

      if (item !== undefined) await fn(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** How many provider kubeconfigs to fetch at once, per account. */
const RELAY_FETCH_CONCURRENCY = 4

export type RelayedCluster = {
  name: string
  region: string
  /** Provider-unique cluster id — only used to break a context-name tie. */
  id: string
  /** Fetch the provider's own kubeconfig for this cluster. */
  load: () => Promise<string | null>
}

/**
 * Add one context per cluster of a provider that hands back a complete
 * kubeconfig. Their credentials are long-lived (client certificates or
 * multi-month tokens), so the user block is embedded rather than fetched
 * through the exec plugin — the agent cannot tell the two apart.
 *
 * A cluster whose kubeconfig can't be fetched is skipped, not fatal: the most
 * common cause is a cluster with no public API endpoint, which the sandbox
 * could not reach even with a credential.
 */
export async function addRelayedContexts(opts: {
  provider: string
  account: string
  teamId: string
  clusters: RelayedCluster[]
  sink: ContextSink
  /** Merged into every context produced here (the relay's cluster key). */
  extra?: Pick<AgentClusterContext, 'relayClusterKey'>
}): Promise<void> {
  const prefix = `${opts.provider}/${opts.account}`
  const named = opts.clusters.flatMap((cluster) => {
    const contextName = claimContextName(opts.sink, [
      `${prefix}/${cluster.name}`,
      `${prefix}/${cluster.name}@${cluster.region}`,
      `${prefix}/${cluster.id}`,
    ])

    return contextName ? [{ cluster, contextName }] : []
  })

  await mapPool(named, RELAY_FETCH_CONCURRENCY, async ({ cluster, contextName }) => {
    try {
      const text = await cluster.load()
      const relayed = text ? parseRelayedKubeconfig(text) : null

      if (!relayed) return
      opts.sink.contexts.push({
        contextName,
        endpoint: relayed.endpoint,
        caBase64: relayed.caBase64,
        user: relayed.user,
        ...opts.extra,
      })
    } catch (err) {
      logError('agent.kubeconfig.cluster_skipped', err, {
        provider: opts.provider,
        team_id: opts.teamId,
        context_name: contextName,
      })
    }
  })
}

/**
 * True when the provider answered that its Kubernetes service is switched off on
 * this account — the account holds no clusters, and none can appear until
 * someone enables the API.
 */
function kubernetesServiceDisabled(err: unknown): boolean {
  if (err instanceof AppError) return err.code === 'gcp_api_disabled'

  return (err as { reason?: unknown } | null | undefined)?.reason === 'SERVICE_DISABLED'
}

/**
 * The sweep is speculative: it asks every selected binding for clusters, and a
 * compute-only account answering "no Kubernetes here" is the expected outcome,
 * not an incident. Only failures that leave the answer unknown are errors.
 */
export function reportSweepFailure(
  err: unknown,
  ctx: { provider: string; teamId: string; account: string },
): void {
  const properties = { provider: ctx.provider, team_id: ctx.teamId, account: ctx.account }

  if (kubernetesServiceDisabled(err)) {
    logEvent('info', 'agent.kubeconfig.no_clusters', { ...properties, reason: 'service_disabled' })

    return
  }
  logError('agent.kubeconfig.enumerate_failed', err, properties)
}
