import {
  appendAliyunAccountLines,
  appendAwsRoleLines,
  appendAzureAccountLines,
  appendBetterStackIntegrationLines,
  appendDeviceLines,
  appendGcpServiceAccountLines,
  appendHetznerAccountLines,
  appendHuaweiAccountLines,
  appendLinodeAccountLines,
  appendOnpremClusterLines,
  appendTencentAccountLines,
  appendUptimeKumaInstanceLines,
  appendVolcengineAccountLines,
} from './credential-prompt-sections'
import {
  appendCloudflareAccountLines,
  appendGithubInstallationLines,
  appendGitlabBindingLines,
  appendGrafanaInstanceLines,
  appendNotionIntegrationLines,
  appendPosthogIntegrationLines,
  appendSonarqubeIntegrationLines,
  appendUpstashAccountLines,
} from './credential-prompt-sections-devtools'
import {
  appendAsanaAccountLines,
  appendJiraSiteLines,
  appendLinearWorkspaceLines,
  appendResendIntegrationLines,
  appendSecureframeIntegrationLines,
  appendSentryAccountLines,
  appendTailscaleClientLines,
  appendVantaIntegrationLines,
  appendZeaburProviderLines,
} from './credential-prompt-sections-saas'
import { hasNoSelectedCredentials, selectAgentCredentials } from './credential-prompt-selection'

import type { AgentCredentialAccessSelection } from './credential-prompt-selection'
import type { AgentCredentialOptions } from './types'

export function renderAgentCredentialPrompt(
  access: AgentCredentialAccessSelection | undefined,
  options: AgentCredentialOptions,
  teamId: string | undefined,
): string {
  const selected = selectAgentCredentials(access, options)
  const lines = [
    '## Cloud credentials enabled for this agent session',
    '',
    "The agent may only use the AWS roles, GCP service accounts, on-prem Kubernetes clusters, Linode accounts, Hetzner accounts, Tencent accounts, Aliyun accounts, Volcengine accounts, Azure subscriptions, Huawei Cloud accounts, Better Stack integrations, Uptime Kuma instances, Linear workspaces, Jira sites, Tailscale OAuth clients, Zeabur providers, GitHub App installations, GitLab bindings, Grafana instances, SonarQube integrations, Notion integrations, Upstash accounts, Cloudflare accounts, and PostHog integrations listed in this section. Do not try to discover, request, or use unlisted cloud credentials. If the required credential is not listed, ask the user to update this session's credential selection.",
    'For AWS, GCP, Linode, Hetzner, Tencent, Aliyun, Volcengine, Azure, Huawei Cloud, and Tailscale, use the exact setupCommand shown below to configure credentials. Do not hand-write Nuphos credential API URLs.',
    'For Better Stack, use the exact setupCommand shown below before calling Better Stack APIs. Do not print or paste API tokens into chat.',
    'For Uptime Kuma, use the Nuphos monitor endpoints shown below for list/create/update/pause/resume/delete operations. The Uptime Kuma credentials are held server-side; do not print or paste them into chat.',
    'For Linear, use the exact setupCommand shown below to load a short-lived access token, then use the linear skill to call the Linear GraphQL API (api.linear.app/graphql) directly. Do not print or paste the access token into chat.',
    'For Jira, use the exact setupCommand shown below to load a short-lived access token + cloudId, then use the jira skill to call api.atlassian.com/ex/jira/<cloudId>/rest/api/3 directly. Do not print or paste the access token into chat.',
    'For Asana, use the exact setupCommand shown below to load a short-lived access token, then use the asana skill to call app.asana.com/api/1.0 directly. Do not print or paste the access token into chat.',
    'For Sentry, use the exact setupCommand shown below to load a short-lived access token, then use the sentry skill to call sentry.io/api/0 directly. The grant is read-only, so report findings rather than attempting to mutate issues. Do not print or paste the access token into chat.',
    'For Resend, use the exact setupCommand shown below to load the API key, then use the resend skill to call api.resend.com directly. Sending an email is an irreversible external action: only send when the user has asked for that specific mail, and never send to recipients they did not name. Do not print or paste the API key into chat.',
    'For PostHog, use the exact setupCommand shown below to load a short-lived access token, the region host and project ids, then use the posthog skill to query the PostHog API directly. Stay within the granted scopes it exports as POSTHOG_SCOPES, and change PostHog data only when the user asked for that change and approved the dry run the helper prints. Do not print or paste the access token into chat.',
    'For GitHub, GitLab, Notion, Upstash, and Cloudflare, use the exact setupCommand shown below to configure credentials. The ids are already listed here, so do not curl a Nuphos collection endpoint to discover them first.',
    'For Grafana and SonarQube there is no setup script: call the Nuphos endpoints shown below, which proxy the request with server-side credentials. Do not ask for or paste Grafana or SonarQube tokens into chat.',
    'For Nuphos GUI markdown links, use the guiLinks/template hints shown below whenever you mention a concrete discovered resource and have the required ids. GUI links are not credential API URLs.',
    'Do not describe or guess where the credential selector appears in the Nuphos UI.',
  ]

  if (!teamId || hasNoSelectedCredentials(selected)) {
    lines.push(
      '',
      'No AWS roles, GCP service accounts, Linode accounts, Hetzner accounts, Tencent accounts, Aliyun accounts, Volcengine accounts, Azure subscriptions, Huawei Cloud accounts, Better Stack integrations, Uptime Kuma instances, Linear workspaces, Jira sites, Asana accounts, Sentry accounts, Tailscale OAuth clients, Zeabur providers, Vanta integrations, Secureframe integrations, Resend integrations, GitHub App installations, GitLab bindings, Grafana instances, SonarQube integrations, Notion integrations, Upstash accounts, Cloudflare accounts, or PostHog integrations are enabled for this session. That is background state, not news to deliver: raise it when something the user actually asked for needs one of them, and not before.',
    )

    return lines.join('\n')
  }
  appendAwsRoleLines(lines, selected.awsRoles, teamId)
  appendGcpServiceAccountLines(lines, selected.gcpServiceAccounts, teamId)
  appendLinodeAccountLines(lines, selected.linodeAccounts, teamId)
  appendHetznerAccountLines(lines, selected.hetznerAccounts, teamId)
  appendTencentAccountLines(lines, selected.tencentAccounts, teamId)
  appendAliyunAccountLines(lines, selected.aliyunAccounts, teamId)
  appendVolcengineAccountLines(lines, selected.volcengineAccounts, teamId)
  appendAzureAccountLines(lines, selected.azureAccounts, teamId)
  appendHuaweiAccountLines(lines, selected.huaweiAccounts, teamId)
  appendOnpremClusterLines(lines, selected.onpremClusters, teamId)
  appendBetterStackIntegrationLines(lines, selected.betterStackIntegrations, teamId)
  appendUptimeKumaInstanceLines(lines, selected.uptimeKumaInstances, teamId)
  appendLinearWorkspaceLines(lines, selected.linearWorkspaces, teamId)
  appendJiraSiteLines(lines, selected.jiraSites, teamId)
  appendAsanaAccountLines(lines, selected.asanaAccounts, teamId)
  appendSentryAccountLines(lines, selected.sentryAccounts, teamId)
  appendTailscaleClientLines(lines, selected.tailscaleClients, teamId)
  appendZeaburProviderLines(lines, selected.zeaburProviders, teamId)
  appendVantaIntegrationLines(lines, selected.vantaIntegrations, teamId)
  appendSecureframeIntegrationLines(lines, selected.secureframeIntegrations, teamId)
  appendResendIntegrationLines(lines, selected.resendIntegrations, teamId)
  appendPosthogIntegrationLines(lines, selected.posthogIntegrations, teamId)
  appendGithubInstallationLines(lines, selected.githubInstallations, teamId)
  appendGitlabBindingLines(lines, selected.gitlabBindings, teamId)
  appendGrafanaInstanceLines(lines, selected.grafanaInstances, teamId)
  appendSonarqubeIntegrationLines(lines, selected.sonarqubeIntegrations, teamId)
  appendNotionIntegrationLines(lines, selected.notionIntegrations, teamId)
  appendUpstashAccountLines(lines, selected.upstashAccounts, teamId)
  appendCloudflareAccountLines(lines, selected.cloudflareAccounts, teamId)
  appendDeviceLines(lines, selected.devices)

  return lines.join('\n')
}
