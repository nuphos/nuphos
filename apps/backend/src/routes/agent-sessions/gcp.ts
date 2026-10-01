import { Hono } from 'hono'

import { config } from '@/config'
import { agentSubjectId } from '@/lib/agents/identity'
import { canUseAllowList } from '@/lib/byos/access'
import { getGkeAdminAccess, impersonateSa, listGkeClusters } from '@/lib/byos/gcp'
import { renderKubeconfig } from '@/lib/byos/kubeconfig'
import { AppError } from '@/lib/errors'
import { requireGcpProject, requireGcpMemberAccess } from '@/middleware/auth'
import { execCredentialResponse, getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { GcpHandle, GkeAdminAccess } from '@/lib/byos/gcp'
import type { GcpProjectVariables } from '@/middleware/auth'
import type { AgentGcpVars, AgentVars } from '@/routes/agent-sessions/shared'
import type { Context, MiddlewareHandler } from 'hono'

export const projectScoped = new Hono<{ Variables: AgentVars & GcpProjectVariables }>()

projectScoped.use('*', requireGcpProject())
projectScoped.use('*', requireGcpMemberAccess())
projectScoped.use('*', requireSelectedGcpAgentCredential())

projectScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const projectId = c.get('projectId')
  const serviceAccountEmail = c.get('serviceAccountEmail')
  const impersonated = await impersonateSa(serviceAccountEmail, c.get('teamId'))
  const tokenResp = await impersonated.getAccessToken()

  if (!tokenResp.token) {
    throw new AppError(502, 'token_unavailable', 'Failed to mint impersonated access token')
  }
  const expiresAt = new Date(Date.now() + config.byos.gcp.tokenLifetimeSec * 1000)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('X-Credentials-Expires-At', expiresAt.toISOString())

  return c.json({
    accessToken: tokenResp.token,
    projectId,
    serviceAccountEmail,
    expiresAt: expiresAt.toISOString(),
  })
})

/** Same shape the member routes build — see routes/gcp-projects/handle.ts. */
function gcpHandleFor(c: Context<{ Variables: AgentVars & GcpProjectVariables }>): GcpHandle {
  return {
    projectId: c.get('projectId'),
    serviceAccountEmail: c.get('serviceAccountEmail'),
    teamId: c.get('teamId'),
  }
}

async function resolveGkeAccess(
  handle: GcpHandle,
  clusterName: string,
  location: string | undefined,
): Promise<GkeAdminAccess> {
  if (!location) {
    const list = await listGkeClusters(handle)
    const found = list.clusters.find((cl) => cl.name === clusterName)

    if (!found) {
      throw new AppError(
        404,
        'cluster_not_found',
        `Cluster ${clusterName} not found in this project`,
      )
    }
    location = found.region
  }
  const access = await getGkeAdminAccess(handle, location, clusterName)

  if (!access)
    throw new AppError(404, 'cluster_not_found', `Cluster ${clusterName} not found in ${location}`)

  return access
}

projectScoped.get('/clusters/:name/kubeconfig', async (c) => {
  const agent = c.get('agent')
  const access = await resolveGkeAccess(
    gcpHandleFor(c),
    c.req.param('name'),
    c.req.query('location') || c.req.query('region') || undefined,
  )

  const kubeconfig = renderKubeconfig({
    clusterName: access.clusterName,
    endpoint: access.endpoint,
    caBase64: access.caBase64,
    token: access.adminToken,
  })

  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('X-Kubeconfig-Expires-At', access.expiresAt.toISOString())

  return c.body(kubeconfig)
})

projectScoped.get('/clusters/:name/exec-credential', async (c) => {
  const agent = c.get('agent')
  const access = await resolveGkeAccess(
    gcpHandleFor(c),
    c.req.param('name'),
    c.req.query('location') || c.req.query('region') || undefined,
  )

  return execCredentialResponse(c, agent, access.adminToken, access.expiresAt)
})

function requireSelectedGcpAgentCredential(): MiddlewareHandler<{ Variables: AgentGcpVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedServiceAccountIds = credentialAccess.gcpServiceAccountIds

    if (selectedServiceAccountIds.length === 0) {
      throw new AppError(
        403,
        'gcp_project_agent_access_denied',
        'This agent session has no selected GCP service accounts',
      )
    }

    if (!c.get('gcpBindingExplicit')) {
      const selected = c
        .get('gcpBindings')
        .find(
          (binding) =>
            selectedServiceAccountIds.includes(binding.id.toHexString()) &&
            canUseAllowList(binding.access?.memberAllowList, c.get('userId')),
        )

      if (selected) {
        c.set('serviceAccountEmail', selected.serviceAccountEmail)
        c.set('gcpBinding', selected)
      }
    }

    const serviceAccountId = c.get('gcpBinding').id.toHexString()

    if (!selectedServiceAccountIds.includes(serviceAccountId)) {
      throw new AppError(
        403,
        'gcp_project_agent_access_denied',
        'This GCP service account is not enabled for this agent session',
      )
    }
    // Permission-admin bindings are human-only break-glass credentials: an SA
    // that can rewrite project IAM can escalate to owner, so it must never be
    // handed to the agent even if its id somehow lands in the selected set.
    if (c.get('gcpBinding').purpose === 'permission-admin') {
      throw new AppError(
        403,
        'gcp_project_agent_access_denied',
        'This GCP service account is a permission-admin account and cannot be used by the agent',
      )
    }
    await next()
  }
}
