import { extractAwsAccountId } from '@/lib/byos/account'

import { sweepAws, sweepGcp } from './exec-providers'
import {
  sweepAliyun,
  sweepAzure,
  sweepLinode,
  sweepOnprem,
  sweepTencent,
  sweepVolcengine,
} from './providers'
import { accountSegments, reportSweepFailure } from './sweep'

import type { AgentK8sBindings } from './bindings'
import type { AgentClusterContext } from './render'
import type { ContextSink } from './sweep'
import type { AwsRoleBinding } from '@/models'

type CacheEntry = {
  at: number
  contexts: AgentClusterContext[]
}

const CLUSTER_CACHE_TTL_MS = 10 * 60 * 1000
const clusterCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<AgentClusterContext[]>>()

function cacheKey(teamId: string, bindings: AgentK8sBindings): string {
  const ids = Object.entries(bindings)
    .flatMap(([provider, list]) => list.map((b) => `${provider}:${b.id.toHexString()}`))
    .sort((a, b) => a.localeCompare(b))

  return `${teamId}|${ids.join(',')}`
}

/**
 * Enumerate every cluster reachable through the given (already access-filtered)
 * bindings. Enumeration sweeps cloud list APIs, so results are cached per
 * team+binding set — a cluster bound mid-session shows up on the next sync
 * after the TTL, or immediately via sync-clusters.sh once the cache expires.
 * Per-binding failures are logged and skipped: a partial kubeconfig beats none.
 */
export async function collectAgentClusterContexts(opts: {
  teamId: string
  bindings: AgentK8sBindings
  /**
   * Bypass the cache and re-issue provider credentials. Exists for VKE, which
   * materializes in-cluster RBAC at kubeconfig ISSUE time: after the user
   * grants a role, the already-issued credential keeps 403ing forever.
   */
  fresh?: boolean
}): Promise<AgentClusterContext[]> {
  const key = cacheKey(opts.teamId, opts.bindings)
  const cached = clusterCache.get(key)

  if (!opts.fresh && cached && Date.now() - cached.at < CLUSTER_CACHE_TTL_MS) return cached.contexts

  // A fresh request must not join a sweep that is already reusing credentials.
  const pending = inflight.get(key)

  if (pending && !opts.fresh) return pending

  // ...so a sweep it superseded must not publish its result or free the slot.
  const work: Promise<AgentClusterContext[]> = enumerateContexts(opts)
    .then((contexts) => {
      if (inflight.get(key) === work) clusterCache.set(key, { at: Date.now(), contexts })

      return contexts
    })
    .finally(() => {
      if (inflight.get(key) === work) inflight.delete(key)
    })

  inflight.set(key, work)

  return work
}

async function enumerateContexts(opts: {
  teamId: string
  bindings: AgentK8sBindings
  fresh?: boolean
}): Promise<AgentClusterContext[]> {
  const { teamId, bindings } = opts
  const sink: ContextSink = { seen: new Set(), contexts: [] }

  const failed = (provider: string, account: string) => (err: unknown) => {
    reportSweepFailure(err, { provider, teamId, account })
  }

  // Multiple roles can be bound to one AWS account; enumerate each account
  // once through the first permitted role.
  const awsByAccount = new Map<string, AwsRoleBinding>()

  for (const binding of bindings.aws) {
    const accountId = extractAwsAccountId(binding.roleArn)

    if (accountId && !awsByAccount.has(accountId)) awsByAccount.set(accountId, binding)
  }

  const tencentAccounts = accountSegments(bindings.tencent)
  const aliyunAccounts = accountSegments(bindings.aliyun)
  const linodeAccounts = accountSegments(bindings.linode)
  const volcengineAccounts = accountSegments(bindings.volcengine)
  const azureAccounts = accountSegments(bindings.azure)

  await Promise.all([
    ...[...awsByAccount.entries()].map(async ([accountId, binding]) => {
      try {
        await sweepAws({ accountId, binding, teamId, sink })
      } catch (err) {
        failed('aws', accountId)(err)
      }
    }),
    ...bindings.gcp.map(async (binding) => {
      try {
        await sweepGcp({ binding, teamId, sink })
      } catch (err) {
        failed('gcp', binding.projectId)(err)
      }
    }),
    ...bindings.tencent.map(async (binding) => {
      const account = tencentAccounts.get(binding.id.toHexString()) ?? binding.id.toHexString()

      try {
        await sweepTencent({ binding, account, teamId, sink })
      } catch (err) {
        failed('tencent', account)(err)
      }
    }),
    ...bindings.aliyun.map(async (binding) => {
      const account = aliyunAccounts.get(binding.id.toHexString()) ?? binding.id.toHexString()

      try {
        await sweepAliyun({ binding, account, teamId, sink })
      } catch (err) {
        failed('aliyun', account)(err)
      }
    }),
    ...bindings.linode.map(async (binding) => {
      const account = linodeAccounts.get(binding.id.toHexString()) ?? binding.id.toHexString()

      try {
        await sweepLinode({ binding, account, teamId, sink })
      } catch (err) {
        failed('linode', account)(err)
      }
    }),
    ...bindings.volcengine.map(async (binding) => {
      const account = volcengineAccounts.get(binding.id.toHexString()) ?? binding.id.toHexString()

      try {
        await sweepVolcengine({ binding, account, teamId, sink, fresh: opts.fresh })
      } catch (err) {
        failed('volcengine', account)(err)
      }
    }),
    // A cluster enrolled but not yet given a credential is deliberately skipped:
    // the tunnel may be up, but there is nothing for a session to authenticate
    // with, and a context that can only 401 is worse than a missing one.
    ...bindings.onprem
      .filter((binding) => binding.encryptedKubeconfig)
      .map(async (binding) => {
        try {
          await sweepOnprem({ binding, teamId, sink })
        } catch (err) {
          failed('onprem', binding.label)(err)
        }
      }),
    ...bindings.azure.map(async (binding) => {
      const account = azureAccounts.get(binding.id.toHexString()) ?? binding.id.toHexString()

      try {
        await sweepAzure({ binding, account, teamId, sink })
      } catch (err) {
        failed('azure', account)(err)
      }
    }),
  ])

  return sink.contexts.sort((a, b) => a.contextName.localeCompare(b.contextName))
}

export function clearAgentClusterContextCache(): void {
  clusterCache.clear()
  inflight.clear()
}
