import { config } from '@/config'
import { canUseAllowList } from '@/lib/byos/access'
import { parseRelayedKubeconfig, renderAgentKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { readOnpremAccess } from '@/lib/byos/onprem-access'
import { relayProxyUrl, relayStatusCredential } from '@/lib/byos/relay-token'
import { decryptOnpremKubeconfig } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { logError } from '@/lib/observability'
import { loadBinding, requireRelay } from '@/routes/onprem-clusters/shared'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerOnpremStatusRoutes(
  onpremClustersRoutes: Hono<{ Variables: TeamAuthVariables }>,
) {
  /**
   * Whether the customer's pod has actually connected. Worth a round trip to the
   * relay: "enrolled" and "reachable" are different states, and without this the
   * only way to tell them apart is to run a kubectl command and read the error.
   */
  onpremClustersRoutes.get('/:clusterId/connection', async (c) => {
    requireRelay()
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await loadBinding(teamId, c.req.param('clusterId'))

    const statusUrl = config.relay.statusUrl

    if (!statusUrl) {
      return c.json({ connected: null, idleConnections: null, reason: 'relay_status_unavailable' })
    }
    try {
      const response = await fetch(`${statusUrl}/status`, {
        headers: { Authorization: `Bearer ${relayStatusCredential()}` },
        signal: AbortSignal.timeout(5_000),
      })

      if (!response.ok) throw new Error(`relay status responded ${String(response.status)}`)
      const body = (await response.json()) as {
        clusters?: Record<string, { idle?: number; lastSeenAt?: string; agentVersion?: string }>
      }
      const presence = body.clusters?.[binding.clusterKey]
      const idle = presence?.idle ?? 0

      return c.json({
        connected: idle > 0,
        idleConnections: idle,
        // Present even at idle 0: "was here a minute ago" and "never showed up"
        // are different answers, and the install screen has to tell them apart.
        lastSeenAt: presence?.lastSeenAt ?? null,
        agentVersion: presence?.agentVersion ?? null,
      })
    } catch (err) {
      logError('relay.status_unavailable', err, { team_id: c.get('teamId') })

      return c.json({ connected: null, idleConnections: null, reason: 'relay_status_unavailable' })
    }
  })

  /**
   * What the credential can actually do, answered by the customer's own API server
   * through the tunnel. Shown at the end of enrolment so the operator sees the
   * grant they just made rather than a promise from us.
   */
  onpremClustersRoutes.get('/:clusterId/access', async (c) => {
    requireRelay()
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await loadBinding(teamId, c.req.param('clusterId'))

    if (!binding.encryptedKubeconfig) {
      throw new AppError(
        409,
        'onprem_cluster_has_no_credential',
        'This cluster has no credential yet. Add a kubeconfig before asking what it can do.',
      )
    }
    const readout = await readOnpremAccess({
      kubeconfig: decryptOnpremKubeconfig(binding.encryptedKubeconfig),
      // Not tied to an agent session: this check is the console asking on the
      // operator's behalf, so it gets its own short-lived token.
      proxyUrl: relayProxyUrl(binding.clusterKey, `console:${binding.id.toHexString()}`),
      teamId: c.get('teamId'),
    })

    return c.json(readout)
  })

  /**
   * Member-scoped kubeconfig used by the desktop's shared Kubernetes explorer.
   * The cluster credential is delivered only after the team allow-list check;
   * the Nuphos relay URL is additionally scoped to this user and expires.
   */
  onpremClustersRoutes.get('/:clusterId/kubeconfig', async (c) => {
    requireRelay()
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await loadBinding(teamId, c.req.param('clusterId'))

    if (!canUseAllowList(binding.access?.memberAllowList, c.get('userId'))) {
      throw new AppError(403, 'forbidden', 'You do not have access to this on-prem cluster.')
    }
    if (!binding.encryptedKubeconfig) {
      throw new AppError(
        409,
        'onprem_cluster_has_no_credential',
        'This cluster needs an access credential before its resources can be opened.',
      )
    }
    const parsed = parseRelayedKubeconfig(decryptOnpremKubeconfig(binding.encryptedKubeconfig))

    if (!parsed) {
      throw new AppError(409, 'onprem_kubeconfig_unusable', 'This cluster credential is unusable.')
    }
    const yaml = renderAgentKubeconfig([
      {
        contextName: `onprem/${binding.label}/cluster`,
        ...parsed,
        proxyUrl: relayProxyUrl(
          binding.clusterKey,
          `desktop:${c.get('userId')}:${binding.id.toHexString()}`,
        ),
      },
    ])

    c.header('Cache-Control', 'no-store')
    c.header('Content-Type', 'application/yaml; charset=utf-8')

    return c.body(yaml)
  })
}
