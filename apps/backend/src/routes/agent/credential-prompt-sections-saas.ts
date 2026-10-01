import { safePromptField } from './credential-prompt-sections'

import type { AgentCredentialOptions } from './types'

type Options = AgentCredentialOptions
export function appendLinearWorkspaceLines(
  lines: string[],
  linearWorkspaces: Options['linearWorkspaces'],
  teamId: string,
) {
  if (linearWorkspaces.length === 0) return
  lines.push('', 'Linear workspaces:')
  for (const workspace of linearWorkspaces) {
    // label/name come from the Linear workspace and land in a high-authority
    // system message; strip control chars so a newline can't inject prompt
    // lines that rewrite the credential instructions.
    const label = safePromptField(workspace.label)
    const name = safePromptField(workspace.workspaceName)

    lines.push(
      `- workspaceId=${workspace.workspaceId}; label=${label}; workspaceName=${name}; setupCommand="bash skills/linear/scripts/setup-credentials.sh ${teamId} ${workspace.workspaceId}"`,
    )
  }
}

export function appendJiraSiteLines(
  lines: string[],
  jiraSites: Options['jiraSites'],
  teamId: string,
) {
  if (jiraSites.length === 0) return
  lines.push('', 'Jira sites:')
  for (const site of jiraSites) {
    // label/siteUrl come from the Atlassian site and land in a high-authority
    // system message; strip control chars so a newline can't inject prompt
    // lines that rewrite the credential instructions.
    const label = safePromptField(site.label)
    const siteUrl = safePromptField(site.siteUrl)

    lines.push(
      `- siteId=${site.siteId}; label=${label}; siteUrl=${siteUrl}; setupCommand="bash skills/jira/scripts/setup-credentials.sh ${teamId} ${site.siteId}"`,
    )
  }
}

export function appendAsanaAccountLines(
  lines: string[],
  asanaAccounts: Options['asanaAccounts'],
  teamId: string,
) {
  if (asanaAccounts.length === 0) return
  lines.push('', 'Asana accounts:')
  for (const account of asanaAccounts) {
    // label/email come from the Asana account and land in a high-authority
    // system message; strip control chars so a newline can't inject prompt
    // lines that rewrite the credential instructions.
    const label = safePromptField(account.label)
    const email = safePromptField(account.accountEmail ?? '')

    lines.push(
      `- accountId=${account.accountId}; label=${label}; email=${email}; setupCommand="bash skills/asana/scripts/setup-credentials.sh ${teamId} ${account.accountId}"`,
    )
  }
}

export function appendSentryAccountLines(
  lines: string[],
  sentryAccounts: Options['sentryAccounts'],
  teamId: string,
) {
  if (sentryAccounts.length === 0) return
  lines.push('', 'Sentry accounts:')
  for (const account of sentryAccounts) {
    // label/email come from the Sentry account and land in a high-authority
    // system message; strip control chars so a newline can't inject prompt
    // lines that rewrite the credential instructions.
    const label = safePromptField(account.label)
    const email = safePromptField(account.userEmail ?? '')

    lines.push(
      `- accountId=${account.accountId}; label=${label}; email=${email}; setupCommand="bash skills/sentry/scripts/setup-credentials.sh ${teamId} ${account.accountId}"`,
    )
  }
}

export function appendTailscaleClientLines(
  lines: string[],
  tailscaleClients: Options['tailscaleClients'],
  teamId: string,
) {
  if (tailscaleClients.length === 0) return
  lines.push('', 'Tailscale OAuth clients:')
  for (const client of tailscaleClients) {
    lines.push(
      `- clientId=${client.clientId}; label=${client.label}; oauthClientId=${client.oauthClientId}; setupCommand="bash skills/tailscale/scripts/setup-credentials.sh ${teamId} ${client.clientId}"; devicesEndpoint="/teams/${teamId}/tailscale-clients/${client.clientId}/devices"`,
    )
  }
}

export function appendZeaburProviderLines(
  lines: string[],
  zeaburProviders: Options['zeaburProviders'],
  teamId: string,
) {
  if (zeaburProviders.length === 0) return
  lines.push(
    '',
    'Zeabur providers (the only use of the zeabur CLI or Zeabur API): run the setupCommand to load the token, then use the zeabur skill to call the Zeabur GraphQL API (https://api.zeabur.com/graphql) or the zeabur CLI for projects, services, deployments, runtime/build logs, and environment variables. Prefer the listed projects/servers endpoints for those lists. Do not print the Zeabur token into chat.',
  )
  for (const provider of zeaburProviders) {
    lines.push(
      `- zeaburId=${provider.zeaburId}; kind=${provider.kind}; name=${provider.name}; setupCommand="bash skills/zeabur/scripts/setup-credentials.sh ${teamId} ${provider.zeaburId}"; projectsEndpoint="/teams/${teamId}/zeabur-providers/${provider.zeaburId}/projects"; serversEndpoint="/teams/${teamId}/zeabur-providers/${provider.zeaburId}/servers"`,
    )
  }
}

export function appendVantaIntegrationLines(
  lines: string[],
  vantaIntegrations: Options['vantaIntegrations'],
  teamId: string,
) {
  if (vantaIntegrations.length === 0) return
  lines.push(
    '',
    'Vanta integrations (read-only compliance posture — failing tests/vulnerabilities to resolve):',
  )
  for (const integration of vantaIntegrations) {
    lines.push(
      `- integrationId=${integration.integrationId}; label=${integration.label}; authType=${integration.authType}; testsEndpoint="/teams/${teamId}/vanta-integrations/${integration.integrationId}/tests"; tip="GET testsEndpoint returns { tests }; default lists NEEDS_ATTENTION (the compliance issues to fix). Append ?infraOnly=true for infrastructure-facing categories, or ?status=<STATUS> to change the filter. Each test carries failureDescription and remediationDescription. The token is held server-side — read via this Nuphos endpoint, do not paste Vanta tokens into chat."`,
    )
  }
}

export function appendSecureframeIntegrationLines(
  lines: string[],
  secureframeIntegrations: Options['secureframeIntegrations'],
  teamId: string,
) {
  if (secureframeIntegrations.length === 0) return
  lines.push(
    '',
    'Secureframe integrations (read-only compliance posture — failing tests to resolve):',
  )
  for (const integration of secureframeIntegrations) {
    lines.push(
      `- integrationId=${integration.integrationId}; label=${integration.label}; region=${integration.region}; testsEndpoint="/teams/${teamId}/secureframe-integrations/${integration.integrationId}/tests"; tip="GET testsEndpoint returns { tests }; default lists failing tests (health_status:fail — the compliance issues to fix). Append ?failingOnly=false for all tests, or ?q=<lucene> for a custom filter (e.g. q=health_status:fail AND frameworks:soc2_alpha). Each test carries description, healthStatus, enabled. The API secret is held server-side — read via this Nuphos endpoint, do not paste Secureframe credentials into chat."`,
    )
  }
}

export function appendResendIntegrationLines(
  lines: string[],
  resendIntegrations: Options['resendIntegrations'],
  teamId: string,
) {
  if (resendIntegrations.length === 0) return
  lines.push(
    '',
    'Resend integrations (transactional email — sending is an irreversible external action):',
  )
  for (const integration of resendIntegrations) {
    const permissionTip =
      integration.permission === 'sending_access'
        ? 'This key is sending-access only: POST /emails works, every management call (domains, audiences, api-keys) returns 401 restricted_api_key. Do not retry those.'
        : 'This key has full access: it can read and manage domains, audiences, contacts and api-keys in addition to sending.'

    lines.push(
      `- integrationId=${integration.integrationId}; label=${safePromptField(integration.label)}; permission=${integration.permission}; setupCommand="bash skills/resend/scripts/setup-credentials.sh ${teamId} ${integration.integrationId}"; tip="${permissionTip} Send only the mail the user explicitly asked for, to the recipients they named — never bulk-send, test-send, or improvise a recipient. Do not print the API key into chat."`,
    )
  }
}
