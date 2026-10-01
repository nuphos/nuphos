// Flattens a conversation's selected credentials into a provider-agnostic list
// the Claude Code runtime's MCP can render and then fetch by (provider, id),
// alongside the ones the actor may use but the conversation has not selected.
// The `credentialPath` is the provider route suffix shared by the ordinary
// team API and the legacy agent-session compatibility mount. Both reuse the
// same selection gate + vending logic.
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { setupHint, vendedAccountHint } from './credential-hints'
import { lister, vendedAccount, viaSkill, viaTeamApi } from './credential-lister'

import type {
  ClaudeCodeCredentialEntry,
  Lister,
  SelectionKey,
  SessionCredentials,
} from './credential-lister'
import type { AgentRef } from '@/lib/agents/identity'
import type { AgentCredentialOptions, AgentCredentialSelection } from '@/routes/agent/types'

export type {
  ClaudeCodeCredentialEntry,
  SessionCredentials,
  UnselectedCredentialEntry,
} from './credential-lister'

// Keyed by every selection field, so a new selectable type cannot compile
// without deciding how list_credentials shows it.
export const CREDENTIAL_LISTERS: Record<SelectionKey, Lister> = {
  awsRoleIds: lister({
    provider: 'aws',
    available: (o) => o.awsRoles,
    idOf: (r) => r.roleId,
    details: (r) => ({
      label: r.accountAlias ? `${r.accountAlias} (${r.accountId})` : r.accountId,
      credentialPath: `aws-accounts/${r.accountId}/credentials`,
      hint: setupHint('aws', `${r.accountId} <region> ${r.roleId}`),
    }),
  }),
  gcpServiceAccountIds: lister({
    provider: 'gcp',
    available: (o) => o.gcpServiceAccounts,
    idOf: (s) => s.serviceAccountId,
    details: (s) => ({
      label: `${s.projectId} (${s.serviceAccountEmail})`,
      credentialPath: `gcp-projects/${s.projectId}/credentials`,
      hint: setupHint('gcloud', `${s.projectId} ${s.serviceAccountId}`),
    }),
  }),
  linodeAccountIds: vendedAccount('linode', 'linode-accounts', (o) => o.linodeAccounts),
  hetznerAccountIds: vendedAccount('hetzner', 'hetzner-accounts', (o) => o.hetznerAccounts),
  tencentAccountIds: vendedAccount('tencent', 'tencent-accounts', (o) => o.tencentAccounts),
  aliyunAccountIds: vendedAccount('aliyun', 'aliyun-accounts', (o) => o.aliyunAccounts),
  volcengineAccountIds: vendedAccount(
    'volcengine',
    'volcengine-accounts',
    (o) => o.volcengineAccounts,
  ),
  azureAccountIds: vendedAccount('azure', 'azure-accounts', (o) => o.azureAccounts),
  huaweiAccountIds: vendedAccount('huawei', 'huawei-accounts', (o) => o.huaweiAccounts),
  onpremClusterIds: lister({
    provider: 'onprem',
    available: (o) => o.onpremClusters,
    idOf: (c) => c.clusterId,
    details: (c) => ({
      label: c.label,
      kubeContext: c.contextName,
      usage: 'Kubernetes cluster already in ~/.kube/config; select it with the kubeContext value.',
    }),
  }),
  betterStackIntegrationIds: lister({
    provider: 'betterstack',
    available: (o) => o.betterStackIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => ({
      label: i.label,
      credentialPath: `betterstack-integrations/${id}/credentials`,
    }),
  }),
  uptimeKumaInstanceIds: lister({
    provider: 'uptime-kuma',
    available: (o) => o.uptimeKumaInstances,
    idOf: (i) => i.instanceId,
    details: (i, id) => viaTeamApi(i.label, `/uptime-kuma-instances/${id}/monitors`),
  }),
  linearWorkspaceIds: lister({
    provider: 'linear',
    available: (o) => o.linearWorkspaces,
    idOf: (w) => w.workspaceId,
    details: (w, id) => ({ label: w.label, credentialPath: `linear-workspaces/${id}/credentials` }),
  }),
  jiraSiteIds: lister({
    provider: 'jira',
    available: (o) => o.jiraSites,
    idOf: (s) => s.siteId,
    details: (s, id) => ({ label: s.label, credentialPath: `jira-sites/${id}/credentials` }),
  }),
  asanaAccountIds: vendedAccount('asana', 'asana-accounts', (o) => o.asanaAccounts),
  sentryAccountIds: vendedAccount('sentry', 'sentry-accounts', (o) => o.sentryAccounts),
  tailscaleClientIds: lister({
    provider: 'tailscale',
    available: (o) => o.tailscaleClients,
    idOf: (c) => c.clientId,
    details: (c, id) => ({ label: c.label, credentialPath: `tailscale-clients/${id}/credentials` }),
  }),
  zeaburIds: lister({
    provider: 'zeabur',
    available: (o) => o.zeaburProviders,
    idOf: (p) => p.zeaburId,
    details: (p, id) => ({ label: p.name, credentialPath: `zeabur-providers/${id}/credentials` }),
  }),
  vantaIntegrationIds: lister({
    provider: 'vanta',
    available: (o) => o.vantaIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => viaTeamApi(i.label, `GET /vanta-integrations/${id}/tests`),
  }),
  secureframeIntegrationIds: lister({
    provider: 'secureframe',
    available: (o) => o.secureframeIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => viaTeamApi(i.label, `GET /secureframe-integrations/${id}/tests`),
  }),
  resendIntegrationIds: lister({
    provider: 'resend',
    available: (o) => o.resendIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => ({
      label: i.label,
      credentialPath: `resend-integrations/${id}/credentials`,
    }),
  }),
  posthogIntegrationIds: lister({
    provider: 'posthog',
    available: (o) => o.posthogIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => ({
      label: `${i.label} (${i.projects.map((project) => project.name).join(', ')})`,
      credentialPath: `posthog-integrations/${id}/credentials`,
      hint: vendedAccountHint('posthog', id),
    }),
  }),
  githubInstallationIds: lister({
    provider: 'github',
    available: (o) => o.githubInstallations,
    idOf: (i) => i.installationId,
    details: (i) => viaSkill(i.accountLogin, 'github'),
    unsetMeansAll: true,
  }),
  gitlabBindingIds: lister({
    provider: 'gitlab',
    available: (o) => o.gitlabBindings,
    idOf: (b) => b.bindingId,
    details: (b) => viaSkill(`${b.username} @ ${b.hostUrl}`, 'gitlab'),
    unsetMeansAll: true,
  }),
  grafanaInstanceIds: lister({
    provider: 'grafana',
    available: (o) => o.grafanaInstances,
    idOf: (i) => i.instanceId,
    details: (i) => viaSkill(i.name, 'grafana'),
    unsetMeansAll: true,
  }),
  sonarqubeIntegrationIds: lister({
    provider: 'sonarqube',
    available: (o) => o.sonarqubeIntegrations,
    idOf: (i) => i.integrationId,
    details: (i) => viaSkill(i.label, 'sonarqube'),
    unsetMeansAll: true,
  }),
  notionIntegrationIds: lister({
    provider: 'notion',
    available: (o) => o.notionIntegrations,
    idOf: (i) => i.integrationId,
    details: (i, id) => viaTeamApi(i.label, `GET /notion-integrations/${id}/credentials`),
    unsetMeansAll: true,
  }),
  upstashAccountIds: lister({
    provider: 'upstash',
    available: (o) => o.upstashAccounts,
    idOf: (a) => a.accountId,
    details: (a, id) => viaTeamApi(a.label, `GET /upstash-accounts/${id}/credentials`),
    unsetMeansAll: true,
  }),
  cloudflareAccountIds: lister({
    provider: 'cloudflare',
    available: (o) => o.cloudflareAccounts,
    idOf: (a) => a.accountId,
    details: (a, id) => ({
      label: a.accountName?.trim() ? a.accountName : id,
      credentialPath: `cloudflare-accounts/${id}/credentials`,
      hint: vendedAccountHint('cloudflare', id),
    }),
    unsetMeansAll: true,
  }),
  deviceIds: lister({
    provider: 'device',
    available: (o) => o.devices,
    idOf: (d) => d.deviceId,
    details: (d, id) => ({
      label: `${d.label} (${d.platform})`,
      usage: `Local machine; run commands on it with the local_exec tool, device=${id}.`,
    }),
  }),
}

export function partitionCredentials(
  selection: AgentCredentialSelection,
  options: AgentCredentialOptions,
): SessionCredentials {
  const parts = (Object.keys(CREDENTIAL_LISTERS) as SelectionKey[]).map((key) =>
    CREDENTIAL_LISTERS[key](selection[key], options),
  )

  return {
    selected: parts.flatMap((part) => part.selected),
    unselected: parts.flatMap((part) => part.unselected),
  }
}

export function flattenSelectedCredentials(
  selection: AgentCredentialSelection,
  options: AgentCredentialOptions,
): ClaudeCodeCredentialEntry[] {
  return partitionCredentials(selection, options).selected
}

export async function listSessionCredentials(
  agent: AgentRef,
  teamId: string,
): Promise<SessionCredentials> {
  const [selection, options] = await Promise.all([
    getAgentCredentialAccess(agent, teamId),
    getAgentCredentialOptions(teamId, agent.userId),
  ])

  return partitionCredentials(selection, options)
}

export async function listSelectedCredentials(
  agent: AgentRef,
  teamId: string,
): Promise<ClaudeCodeCredentialEntry[]> {
  return (await listSessionCredentials(agent, teamId)).selected
}
