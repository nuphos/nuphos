import { safePromptField } from './credential-prompt-sections'

import type { AgentCredentialOptions } from './types'

type Options = AgentCredentialOptions

function optionalField(key: string, value: string | null): string {
  return value ? `${key}=${safePromptField(value)}; ` : ''
}

export function appendGithubInstallationLines(
  lines: string[],
  githubInstallations: Options['githubInstallations'],
  teamId: string,
) {
  if (githubInstallations.length === 0) return
  lines.push('', 'GitHub App installations:')
  for (const installation of githubInstallations) {
    const accountLogin = safePromptField(installation.accountLogin)

    lines.push(
      `- installationId=${installation.installationId}; accountLogin=${accountLogin}; accountType=${installation.accountType}; setupCommand="bash skills/github/scripts/setup-credentials.sh ${teamId} ${installation.installationId}"`,
    )
  }
}

export function appendGitlabBindingLines(
  lines: string[],
  gitlabBindings: Options['gitlabBindings'],
  teamId: string,
) {
  if (gitlabBindings.length === 0) return
  lines.push('', 'GitLab bindings:')
  for (const binding of gitlabBindings) {
    const hostUrl = safePromptField(binding.hostUrl)
    const username = safePromptField(binding.username)

    lines.push(
      `- bindingId=${binding.bindingId}; hostUrl=${hostUrl}; username=${username}; setupCommand="bash skills/gitlab/scripts/setup-credentials.sh ${teamId} ${binding.bindingId}"`,
    )
  }
}

export function appendNotionIntegrationLines(
  lines: string[],
  notionIntegrations: Options['notionIntegrations'],
  teamId: string,
) {
  if (notionIntegrations.length === 0) return
  lines.push('', 'Notion integrations:')
  for (const integration of notionIntegrations) {
    const label = safePromptField(integration.label)

    lines.push(
      `- integrationId=${integration.integrationId}; label=${label}; ${optionalField('workspaceName', integration.workspaceName)}setupCommand="bash skills/notion/scripts/setup-credentials.sh ${teamId} ${integration.integrationId}"`,
    )
  }
}

export function appendUpstashAccountLines(
  lines: string[],
  upstashAccounts: Options['upstashAccounts'],
  teamId: string,
) {
  if (upstashAccounts.length === 0) return
  lines.push('', 'Upstash accounts:')
  for (const account of upstashAccounts) {
    const label = safePromptField(account.label)

    lines.push(
      `- accountId=${account.accountId}; label=${label}; ${optionalField('email', account.email)}setupCommand="bash skills/upstash/scripts/setup-credentials.sh ${teamId} ${account.accountId}"; databasesEndpoint="/teams/${teamId}/upstash-accounts/${account.accountId}/databases"`,
    )
  }
}

export function appendCloudflareAccountLines(
  lines: string[],
  cloudflareAccounts: Options['cloudflareAccounts'],
  teamId: string,
) {
  if (cloudflareAccounts.length === 0) return
  lines.push('', 'Cloudflare accounts:')
  for (const account of cloudflareAccounts) {
    lines.push(
      `- accountId=${account.accountId}; ${optionalField('accountName', account.accountName)}setupCommand="bash skills/cloudflare/scripts/setup-credentials.sh ${teamId} ${account.accountId}"`,
    )
  }
}

export function appendGrafanaInstanceLines(
  lines: string[],
  grafanaInstances: Options['grafanaInstances'],
  teamId: string,
) {
  if (grafanaInstances.length === 0) return
  lines.push('', 'Grafana instances (proxied through Nuphos — no setup script):')
  for (const instance of grafanaInstances) {
    const name = safePromptField(instance.name)
    const grafanaUrl = safePromptField(instance.grafanaUrl)

    lines.push(
      `- instanceId=${instance.instanceId}; name=${name}; grafanaUrl=${grafanaUrl}; proxyBase="/teams/${teamId}/grafana-instances/${instance.instanceId}/proxy"; tip="Append any Grafana API path to proxyBase (e.g. proxyBase/api/search, proxyBase/api/datasources). The service-account token stays server-side — never ask for it or paste Grafana credentials into chat."`,
    )
  }
}

export function appendSonarqubeIntegrationLines(
  lines: string[],
  sonarqubeIntegrations: Options['sonarqubeIntegrations'],
  teamId: string,
) {
  if (sonarqubeIntegrations.length === 0) return
  lines.push('', 'SonarQube integrations (proxied through Nuphos — no setup script):')
  for (const integration of sonarqubeIntegrations) {
    const label = safePromptField(integration.label)
    const baseUrl = safePromptField(integration.baseUrl)
    const base = `/teams/${teamId}/sonarqube-integrations/${integration.integrationId}`

    lines.push(
      `- integrationId=${integration.integrationId}; label=${label}; baseUrl=${baseUrl}; projectsEndpoint="${base}/projects"; reportEndpoint="${base}/report"; tip="GET projectsEndpoint to find a projectKey, then GET reportEndpoint?projectKey=<key> for the quality report. The SonarQube token stays server-side — do not paste SonarQube credentials into chat."`,
    )
  }
}

export function appendPosthogIntegrationLines(
  lines: string[],
  posthogIntegrations: Options['posthogIntegrations'],
  teamId: string,
) {
  if (posthogIntegrations.length === 0) return
  lines.push('', 'PostHog integrations:')
  for (const integration of posthogIntegrations) {
    const projects = integration.projects
      .map((project) => `${String(project.id)}:${safePromptField(project.name)}`)
      .join(', ')

    lines.push(
      `- integrationId=${integration.integrationId}; label=${safePromptField(integration.label)}; host=${safePromptField(integration.apiBaseUrl)}; projects=[${projects}]; setupCommand="bash skills/posthog/scripts/setup-credentials.sh ${teamId} ${integration.integrationId} && source ~/.posthog/nuphos.env"`,
    )
  }
}
