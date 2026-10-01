import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { canUseAllowList } from '@/lib/byos/access'
import { aliyunBootstrapRegion } from '@/lib/byos/aliyun'
import {
  aliyunHandleFor,
  azureHandleFor,
  huaweiHandleFor,
  tencentHandleFor,
  volcengineHandleFor,
} from '@/lib/byos/handles'
import { BOOTSTRAP_REGION as HUAWEI_BOOTSTRAP_REGION } from '@/lib/byos/huawei'
import { tencentBootstrapRegion } from '@/lib/byos/tencent'
import { BOOTSTRAP_REGION as VOLC_BOOTSTRAP_REGION } from '@/lib/byos/volcengine'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { TeamAuthVariables } from '@/middleware/auth'
import type {
  TencentAccountBinding,
  AliyunAccountBinding,
  VolcengineAccountBinding,
  AzureAccountBinding,
  HuaweiAccountBinding,
} from '@/models'
import type { AgentVars } from '@/routes/agent-sessions/shared'

// ── CN-cloud BYOS providers (Tencent / Aliyun / Volcengine) ─────────────────
// Session-scoped credential endpoints, gated on the conversation's
// credentialAccess like every other provider above. The skills' setup scripts
// hit these (instead of the team-scoped routes) when NUPHOS_SESSION_ID is set,
// so an agent session can only mint credentials for accounts the user enabled
// in the credential selector.

async function loadCnBinding<
  T extends { id: import('mongodb').ObjectId; access?: { memberAllowList?: string[] } },
>(
  teamId: string,
  accountIdParam: string | undefined,
  field:
    | 'tencentAccounts'
    | 'aliyunAccounts'
    | 'volcengineAccounts'
    | 'azureAccounts'
    | 'huaweiAccounts',
  notFoundCode: string,
): Promise<T> {
  if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
  const accountId = parseObjectId(accountIdParam, 'accountId')
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(teamId, 'teamId') },
    { projection: { [field]: 1 } },
  )
  const binding = ((doc?.[field] ?? []) as unknown as T[]).find((b) => b.id.equals(accountId))

  if (!binding) throw new AppError(404, notFoundCode, 'Account binding not found')

  return binding
}

function assertCnAgentAccess(
  binding: { id: import('mongodb').ObjectId; access?: { memberAllowList?: string[] } },
  selectedIds: string[],
  userId: string,
  deniedCode: string,
  providerLabel: string,
): void {
  const id = binding.id.toHexString()

  if (selectedIds.length === 0 || !selectedIds.includes(id)) {
    throw new AppError(
      403,
      deniedCode,
      `This ${providerLabel} account is not enabled for this agent session`,
    )
  }
  if (!canUseAllowList(binding.access?.memberAllowList, userId)) {
    throw new AppError(
      403,
      deniedCode,
      `This ${providerLabel} account is not enabled for this agent session`,
    )
  }
}

export const cnCloudScoped = new Hono<{ Variables: AgentVars & TeamAuthVariables }>()

cnCloudScoped.get('/tencent-accounts/:accountId/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const binding = await loadCnBinding<TencentAccountBinding>(
    teamId,
    c.req.param('accountId'),
    'tencentAccounts',
    'tencent_account_not_found',
  )
  const access = await getAgentCredentialAccess(agent, teamId)

  assertCnAgentAccess(
    binding,
    access.tencentAccountIds,
    c.get('userId'),
    'tencent_account_agent_access_denied',
    'Tencent',
  )
  const handle = await tencentHandleFor(binding, teamId)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')

  return c.json({
    secretId: handle.secretId,
    secretKey: handle.secretKey,
    token: handle.token,
    site: handle.site,
    defaultRegion: tencentBootstrapRegion(handle.site),
  })
})

cnCloudScoped.get('/aliyun-accounts/:accountId/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const binding = await loadCnBinding<AliyunAccountBinding>(
    teamId,
    c.req.param('accountId'),
    'aliyunAccounts',
    'aliyun_account_not_found',
  )
  const access = await getAgentCredentialAccess(agent, teamId)

  assertCnAgentAccess(
    binding,
    access.aliyunAccountIds,
    c.get('userId'),
    'aliyun_account_agent_access_denied',
    'Aliyun',
  )
  const handle = await aliyunHandleFor(binding, teamId)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    accessKeySecret: handle.accessKeySecret,
    securityToken: handle.securityToken,
    site: handle.site,
    defaultRegion: aliyunBootstrapRegion(handle.site),
  })
})

cnCloudScoped.get('/volcengine-accounts/:accountId/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const binding = await loadCnBinding<VolcengineAccountBinding>(
    teamId,
    c.req.param('accountId'),
    'volcengineAccounts',
    'volcengine_account_not_found',
  )
  const access = await getAgentCredentialAccess(agent, teamId)

  assertCnAgentAccess(
    binding,
    access.volcengineAccountIds,
    c.get('userId'),
    'volcengine_account_agent_access_denied',
    'Volcengine',
  )
  const handle = await volcengineHandleFor(binding, teamId)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    secretAccessKey: handle.secretAccessKey,
    sessionToken: handle.sessionToken,
    defaultRegion: VOLC_BOOTSTRAP_REGION,
  })
})

cnCloudScoped.get('/huawei-accounts/:accountId/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const binding = await loadCnBinding<HuaweiAccountBinding>(
    teamId,
    c.req.param('accountId'),
    'huaweiAccounts',
    'huawei_account_not_found',
  )
  const access = await getAgentCredentialAccess(agent, teamId)

  assertCnAgentAccess(
    binding,
    access.huaweiAccountIds,
    c.get('userId'),
    'huawei_account_agent_access_denied',
    'Huawei Cloud',
  )
  const handle = await huaweiHandleFor(binding, teamId)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    secretAccessKey: handle.secretAccessKey,
    securityToken: handle.securityToken,
    expiresAt: handle.expiresAt.toISOString(),
    domainId: binding.domainId,
    defaultRegion: HUAWEI_BOOTSTRAP_REGION,
  })
})

cnCloudScoped.get('/azure-accounts/:accountId/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const binding = await loadCnBinding<AzureAccountBinding>(
    teamId,
    c.req.param('accountId'),
    'azureAccounts',
    'azure_account_not_found',
  )

  // Permission-admin bindings are human-only break-glass RBAC editors; the agent
  // must never receive their token.
  if (binding.purpose === 'permission-admin') {
    throw new AppError(
      403,
      'azure_account_agent_access_denied',
      'This Azure binding is a permission-admin binding and cannot be used by the agent',
    )
  }
  const access = await getAgentCredentialAccess(agent, teamId)

  assertCnAgentAccess(
    binding,
    access.azureAccountIds,
    c.get('userId'),
    'azure_account_agent_access_denied',
    'Azure',
  )
  const handle = await azureHandleFor(binding, teamId)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessToken: handle.accessToken,
    subscriptionId: handle.subscriptionId,
    expiresAt: handle.expiresAt.toISOString(),
  })
})
