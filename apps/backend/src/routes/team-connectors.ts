import { Hono } from 'hono'

import { syncZeaburProviderBindings } from '@/lib/byos/account'
import { getDiscordConnection } from '@/lib/discord/connection'
import { getLarkBindingForTeam, publicLarkInstallationView } from '@/lib/lark/installations'
import { parseObjectId } from '@/lib/objectid'
import { logError } from '@/lib/observability'
import { listSlackChannelMappings } from '@/lib/slack/agent-bot'
import { getSlackBindingForTeam, publicSlackInstallationView } from '@/lib/slack/installations'
import { summarizeSlackLinkedChannels } from '@/lib/slack/linked-channels'
import { isSlackOAuthConfigured } from '@/lib/slack/oauth'
import { teamByosBindings } from '@/models'
import { aliyunAccountsView } from '@/routes/aliyun-accounts'
import { publicView as asanaAccountView } from '@/routes/asana-accounts'
import { awsAccountsView } from '@/routes/aws-accounts'
import { azureAccountsView } from '@/routes/azure-accounts'
import { publicView as betterStackIntegrationView } from '@/routes/betterstack-integrations'
import { publicView as cloudflareAccountView } from '@/routes/cloudflare-accounts'
import { gcpProjectsView } from '@/routes/gcp-projects'
import { publicView as githubInstallationView } from '@/routes/github-installations'
import { publicView as gitlabBindingView } from '@/routes/gitlab-bindings'
import { publicView as grafanaInstanceView } from '@/routes/grafana-instances'
import { publicView as hetznerAccountView } from '@/routes/hetzner-accounts'
import { huaweiAccountsView } from '@/routes/huawei-accounts'
import { publicView as jiraSiteView } from '@/routes/jira-sites'
import { publicView as linearWorkspaceView } from '@/routes/linear-workspaces'
import { publicView as linodeAccountView } from '@/routes/linode-accounts'
import { publicView as notionIntegrationView } from '@/routes/notion-integrations'
import { publicView as onpremClusterView } from '@/routes/onprem-clusters/shared'
import { posthogPublicView } from '@/routes/posthog-integrations'
import { publicView as resendIntegrationView } from '@/routes/resend-integrations'
import { publicView as secureframeIntegrationView } from '@/routes/secureframe-integrations'
import { publicView as sentryAccountView } from '@/routes/sentry-accounts'
import { sonarqubePublicView } from '@/routes/sonarqube-integrations'
import { publicView as tailscaleClientView } from '@/routes/tailscale-clients'
import { tencentAccountsView } from '@/routes/tencent-accounts'
import { publicView as upstashAccountView } from '@/routes/upstash-accounts'
import { uptimeKumaInstancesView } from '@/routes/uptime-kuma-instances'
import { publicView as vantaIntegrationView } from '@/routes/vanta-integrations'
import { volcengineAccountsView } from '@/routes/volcengine-accounts'
import { publicView as zeaburProviderView } from '@/routes/zeabur-providers'

import type { TeamAuthVariables } from '@/middleware/auth'

export const teamConnectorsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// One malformed binding (e.g. a document written before its connector's schema
// changed) must not fail the whole connectors listing.
export function connectorViews<T, V>(
  connector: string,
  items: T[] | undefined,
  view: (item: T) => V,
): V[] {
  return (items ?? []).flatMap((item) => {
    try {
      return [view(item)]
    } catch (error) {
      logError('connectors.view_failed', error, { connector })

      return []
    }
  })
}

// Zeabur identities are refreshed opportunistically on list; keep the same
// throttle as the dedicated /zeabur-providers route.
const ZEABUR_IDENTITY_SYNC_INTERVAL_MS = 5 * 60 * 1000

// Aggregated connector inventory: everything the Connectors page shows, in one
// round trip. Each field carries exactly the same shape (and member-visibility
// rules) as the corresponding per-provider list endpoint — the mapping is the
// same shared code, so the two can't drift.
teamConnectorsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const userId = c.get('userId')
  const teamRole = c.get('teamRole')

  const doc = await teamByosBindings().findOne({ _id: teamId })
  const [aws, gcp, zeaburBindings, slackBinding, slackMappings, larkBinding, discord] =
    await Promise.all([
      awsAccountsView(doc?.awsRoles, userId, teamRole),
      gcpProjectsView(doc?.gcpServiceAccounts, userId, teamRole, teamId.toHexString()),
      syncZeaburProviderBindings(teamId, {
        minIntervalMs: ZEABUR_IDENTITY_SYNC_INTERVAL_MS,
        fallbackOnError: true,
      }),
      getSlackBindingForTeam(teamId),
      listSlackChannelMappings(teamId.toHexString()),
      getLarkBindingForTeam(teamId),
      getDiscordConnection(teamId.toHexString(), userId),
    ])

  // A team without its own installation can still have Slack through channel
  // mappings served by other workspaces' installations — surface that so the
  // connectors page doesn't render such teams as Slack-less.
  const slackLinkedChannels = await summarizeSlackLinkedChannels(slackMappings, slackBinding)

  return c.json({
    aws,
    gcp,
    cloudflare: connectorViews('cloudflare', doc?.cloudflareAccounts, cloudflareAccountView),
    linode: connectorViews('linode', doc?.linodeAccounts, linodeAccountView),
    hetzner: connectorViews('hetzner', doc?.hetznerAccounts, hetznerAccountView),
    tencent: tencentAccountsView(doc?.tencentAccounts, userId, teamRole),
    aliyun: aliyunAccountsView(doc?.aliyunAccounts, userId, teamRole),
    volcengine: volcengineAccountsView(doc?.volcengineAccounts, userId, teamRole),
    azure: azureAccountsView(doc?.azureAccounts, userId, teamRole),
    huawei: huaweiAccountsView(doc?.huaweiAccounts, userId, teamRole),
    vanta: connectorViews('vanta', doc?.vantaIntegrations, vantaIntegrationView),
    secureframe: connectorViews(
      'secureframe',
      doc?.secureframeIntegrations,
      secureframeIntegrationView,
    ),
    sonarqube: connectorViews('sonarqube', doc?.sonarqubeIntegrations, sonarqubePublicView),
    notion: connectorViews('notion', doc?.notionIntegrations, notionIntegrationView),
    onprem: connectorViews('onprem', doc?.onpremClusters, onpremClusterView),
    upstash: connectorViews('upstash', doc?.upstashAccounts, upstashAccountView),
    resend: connectorViews('resend', doc?.resendIntegrations, resendIntegrationView),
    posthog: connectorViews('posthog', doc?.posthogIntegrations, posthogPublicView),
    betterstack: connectorViews(
      'betterstack',
      doc?.betterStackIntegrations,
      betterStackIntegrationView,
    ),
    uptimeKuma: uptimeKumaInstancesView(doc?.uptimeKumaInstances, userId),
    tailscale: connectorViews('tailscale', doc?.tailscaleClients, tailscaleClientView),
    zeabur: zeaburBindings.flatMap(zeaburProviderView),
    github: connectorViews('github', doc?.githubInstallations, githubInstallationView),
    gitlab: connectorViews('gitlab', doc?.gitlabAccounts, gitlabBindingView),
    grafana: connectorViews('grafana', doc?.grafanaInstances, grafanaInstanceView),
    linear: connectorViews('linear', doc?.linearWorkspaces, linearWorkspaceView),
    jira: connectorViews('jira', doc?.jiraSites, jiraSiteView),
    asana: connectorViews('asana', doc?.asanaAccounts, asanaAccountView),
    sentry: connectorViews('sentry', doc?.sentryAccounts, sentryAccountView),
    discord,
    slack: {
      installation: slackBinding ? publicSlackInstallationView(slackBinding) : null,
      oauthAvailable: isSlackOAuthConfigured(),
      linkedChannels: slackLinkedChannels,
    },
    lark: {
      installation: larkBinding ? publicLarkInstallationView(larkBinding) : null,
    },
  })
})
