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
  appendPlaudAccountLines,
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

  if (!teamId || hasNoSelectedCredentials(selected)) {
    return [
      '## Cloud credentials enabled for this agent session',
      '',
      'No credentials are selected for this session. That is background state, not news to deliver: raise it only when something the user asked for needs one.',
    ].join('\n')
  }

  const lines = [
    '## Cloud credentials enabled for this agent session',
    '',
    "Use only the credentials listed here; do not discover, request or use others. If a task needs one that is not listed, ask the user to update this session's credential selection.",
    "Run a credential's setupCommand exactly as shown before using that provider (never hand-write Nuphos credential API URLs), then follow the provider's skill for its CLI, API and Nuphos endpoints. Entries without a setupCommand are proxied by Nuphos with server-side credentials.",
    'Never print or paste a token, key or password into chat. Do not describe or guess where the credential selector appears in the Nuphos UI.',
  ]

  appendAwsRoleLines(lines, selected.awsRoles, teamId)
  appendGcpServiceAccountLines(lines, selected.gcpServiceAccounts, teamId)
  appendLinodeAccountLines(lines, selected.linodeAccounts, teamId)
  appendHetznerAccountLines(lines, selected.hetznerAccounts, teamId)
  appendTencentAccountLines(lines, selected.tencentAccounts, teamId)
  appendAliyunAccountLines(lines, selected.aliyunAccounts, teamId)
  appendVolcengineAccountLines(lines, selected.volcengineAccounts, teamId)
  appendAzureAccountLines(lines, selected.azureAccounts, teamId)
  appendHuaweiAccountLines(lines, selected.huaweiAccounts, teamId)
  appendOnpremClusterLines(lines, selected.onpremClusters)
  appendBetterStackIntegrationLines(lines, selected.betterStackIntegrations, teamId)
  appendUptimeKumaInstanceLines(lines, selected.uptimeKumaInstances, teamId)
  appendLinearWorkspaceLines(lines, selected.linearWorkspaces, teamId)
  appendJiraSiteLines(lines, selected.jiraSites, teamId)
  appendAsanaAccountLines(lines, selected.asanaAccounts, teamId)
  appendSentryAccountLines(lines, selected.sentryAccounts, teamId)
  appendTailscaleClientLines(lines, selected.tailscaleClients, teamId)
  appendZeaburProviderLines(lines, selected.zeaburProviders, teamId)
  appendVantaIntegrationLines(lines, selected.vantaIntegrations)
  appendSecureframeIntegrationLines(lines, selected.secureframeIntegrations)
  appendResendIntegrationLines(lines, selected.resendIntegrations, teamId)
  for (const integration of selected.trelloIntegrations) {
    lines.push(
      `- Trello integrationId=${integration.integrationId}; executeCommand="bash skills/trello/scripts/composio.sh ${teamId} ${integration.integrationId} TOOL"; use the trello skill for boards, lists, cards, moves and comments. Never print credentials.`,
    )
  }
  appendPosthogIntegrationLines(lines, selected.posthogIntegrations, teamId)
  appendPlaudAccountLines(lines, selected.plaudAccounts, teamId)
  appendGithubInstallationLines(lines, selected.githubInstallations, teamId)
  appendGitlabBindingLines(lines, selected.gitlabBindings, teamId)
  appendGrafanaInstanceLines(lines, selected.grafanaInstances, teamId)
  appendSonarqubeIntegrationLines(lines, selected.sonarqubeIntegrations)
  appendNotionIntegrationLines(lines, selected.notionIntegrations, teamId)
  appendUpstashAccountLines(lines, selected.upstashAccounts, teamId)
  appendCloudflareAccountLines(lines, selected.cloudflareAccounts, teamId)
  appendDeviceLines(lines, selected.devices)

  return lines.join('\n')
}
