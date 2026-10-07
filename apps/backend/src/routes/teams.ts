import { Hono } from 'hono'

import { getTeamUsageSeries } from '@/lib/agent/usage-summary'
import { requireTeamMember } from '@/middleware/auth'
import { agentTriggersRoutes } from '@/routes/agent-triggers'
import { aliyunAccountsRoutes } from '@/routes/aliyun-accounts'
import { architectureDiagramsRoutes } from '@/routes/architecture-diagrams'
import { asanaAccountsRoutes } from '@/routes/asana-accounts'
import { awsAccountsRoutes } from '@/routes/aws-accounts'
import { azureAccountsRoutes } from '@/routes/azure-accounts'
import { betterStackIntegrationsRoutes } from '@/routes/betterstack-integrations'
import { cloudflareAccountsRoutes } from '@/routes/cloudflare-accounts'
import { teamClusters } from '@/routes/clusters'
import { nuphosDashboardsRoutes } from '@/routes/dashboards'
import { databaseConnectionsRoutes } from '@/routes/database-connections'
import { discordInstallationsRoutes } from '@/routes/discord-installations'
import { fileTransfersRoutes } from '@/routes/file-transfers'
import { gcpProjectsRoutes } from '@/routes/gcp-projects'
import { githubInstallationsRoutes } from '@/routes/github-installations'
import { gitlabBindingsRoutes } from '@/routes/gitlab-bindings'
import { grafanaInstancesRoutes } from '@/routes/grafana-instances'
import { hetznerAccountsRoutes } from '@/routes/hetzner-accounts'
import { homeLayoutRoutes } from '@/routes/home-layout'
import { huaweiAccountsRoutes } from '@/routes/huawei-accounts'
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
import { posthogIntegrationsRoutes } from '@/routes/posthog-integrations'
import { resendIntegrationsRoutes } from '@/routes/resend-integrations'
import { secureframeIntegrationsRoutes } from '@/routes/secureframe-integrations'
import { sentryAccountsRoutes } from '@/routes/sentry-accounts'
import { sidebarFavoritesRoutes } from '@/routes/sidebar-favorites'
import { slackInstallationsRoutes } from '@/routes/slack-installations'
import { sonarqubeIntegrationsRoutes } from '@/routes/sonarqube-integrations'
import { tailscaleClientsRoutes } from '@/routes/tailscale-clients'
import { teamConnectorsRoutes } from '@/routes/team-connectors'
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
import { registerTeamManagementRoutes } from '@/routes/teams/management'
import { registerTeamsRootRoutes } from '@/routes/teams/root'
import { tencentAccountsRoutes } from '@/routes/tencent-accounts'
import { upstashAccountsRoutes } from '@/routes/upstash-accounts'
import { uptimeKumaInstancesRoutes } from '@/routes/uptime-kuma-instances'
import { vantaIntegrationsRoutes } from '@/routes/vanta-integrations'
import { volcengineAccountsRoutes } from '@/routes/volcengine-accounts'
import { zeaburProvidersRoutes } from '@/routes/zeabur-providers'

import { registerRuntimeLoginRoutes } from './teams/runtime-login'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConversationTeamAuthVariables } from '@/routes/teams/conversation-auth'

export const teamsRoutes = new Hono<{ Variables: ConversationTeamAuthVariables }>()
teamsRoutes.use('*', requireUserOrConversationAuth)

registerTeamsRootRoutes(teamsRoutes)

const teamScoped = new Hono<{
  Variables: TeamAuthVariables & ConversationTeamAuthVariables
}>()

teamScoped.use('*', requireTeamMember())
teamScoped.use('*', dispatchConversationTeamApi)

registerTeamManagementRoutes(teamScoped)
registerTeamInvitationRoutes(teamScoped)
registerAgentRuntimeRoutes(teamScoped)
registerExternalRuntimeRoute(teamScoped)
registerRuntimeLoginRoutes(teamScoped)
registerClaudeCodeRuntimeRoutes(teamScoped, 'codex')
registerClaudeCodeRuntimeRoutes(teamScoped)

teamScoped.get('/usage', async (c) => c.json(await getTeamUsageSeries(c.get('teamId'))))
// Read-only compatibility for saved dashboard scripts and older desktop clients.
teamScoped.get('/billing/usage', async (c) => c.json(await getTeamUsageSeries(c.get('teamId'))))
teamScoped.route('/favorites', sidebarFavoritesRoutes)
teamScoped.route('/home-layout', homeLayoutRoutes)
teamScoped.route('/instructions', instructionsRoutes)

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
teamScoped.route('/architecture-diagrams', architectureDiagramsRoutes)
teamScoped.route('/dashboards', nuphosDashboardsRoutes)
// Alias for desktop builds that predate the Dashboards rename.
teamScoped.route('/cost-dashboards', nuphosDashboardsRoutes)
teamScoped.route('/agent-triggers', agentTriggersRoutes)
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
teamScoped.route('/discord-installations', discordInstallationsRoutes)
teamScoped.route('/lark-installations', larkInstallationsRoutes)
teamScoped.route('/tailscale-clients', tailscaleClientsRoutes)
teamScoped.route('/zeabur-providers', zeaburProvidersRoutes)
teamScoped.route('/vanta-integrations', vantaIntegrationsRoutes)
teamScoped.route('/secureframe-integrations', secureframeIntegrationsRoutes)
teamScoped.route('/sonarqube-integrations', sonarqubeIntegrationsRoutes)
teamScoped.route('/notion-integrations', notionIntegrationsRoutes)
teamScoped.route('/upstash-accounts', upstashAccountsRoutes)
teamScoped.route('/resend-integrations', resendIntegrationsRoutes)
teamScoped.route('/posthog-integrations', posthogIntegrationsRoutes)
teamScoped.route('/connectors', teamConnectorsRoutes)
teamScoped.route('/monitoring', monitoringRoutes)
teamScoped.route('/file-transfers', fileTransfersRoutes)
teamScoped.route('/skills', teamSkillsRoutes)
teamScoped.route('/database-connections', databaseConnectionsRoutes)

teamsRoutes.route('/:teamId', teamScoped)
