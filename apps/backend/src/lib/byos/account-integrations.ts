import { teamByosBindings } from '@/models'

import type {
  AsanaAccountBinding,
  BetterStackIntegrationBinding,
  CloudflareAccountBinding,
  GithubInstallationBinding,
  GitlabBinding,
  GrafanaInstanceBinding,
  HetznerAccountBinding,
  JiraSiteBinding,
  LinearWorkspaceBinding,
  LinodeAccountBinding,
  NotionIntegrationBinding,
  PosthogIntegrationBinding,
  ResendIntegrationBinding,
  SecureframeIntegrationBinding,
  SentryAccountBinding,
  SonarqubeIntegrationBinding,
  TailscaleOAuthClientBinding,
  UpstashAccountBinding,
  UptimeKumaInstanceBinding,
  VantaIntegrationBinding,
} from '@/models'
import type { ObjectId } from 'mongodb'

export async function findGrafanaInstance(
  teamId: ObjectId,
  instanceId: ObjectId,
): Promise<GrafanaInstanceBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { grafanaInstances: 1 } },
  )

  return (doc?.grafanaInstances ?? []).find((b) => b.id.equals(instanceId)) ?? null
}

export async function findGithubInstallation(
  teamId: ObjectId,
  installationId: number,
): Promise<GithubInstallationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { githubInstallations: 1 } },
  )

  return (doc?.githubInstallations ?? []).find((b) => b.installationId === installationId) ?? null
}

export async function findCloudflareAccount(
  teamId: ObjectId,
  accountId: string,
): Promise<CloudflareAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { cloudflareAccounts: 1 } },
  )

  return (doc?.cloudflareAccounts ?? []).find((b) => b.accountId === accountId) ?? null
}

export async function findLinodeAccount(
  teamId: ObjectId,
  accountId: ObjectId,
): Promise<LinodeAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { linodeAccounts: 1 } },
  )

  return (doc?.linodeAccounts ?? []).find((b) => b.id.equals(accountId)) ?? null
}

export async function findHetznerAccount(
  teamId: ObjectId,
  accountId: ObjectId,
): Promise<HetznerAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { hetznerAccounts: 1 } },
  )

  return (doc?.hetznerAccounts ?? []).find((b) => b.id.equals(accountId)) ?? null
}

export async function findBetterStackIntegration(
  teamId: ObjectId,
  integrationId: ObjectId,
): Promise<BetterStackIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { betterStackIntegrations: 1 } },
  )

  return (doc?.betterStackIntegrations ?? []).find((b) => b.id.equals(integrationId)) ?? null
}

export async function findUptimeKumaInstance(
  teamId: ObjectId,
  instanceId: ObjectId,
): Promise<UptimeKumaInstanceBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { uptimeKumaInstances: 1 } },
  )

  return (doc?.uptimeKumaInstances ?? []).find((b) => b.id.equals(instanceId)) ?? null
}

export async function findTailscaleClient(
  teamId: ObjectId,
  clientId: ObjectId,
): Promise<TailscaleOAuthClientBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { tailscaleClients: 1 } },
  )

  return (doc?.tailscaleClients ?? []).find((b) => b.id.equals(clientId)) ?? null
}

export async function removeGithubInstallationFromAllTeams(
  installationId: number,
): Promise<number> {
  const result = await teamByosBindings().updateMany(
    { 'githubInstallations.installationId': installationId },
    {
      $pull: { githubInstallations: { installationId } },
      $set: { updatedAt: new Date() },
    },
  )

  return result.modifiedCount
}

export async function findGitlabBinding(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<GitlabBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gitlabAccounts: 1 } },
  )

  return (doc?.gitlabAccounts ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findLinearWorkspace(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<LinearWorkspaceBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { linearWorkspaces: 1 } },
  )

  return (doc?.linearWorkspaces ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findVantaIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<VantaIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { vantaIntegrations: 1 } },
  )

  return (doc?.vantaIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findSecureframeIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<SecureframeIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { secureframeIntegrations: 1 } },
  )

  return (doc?.secureframeIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findSonarqubeIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<SonarqubeIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { sonarqubeIntegrations: 1 } },
  )

  return (doc?.sonarqubeIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findNotionIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<NotionIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { notionIntegrations: 1 } },
  )

  return (doc?.notionIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findUpstashAccount(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<UpstashAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { upstashAccounts: 1 } },
  )

  return (doc?.upstashAccounts ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findResendIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<ResendIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { resendIntegrations: 1 } },
  )

  return (doc?.resendIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findJiraSite(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<JiraSiteBinding | null> {
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { jiraSites: 1 } })

  return (doc?.jiraSites ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findAsanaAccount(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<AsanaAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { asanaAccounts: 1 } },
  )

  return (doc?.asanaAccounts ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findSentryAccount(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<SentryAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { sentryAccounts: 1 } },
  )

  return (doc?.sentryAccounts ?? []).find((b) => b.id.equals(bindingId)) ?? null
}

export async function findPosthogIntegration(
  teamId: ObjectId,
  bindingId: ObjectId,
): Promise<PosthogIntegrationBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { posthogIntegrations: 1 } },
  )

  return (doc?.posthogIntegrations ?? []).find((b) => b.id.equals(bindingId)) ?? null
}
