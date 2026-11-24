import { Hono } from 'hono'
import { z } from 'zod'

import { getAgentStats, isTimeZone } from '@/lib/agent/agent-stats'
import { conversationChangesBody, onConversationChange } from '@/lib/agent/conversation-changes'
import { boxUsageView } from '@/lib/agent/devices/box-instabox-limit'
import { listBoxUsageHistory } from '@/lib/agent/devices/box-usage-history'
import { ACTIVITY_RANGES, getTeamActivity, withOwnTitles } from '@/lib/agent/team-activity'
import { usageNames } from '@/lib/agent/usage-names'
import { USAGE_BUCKETS, USAGE_DIMENSIONS, queryTeamUsage } from '@/lib/agent/usage-query'
import { getTeamUsageSeries } from '@/lib/agent/usage-summary'
import { QUOTA_HISTORY_RANGES } from '@/lib/claude-code-preview/runtime-quota-history'
import { getTeamMembership } from '@/lib/identity'
import { zv } from '@/lib/validate'
import { requireTeamMember } from '@/middleware/auth'
import { SSE_HEARTBEAT_INTERVAL_MS } from '@/routes/agent/constants'
import { agentRemindersRoutes } from '@/routes/agent-reminders'
import { agentTriggersRoutes } from '@/routes/agent-triggers'
import { aliyunAccountsRoutes } from '@/routes/aliyun-accounts'
import { architectureDiagramsRoutes } from '@/routes/architecture-diagrams'
import { asanaAccountsRoutes } from '@/routes/asana-accounts'
import { awsAccountsRoutes } from '@/routes/aws-accounts'
import { azureAccountsRoutes } from '@/routes/azure-accounts'
import { betterStackIntegrationsRoutes } from '@/routes/betterstack-integrations'
import { cloudflareAccountsRoutes } from '@/routes/cloudflare-accounts'
import { teamClusters } from '@/routes/clusters'
import { connectorOAuthRoutes } from '@/routes/connector-oauth'
import { nuphosDashboardsRoutes } from '@/routes/dashboards'
import { databaseConnectionsRoutes } from '@/routes/database-connections'
import { designsRoutes } from '@/routes/designs'
import { discordAgentRoutes } from '@/routes/discord-agent'
import { discordInstallationsRoutes } from '@/routes/discord-installations'
import { fileTransfersRoutes } from '@/routes/file-transfers'
import { gcpProjectsRoutes } from '@/routes/gcp-projects'
import { githubInstallationsRoutes } from '@/routes/github-installations'
import { gitlabBindingsRoutes } from '@/routes/gitlab-bindings'
import { googleOAuthClientRoutes } from '@/routes/google-oauth-client'
import { grafanaInstancesRoutes } from '@/routes/grafana-instances'
import { hetznerAccountsRoutes } from '@/routes/hetzner-accounts'
import { homeLayoutRoutes } from '@/routes/home-layout'
import { huaweiAccountsRoutes } from '@/routes/huawei-accounts'
import { instaboxAccountsRoutes } from '@/routes/instabox-accounts'
import { instructionsRoutes } from '@/routes/instructions'
import { jiraSitesRoutes } from '@/routes/jira-sites'
import { knowledgeRoutes } from '@/routes/knowledge'
import { larkInstallationsRoutes } from '@/routes/lark-installations'
import { linearWorkspacesRoutes } from '@/routes/linear-workspaces'
import { linodeAccountsRoutes } from '@/routes/linode-accounts'
import { monitoringRoutes } from '@/routes/monitoring'
import { notionIntegrationsRoutes } from '@/routes/notion-integrations'
import { onpremClustersRoutes } from '@/routes/onprem-clusters'
import { permissionGrantProposalsRoutes } from '@/routes/permission-grant-proposals'
import { composioRoutes, personalCredentialTokenRoutes } from '@/routes/personal-credentials'
import { plaudAccountsRoutes } from '@/routes/plaud-accounts'
import { posthogIntegrationsRoutes } from '@/routes/posthog-integrations'
import { resendIntegrationsRoutes } from '@/routes/resend-integrations'
import { runtimeFallbackRoutes } from '@/routes/runtime-fallback'
import { secureframeIntegrationsRoutes } from '@/routes/secureframe-integrations'
import { sentryAccountsRoutes } from '@/routes/sentry-accounts'
import { sidebarFavoritesRoutes } from '@/routes/sidebar-favorites'
import { teamSlackMappings } from '@/routes/slack/mappings'
import { slackInstallationsRoutes } from '@/routes/slack-installations'
import { sonarqubeIntegrationsRoutes } from '@/routes/sonarqube-integrations'
import { tailscaleClientsRoutes } from '@/routes/tailscale-clients'
import { teamConnectorsRoutes } from '@/routes/team-connectors'
import { registerTeamRemoteEndpointRoutes } from '@/routes/team-remote-endpoints'
import { teamSkillsRoutes } from '@/routes/team-skills'
import { registerAgentRuntimeRoutes } from '@/routes/teams/agent-runtimes'
import {
  registerClaudeCodeRuntimeRoutes,
  registerExternalRuntimeRoute,
} from '@/routes/teams/claude-code-runtimes'
import {
  dispatchConversationTeamApi,
  requireUserOrConversationAuth,
} from '@/routes/teams/conversation-auth'
import { registerTeamInvitationRoutes } from '@/routes/teams/invitations'
import { registerBindingShareRoutes } from '@/routes/teams/binding-share'
import { registerTeamManagementRoutes } from '@/routes/teams/management'
import { registerTeamImportRoutes } from '@/routes/teams/migration-import'
import { registerTeamMigrationRoutes } from '@/routes/teams/migration'
import { registerTeamsRootRoutes } from '@/routes/teams/root'
import { tencentAccountsRoutes } from '@/routes/tencent-accounts'
import { trelloIntegrationsRoutes } from '@/routes/trello-integrations'
import { upstashAccountsRoutes } from '@/routes/upstash-accounts'
import { uptimeKumaInstancesRoutes } from '@/routes/uptime-kuma-instances'
import { vantaIntegrationsRoutes } from '@/routes/vanta-integrations'
import { voiceTranscriptionsRoutes } from '@/routes/voice-transcriptions'
import { volcengineAccountsRoutes } from '@/routes/volcengine-accounts'
import { zeaburProvidersRoutes } from '@/routes/zeabur-providers'

import { registerRuntimeLoginRoutes } from './teams/runtime-login'
import { registerSignInRequestRoutes } from './teams/sign-in-requests'

import type { UsageDimension } from '@/lib/agent/usage-query'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConversationTeamAuthVariables } from '@/routes/teams/conversation-auth'

export const teamsRoutes = new Hono<{ Variables: ConversationTeamAuthVariables }>()
teamsRoutes.use('*', requireUserOrConversationAuth)

registerTeamsRootRoutes(teamsRoutes)
registerTeamImportRoutes(teamsRoutes)

const activityQuerySchema = z.object({
  range: z.enum(Object.keys(ACTIVITY_RANGES) as [keyof typeof ACTIVITY_RANGES]).default('7d'),
})

const statsQuerySchema = activityQuerySchema.extend({
  scope: z.enum(['me', 'team']).default('me'),
  // Days and hours are the viewer's own, so a streak ends at their midnight.
  timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').default('UTC'),
})

// `a,b` lists: the dimensions to group by, and each dimension's allowed values.
const csv = z
  .string()
  .max(4000)
  .transform((value) => value.split(',').filter(Boolean))
const usageQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    bucket: z.enum(USAGE_BUCKETS).optional(),
    timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
    groupBy: csv.pipe(z.array(z.enum(USAGE_DIMENSIONS)).max(3)).default(''),
    ...Object.fromEntries(USAGE_DIMENSIONS.map((dimension) => [dimension, csv.optional()])),
  })
  .refine(({ from, to }) => from < to && to.getTime() - from.getTime() <= 400 * 86_400_000, {
    message: 'The range must run forward and span at most 400 days',
  })

const teamScoped = new Hono<{
  Variables: TeamAuthVariables & ConversationTeamAuthVariables
}>()

teamScoped.use('*', requireTeamMember())
teamScoped.use('*', dispatchConversationTeamApi)

registerTeamManagementRoutes(teamScoped)
registerTeamMigrationRoutes(teamScoped)
registerBindingShareRoutes(teamScoped)
registerTeamInvitationRoutes(teamScoped)
registerAgentRuntimeRoutes(teamScoped)
registerExternalRuntimeRoute(teamScoped)
registerRuntimeLoginRoutes(teamScoped)
registerSignInRequestRoutes(teamScoped)
registerClaudeCodeRuntimeRoutes(teamScoped, 'codex')
registerClaudeCodeRuntimeRoutes(teamScoped)

teamScoped.get('/usage', async (c) =>
  c.json(
    await getTeamUsageSeries(c.get('teamId'), {
      userId: c.get('userId'),
      teamRole: c.get('teamRole'),
    }),
  ),
)
// Which of the team's conversations changed, as they change, for the chats on screen (#3523):
// each member hears only of the ones they may read.
teamScoped.get('/agent-changes', (c) => {
  const teamId = c.get('teamId')
  const userId = c.get('userId')
  const body = conversationChangesBody({
    teamId,
    viewerId: userId,
    subscribe: onConversationChange,
    isMember: async () => (await getTeamMembership(userId, teamId)) !== null,
    heartbeatMs: SSE_HEARTBEAT_INTERVAL_MS,
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})
// Every member sees the whole team's activity and stats; only an administrator
// sees the titles of other members' sessions.
teamScoped.get('/agent-activity', zv('query', activityQuerySchema), async (c) => {
  const activity = await getTeamActivity(c.get('teamId'), c.req.valid('query').range)

  return c.json(
    c.get('teamRole') === 'ADMINISTRATOR' ? activity : withOwnTitles(activity, c.get('userId')),
  )
})
teamScoped.get('/agent-stats', zv('query', statsQuerySchema), async (c) =>
  c.json(
    await getAgentStats(c.get('teamId'), { viewerId: c.get('userId'), ...c.req.valid('query') }),
  ),
)
// The team's token usage, grouped and filtered by any dimension; names follow the viewer's role.
teamScoped.get('/usage/query', zv('query', usageQuerySchema), async (c) => {
  const { from, to, bucket, timeZone, groupBy, ...rest } = c.req.valid('query')
  // The schema spreads the dimension lists in, so their keys are lost to the type.
  const lists: Partial<Record<UsageDimension, string[]>> = rest
  const filters = Object.fromEntries(
    USAGE_DIMENSIONS.flatMap((dimension) => {
      const values = lists[dimension]

      return values?.length ? [[dimension, values]] : []
    }),
  )

  const viewer = { userId: c.get('userId'), teamRole: c.get('teamRole') }
  const query = { from, to, bucket, timeZone, groupBy, filters, viewerId: viewer.userId }
  const rows = await queryTeamUsage(c.get('teamId'), query)

  return c.json({ rows, names: await usageNames(c.get('teamId'), viewer, groupBy, rows) })
})
// Read-only compatibility for saved dashboard scripts and older desktop clients.
teamScoped.get('/billing/usage', async (c) =>
  c.json(
    await getTeamUsageSeries(c.get('teamId'), {
      userId: c.get('userId'),
      teamRole: c.get('teamRole'),
    }),
  ),
)
// The team's Box vCPU limit and use, for the Boxes section.
teamScoped.get('/box-usage', async (c) => c.json(await boxUsageView(c.get('teamId'))))
teamScoped.get(
  '/box-usage/history',
  zv(
    'query',
    z.object({
      range: z
        .enum(Object.keys(QUOTA_HISTORY_RANGES) as [keyof typeof QUOTA_HISTORY_RANGES])
        .default('1d'),
    }),
  ),
  async (c) => c.json(await listBoxUsageHistory(c.get('teamId'), c.req.valid('query').range)),
)
teamScoped.route('/favorites', sidebarFavoritesRoutes)
teamScoped.route('/home-layout', homeLayoutRoutes)
teamScoped.route('/runtime-fallbacks', runtimeFallbackRoutes)
teamScoped.route('/instructions', instructionsRoutes)
teamScoped.route('/voice-transcriptions', voiceTranscriptionsRoutes)

teamScoped.route('/clusters', teamClusters)
teamScoped.route('/aws-accounts', awsAccountsRoutes)
teamScoped.route('/permission-grant-proposals', permissionGrantProposalsRoutes)
teamScoped.route('/gcp-projects', gcpProjectsRoutes)
teamScoped.route('/tencent-accounts', tencentAccountsRoutes)
teamScoped.route('/aliyun-accounts', aliyunAccountsRoutes)
teamScoped.route('/volcengine-accounts', volcengineAccountsRoutes)
teamScoped.route('/azure-accounts', azureAccountsRoutes)
teamScoped.route('/huawei-accounts', huaweiAccountsRoutes)
teamScoped.route('/grafana-instances', grafanaInstancesRoutes)
registerTeamRemoteEndpointRoutes(teamScoped)
teamScoped.route('/architecture-diagrams', architectureDiagramsRoutes)
teamScoped.route('/designs', designsRoutes)
teamScoped.route('/dashboards', nuphosDashboardsRoutes)
// Alias for desktop builds that predate the Dashboards rename.
teamScoped.route('/cost-dashboards', nuphosDashboardsRoutes)
teamScoped.route('/agent-triggers', agentTriggersRoutes)
teamScoped.route('/agent-reminders', agentRemindersRoutes)
teamScoped.route('/knowledge', knowledgeRoutes)
teamScoped.route('/github-installations', githubInstallationsRoutes)
teamScoped.route('/gitlab-bindings', gitlabBindingsRoutes)
teamScoped.route('/cloudflare-accounts', cloudflareAccountsRoutes)
teamScoped.route('/linode-accounts', linodeAccountsRoutes)
teamScoped.route('/onprem-clusters', onpremClustersRoutes)
teamScoped.route('/hetzner-accounts', hetznerAccountsRoutes)
teamScoped.route('/betterstack-integrations', betterStackIntegrationsRoutes)
teamScoped.route('/uptime-kuma-instances', uptimeKumaInstancesRoutes)
teamScoped.route('/linear-workspaces', linearWorkspacesRoutes)
teamScoped.route('/jira-sites', jiraSitesRoutes)
teamScoped.route('/asana-accounts', asanaAccountsRoutes)
teamScoped.route('/sentry-accounts', sentryAccountsRoutes)
teamScoped.route('/slack-installations', slackInstallationsRoutes)
teamScoped.route('/slack', teamSlackMappings)
teamScoped.route('/discord-installations', discordInstallationsRoutes)
teamScoped.route('/discord', discordAgentRoutes)
teamScoped.route('/lark-installations', larkInstallationsRoutes)
teamScoped.route('/tailscale-clients', tailscaleClientsRoutes)
teamScoped.route('/zeabur-providers', zeaburProvidersRoutes)
teamScoped.route('/vanta-integrations', vantaIntegrationsRoutes)
teamScoped.route('/secureframe-integrations', secureframeIntegrationsRoutes)
teamScoped.route('/sonarqube-integrations', sonarqubeIntegrationsRoutes)
teamScoped.route('/notion-integrations', notionIntegrationsRoutes)
teamScoped.route('/upstash-accounts', upstashAccountsRoutes)
teamScoped.route('/resend-integrations', resendIntegrationsRoutes)
teamScoped.route('/trello-integrations', trelloIntegrationsRoutes)
teamScoped.route('/instabox-accounts', instaboxAccountsRoutes)
teamScoped.route('/posthog-integrations', posthogIntegrationsRoutes)
teamScoped.route('/plaud-accounts', plaudAccountsRoutes)
teamScoped.route('/personal-credentials', personalCredentialTokenRoutes)
teamScoped.route('/composio', composioRoutes)
teamScoped.route('/google-oauth-client', googleOAuthClientRoutes)
teamScoped.route('/connectors', teamConnectorsRoutes)
teamScoped.route('/connector-oauth', connectorOAuthRoutes)
teamScoped.route('/monitoring', monitoringRoutes)
teamScoped.route('/file-transfers', fileTransfersRoutes)
teamScoped.route('/skills', teamSkillsRoutes)
teamScoped.route('/database-connections', databaseConnectionsRoutes)
teamsRoutes.route('/:teamId', teamScoped)
