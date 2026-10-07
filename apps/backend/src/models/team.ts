import { db } from '@/lib/db'

import type {
  AliyunAccountBinding,
  AwsRoleBinding,
  AzureAccountBinding,
  CloudflareAccountBinding,
  GcpServiceAccountBinding,
  HetznerAccountBinding,
  HuaweiAccountBinding,
  LinodeAccountBinding,
  OnpremClusterBinding,
  TencentAccountBinding,
  UpstashAccountBinding,
  VolcengineAccountBinding,
} from '@/models/bindings-cloud'
import type {
  AsanaAccountBinding,
  GithubInstallationBinding,
  GitlabBinding,
  GrafanaInstanceBinding,
  JiraSiteBinding,
  LinearWorkspaceBinding,
  SentryAccountBinding,
  SonarqubeIntegrationBinding,
} from '@/models/bindings-devtools'
import type {
  BetterStackIntegrationBinding,
  LarkAppBinding,
  NotionIntegrationBinding,
  PosthogIntegrationBinding,
  ResendIntegrationBinding,
  SecureframeIntegrationBinding,
  SlackWorkspaceBinding,
  TailscaleOAuthClientBinding,
  UptimeKumaInstanceBinding,
  VantaIntegrationBinding,
  ZeaburProviderBinding,
} from '@/models/bindings-integrations'
import type { Collection, ObjectId } from 'mongodb'

export type TeamByosBindings = {
  _id: ObjectId
  awsRoles: AwsRoleBinding[]
  gcpServiceAccounts: GcpServiceAccountBinding[]
  // Optional: existing team docs predate this field and aren't backfilled, so
  // every reader uses `doc.tencentAccounts ?? []`.
  tencentAccounts?: TencentAccountBinding[]
  // Optional for the same reason; readers use `doc.aliyunAccounts ?? []`.
  aliyunAccounts?: AliyunAccountBinding[]
  // Optional for the same reason; readers use `doc.volcengineAccounts ?? []`.
  volcengineAccounts?: VolcengineAccountBinding[]
  // Optional for the same reason; readers use `doc.azureAccounts ?? []`.
  azureAccounts?: AzureAccountBinding[]
  // Optional for the same reason; readers use `doc.huaweiAccounts ?? []`.
  huaweiAccounts?: HuaweiAccountBinding[]
  grafanaInstances: GrafanaInstanceBinding[]
  githubInstallations: GithubInstallationBinding[]
  gitlabAccounts: GitlabBinding[]
  cloudflareAccounts: CloudflareAccountBinding[]
  linodeAccounts: LinodeAccountBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.hetznerAccounts ?? []`.
  hetznerAccounts?: HetznerAccountBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.onpremClusters ?? []`.
  onpremClusters?: OnpremClusterBinding[]
  betterStackIntegrations: BetterStackIntegrationBinding[]
  uptimeKumaInstances?: UptimeKumaInstanceBinding[]
  tailscaleClients: TailscaleOAuthClientBinding[]
  zeaburProviders: ZeaburProviderBinding[]
  linearWorkspaces: LinearWorkspaceBinding[]
  jiraSites: JiraSiteBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.asanaAccounts ?? []`.
  asanaAccounts?: AsanaAccountBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.sentryAccounts ?? []`.
  sentryAccounts?: SentryAccountBinding[]
  slackWorkspaces: SlackWorkspaceBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.larkApps ?? []`.
  larkApps?: LarkAppBinding[]
  vantaIntegrations: VantaIntegrationBinding[]
  secureframeIntegrations: SecureframeIntegrationBinding[]
  // Optional because bindings created before the SonarQube connector are not
  // backfilled; readers always normalize missing to an empty list.
  sonarqubeIntegrations?: SonarqubeIntegrationBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.notionIntegrations ?? []`.
  notionIntegrations?: NotionIntegrationBinding[]
  // Optional: existing team docs predate this field, so every reader uses
  // `doc.upstashAccounts ?? []`.
  upstashAccounts?: UpstashAccountBinding[]
  // Optional for the same reason; readers use `doc.resendIntegrations ?? []`.
  resendIntegrations?: ResendIntegrationBinding[]
  posthogIntegrations?: PosthogIntegrationBinding[]
  updatedAt: Date
}

/**
 * Complete defaults for a newly created team BYOS document — every array on
 * TeamByosBindings, empty. Bind routes upsert with
 * `$setOnInsert: emptyTeamByosBindings()` so a team whose *first* connector is
 * this one still gets a document matching the type; the hand-written field lists
 * that used to be dotted around the bind routes each omitted a different subset.
 */
export function emptyTeamByosBindings(): Omit<TeamByosBindings, '_id' | 'updatedAt'> {
  return {
    awsRoles: [],
    gcpServiceAccounts: [],
    tencentAccounts: [],
    aliyunAccounts: [],
    volcengineAccounts: [],
    azureAccounts: [],
    huaweiAccounts: [],
    grafanaInstances: [],
    githubInstallations: [],
    gitlabAccounts: [],
    cloudflareAccounts: [],
    linodeAccounts: [],
    hetznerAccounts: [],
    onpremClusters: [],
    betterStackIntegrations: [],
    uptimeKumaInstances: [],
    tailscaleClients: [],
    zeaburProviders: [],
    linearWorkspaces: [],
    jiraSites: [],
    asanaAccounts: [],
    slackWorkspaces: [],
    vantaIntegrations: [],
    secureframeIntegrations: [],
    sonarqubeIntegrations: [],
    notionIntegrations: [],
    upstashAccounts: [],
    posthogIntegrations: [],
  }
}

export type TeamInvitation = {
  _id: ObjectId
  inviterId: ObjectId
  teamId: ObjectId
  invitedAt: Date
  inviteeEmail: string
  acceptedAt?: Date
  rejectedAt?: Date
}

export type SidebarFavoriteEntry = {
  label: string
  key?: string
  href?: string
}

/** A personal sidebar layout scoped to one authenticated user in one team. */
export type UserTeamSidebarFavorites = {
  _id: ObjectId
  teamId: ObjectId
  userId: string
  entries: SidebarFavoriteEntry[]
  revision: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Which cards a team's home page shows. A document with a `userId` is that
 * person's layout, synced across their machines; the one with `userId: null`
 * is the team default, shown to anyone who has not customized theirs.
 */
export type TeamHomeLayout = {
  _id: ObjectId
  teamId: ObjectId
  userId: string | null
  layout: HomeLayout
  updatedAt: Date
}

export type HomeLayout = {
  team: boolean
  github: {
    id: string
    kind: 'pulls' | 'ci'
    repos: { installationId: number; fullName: string }[]
    statuses: string[]
  }[]
  panels: { dashboardId: string; panelId: string }[]
  grid?: { i: string; x: number; y: number; w: number; h: number }[]
}

export const teamByosBindings = (): Collection<TeamByosBindings> =>
  db().collection<TeamByosBindings>('team_byos_bindings')

export const teamInvitations = (): Collection<TeamInvitation> =>
  db().collection<TeamInvitation>('team_invitations')

export const userTeamSidebarFavorites = (): Collection<UserTeamSidebarFavorites> =>
  db().collection<UserTeamSidebarFavorites>('user_team_sidebar_favorites')

export const teamHomeLayouts = (): Collection<TeamHomeLayout> =>
  db().collection<TeamHomeLayout>('team_home_layouts')

/**
 * One-time backfill for the Aliyun AccessKey → RAM-role-OIDC migration. Legacy
 * bindings store `accessKeyId`/`encryptedAccessKeySecret` and lack the
 * now-required `roleArn`; they can't be auto-converted (there is no role to
 * point at), and the new adapter would fail every ACK/ECS/SWAS call for them.
 * Remove them so they don't surface as permanently-broken accounts — the
 * customer re-binds via the new OIDC wizard. Returns the number of team docs
 * that had at least one legacy binding pulled.
 */
export async function migrateLegacyAliyunBindings(): Promise<number> {
  const res = await teamByosBindings().updateMany(
    { 'aliyunAccounts.roleArn': { $exists: false } },
    { $pull: { aliyunAccounts: { roleArn: { $exists: false } } } },
  )

  return res.modifiedCount
}

/**
 * One-time backfill for the Tencent SecretId/SecretKey -> CAM-role-OIDC
 * migration, mirroring {@link migrateLegacyAliyunBindings}. Legacy bindings
 * store `secretId`/`encryptedSecretKey` and lack the now-required `roleArn`;
 * they can't be auto-converted, so remove them and let the customer re-bind via
 * the OIDC wizard. Returns the number of team docs affected.
 */
export async function migrateLegacyTencentBindings(): Promise<number> {
  const res = await teamByosBindings().updateMany(
    { 'tencentAccounts.roleArn': { $exists: false } },
    { $pull: { tencentAccounts: { roleArn: { $exists: false } } } },
  )

  return res.modifiedCount
}
