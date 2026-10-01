import { Hono } from 'hono'

import { config } from '@/config'
import { agentSubjectId } from '@/lib/agents/identity'
import { canUseAllowList } from '@/lib/byos/access'
import {
  sanitizeSessionName,
  assumeRoleAsConnector,
  getEksAdminAccess,
  listEksClusters,
  EKS_TOKEN_TTL_MS,
} from '@/lib/byos/aws'
import { renderKubeconfig } from '@/lib/byos/kubeconfig'
import { AppError } from '@/lib/errors'
import { requireAwsAccount, requireAwsMemberAccess } from '@/middleware/auth'
import { execCredentialResponse, getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { EksAccessActor, EksAdminAccess } from '@/lib/byos/aws'
import type { AwsAccountVariables } from '@/middleware/auth'
import type { AgentAwsVars, AgentVars } from '@/routes/agent-sessions/shared'
import type { Context, MiddlewareHandler } from 'hono'

export const accountScoped = new Hono<{ Variables: AgentVars & AwsAccountVariables }>()

accountScoped.use('*', requireAwsAccount())
accountScoped.use('*', requireAwsMemberAccess())
accountScoped.use('*', requireSelectedAwsAgentCredential())

accountScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const roleArn = c.get('awsRoleArn')

  const temp = await assumeRoleAsConnector(roleArn, {
    sessionName: sanitizeSessionName(`atlas-agent-${agent.sessionId}`),
  })
  const expiresAt = new Date(Date.now() + config.byos.aws.sessionDurationSec * 1000)

  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.json({
    accessKeyId: temp.accessKeyId,
    secretAccessKey: temp.secretAccessKey,
    sessionToken: temp.sessionToken,
    expiresAt: expiresAt.toISOString(),
  })
})

/**
 * Actor stamped onto the connector's mutating EKS access calls. CloudTrail only
 * ever sees the `nuphos-byos` connector session, so this is what lets a
 * high-risk-mutation alert be traced back to the agent turn that caused it.
 */
function eksActor(c: Context<{ Variables: AgentAwsVars }>, source: string): EksAccessActor {
  const agent = c.get('agent')

  return {
    source,
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
    teamId: c.get('teamId'),
    agentSessionId: agent.sessionId,
  }
}

async function resolveEksAccess(
  roleArn: string,
  clusterName: string,
  region: string | undefined,
  actor: EksAccessActor,
): Promise<{ access: EksAdminAccess; expiresAt: Date }> {
  if (!region) {
    const list = await listEksClusters(roleArn)
    const found = list.clusters.find((cl) => cl.name === clusterName)

    if (!found) {
      throw new AppError(
        404,
        'cluster_not_found',
        `Cluster ${clusterName} not found in this account`,
      )
    }
    region = found.region
  }
  const access = await getEksAdminAccess(roleArn, region, clusterName, actor)

  if (!access)
    throw new AppError(404, 'cluster_not_found', `Cluster ${clusterName} not found in ${region}`)

  return { access, expiresAt: new Date(Date.now() + EKS_TOKEN_TTL_MS) }
}

accountScoped.get('/clusters/:name/kubeconfig', async (c) => {
  const agent = c.get('agent')
  const { access, expiresAt } = await resolveEksAccess(
    c.get('awsRoleArn'),
    c.req.param('name'),
    c.req.query('region') || undefined,
    eksActor(c, 'agent-sessions.aws.kubeconfig'),
  )

  const kubeconfig = renderKubeconfig({
    clusterName: access.clusterName,
    endpoint: access.endpoint,
    caBase64: access.caBase64,
    token: access.adminToken,
  })

  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('X-Kubeconfig-Expires-At', expiresAt.toISOString())

  return c.body(kubeconfig)
})

// ExecCredential endpoint for the sandbox's kubeconfig exec plugin
// (get-credential.sh): same credential power as the kubeconfig route, but in
// the shape kubectl consumes directly, with an expiry the plugin can cache on.
accountScoped.get('/clusters/:name/exec-credential', async (c) => {
  const agent = c.get('agent')
  const { access, expiresAt } = await resolveEksAccess(
    c.get('awsRoleArn'),
    c.req.param('name'),
    c.req.query('region') || undefined,
    eksActor(c, 'agent-sessions.aws.exec-credential'),
  )

  return execCredentialResponse(c, agent, access.adminToken, expiresAt)
})

function requireSelectedAwsAgentCredential(): MiddlewareHandler<{ Variables: AgentAwsVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedRoleIds = credentialAccess.awsRoleIds

    if (selectedRoleIds.length === 0) {
      throw new AppError(
        403,
        'aws_account_agent_access_denied',
        'This agent session has no selected AWS roles',
      )
    }

    if (!c.get('awsBindingExplicit')) {
      const selected = c
        .get('awsBindings')
        .find(
          (binding) =>
            selectedRoleIds.includes(binding.id.toHexString()) &&
            canUseAllowList(binding.access?.memberAllowList, c.get('userId')),
        )

      if (selected) {
        c.set('awsRoleArn', selected.roleArn)
        c.set('awsBinding', selected)
      }
    }

    const roleId = c.get('awsBinding').id.toHexString()

    if (!selectedRoleIds.includes(roleId)) {
      throw new AppError(
        403,
        'aws_account_agent_access_denied',
        'This AWS role is not enabled for this agent session',
      )
    }
    // Permission-admin bindings are human-only break-glass credentials: a role
    // that can rewrite IAM can escalate to admin, so it must never be handed to
    // the agent even if its id somehow lands in the session's selected set.
    if (c.get('awsBinding').purpose === 'permission-admin') {
      throw new AppError(
        403,
        'aws_account_agent_access_denied',
        'This AWS role is a permission-admin role and cannot be used by the agent',
      )
    }
    await next()
  }
}
