import { agentConversations } from '@/lib/agent/db'
import { relayConfigured, relayProxyUrl } from '@/lib/byos/relay-token'
import { getTeamMembership } from '@/lib/identity'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'

import { hasAgentK8sBindings, selectAgentK8sBindings } from './bindings'
import { collectAgentClusterContexts } from './collect'

import type { AgentClusterContext } from './render'
import type { AgentK8sBindings } from './bindings'
import type { AgentCredentialAccess } from '@/lib/agent/db'

export type AgentKubeconfigScope = 'all' | 'onprem'

export function scopeAgentK8sBindings(
  bindings: AgentK8sBindings,
  scope: AgentKubeconfigScope,
): AgentK8sBindings {
  if (scope === 'all') return bindings

  return {
    aws: [],
    gcp: [],
    tencent: [],
    aliyun: [],
    linode: [],
    volcengine: [],
    azure: [],
    onprem: bindings.onprem,
  }
}

/**
 * Cluster contexts an agent session may see, resolved from its stored team and
 * selected credentials. Shared by the session kubeconfig route and by the
 * claim-time prewarm — the prewarm exists because enumeration sweeps cloud
 * list APIs and would otherwise run inside the sandbox's first request, racing
 * the agent's first kubectl call.
 */
export async function agentSessionClusterContexts(
  userId: string,
  sessionId: string,
  opts: {
    fresh?: boolean
    scope?: AgentKubeconfigScope
    conversationOwnerUserId?: string
    credentialAccess?: Partial<AgentCredentialAccess>
  } = {},
): Promise<{ teamId: string; contexts: AgentClusterContext[] } | null> {
  const conversationOwnerUserId = opts.conversationOwnerUserId ?? userId
  const conversation = await agentConversations().findOne(
    { sessionId, userId: conversationOwnerUserId },
    { projection: { teamId: 1, credentialAccess: 1 } },
  )

  if (!conversation?.teamId) return null

  const membership = await getTeamMembership(userId, conversation.teamId)

  if (!membership) return null

  const bindingsDoc = await teamByosBindings().findOne(
    { _id: parseObjectId(conversation.teamId, 'teamId') },
    {
      projection: {
        awsRoles: 1,
        gcpServiceAccounts: 1,
        tencentAccounts: 1,
        aliyunAccounts: 1,
        linodeAccounts: 1,
        volcengineAccounts: 1,
        azureAccounts: 1,
        onpremClusters: 1,
      },
    },
  )
  const bindings = scopeAgentK8sBindings(
    selectAgentK8sBindings({
      bindings: bindingsDoc,
      selected: opts.credentialAccess ?? conversation.credentialAccess,
      userId,
    }),
    opts.scope ?? 'all',
  )

  if (!hasAgentK8sBindings(bindings)) return null

  const contexts = await collectAgentClusterContexts({
    teamId: conversation.teamId,
    bindings,
    fresh: opts.fresh,
  })

  return { teamId: conversation.teamId, contexts: withRelayProxies(contexts, sessionId) }
}

/**
 * Stamp a fresh, session-scoped proxy URL onto every relayed on-prem context.
 * Done here rather than during enumeration because enumeration is cached per
 * team+binding set, and these URLs carry a per-session token — caching one would
 * hand a session another session's credential.
 */
export function withRelayProxies(
  contexts: AgentClusterContext[],
  sessionId: string,
): AgentClusterContext[] {
  const configured = relayConfigured()

  return contexts.flatMap((ctx) => {
    if (!ctx.relayClusterKey) return [ctx]
    // Without a relay there is no route to this cluster's internal endpoint, and
    // a context that can only hang is worse than a missing one — the same call
    // parseRelayedKubeconfig makes about credentials we cannot use.
    if (!configured) return []

    return [{ ...ctx, proxyUrl: relayProxyUrl(ctx.relayClusterKey, sessionId) }]
  })
}
