import {
  AccountClient,
  GetAccountInformationCommand,
  GetContactInformationCommand,
} from '@aws-sdk/client-account'
import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2'
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam'
import { AssumeRoleWithWebIdentityCommand, STSClient } from '@aws-sdk/client-sts'

import { config } from '@/config'

import { extractAwsAccountId, findAwsOidcTeamForRoleArn } from './account'
import { isAwsOidcConfigured, mintAwsWebIdentityToken } from './aws-oidc'

export type TempCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

export type AssumeOptions = {
  /**
   * Inline IAM session policy. AWS computes effective permissions as the
   * intersection of (role's identity policy) ∩ (session policy). Use null/omit
   * to inherit the role's full permissions (legacy behavior).
   */
  sessionPolicy?: string | null
  /**
   * Custom RoleSessionName — surfaces in CloudTrail. Use to encode agent /
   * member / grant provenance for audit. Must match `[\w+=,.@-]{2,64}`; we
   * sanitize automatically.
   */
  sessionName?: string
  /** Override default session duration (capped by role's MaxSessionDuration). */
  durationSec?: number
}

export function awsConnectorConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * Assume an OIDC-bound customer role with a short-lived, team-scoped web
 * identity. AWS BYOS deliberately has no static-credential fallback: an OIDC
 * trust failure must remain visible, and deleting a central IAM principal must
 * never take every customer account down with it.
 */
export async function assumeRoleAsConnector(
  roleArn: string,
  opts: AssumeOptions = {},
): Promise<TempCredentials> {
  if (!isAwsOidcConfigured()) {
    throw new Error('AWS BYOS OIDC connector is not configured')
  }
  const oidcTeamId = await resolveOidcTeamForRole(roleArn)

  if (!oidcTeamId) {
    throw new Error(
      `AWS role ${roleArn} is not bound with OIDC; configure its web-identity trust and rebind it`,
    )
  }

  return assumeRoleWithWebIdentityForTeam(oidcTeamId, roleArn, opts)
}

const OIDC_TEAM_TTL_MS = 60 * 1000
const oidcTeamCache = new Map<string, { teamId: string | null; expiresAt: number }>()

async function resolveOidcTeamForRole(roleArn: string): Promise<string | null> {
  const cached = oidcTeamCache.get(roleArn)

  if (cached && cached.expiresAt > Date.now()) return cached.teamId
  const teamId = (await findAwsOidcTeamForRoleArn(roleArn))?.toHexString() ?? null

  oidcTeamCache.set(roleArn, { teamId, expiresAt: Date.now() + OIDC_TEAM_TTL_MS })

  return teamId
}

/**
 * sts:AssumeRoleWithWebIdentity with a Nuphos-issued token for this team.
 * The call is unsigned — AWS authenticates the token against our JWKS — so
 * no client credentials are involved.
 */
export async function assumeRoleWithWebIdentityForTeam(
  teamId: string,
  roleArn: string,
  opts: AssumeOptions = {},
): Promise<TempCredentials> {
  const sts = new STSClient({ region: 'us-east-1' })
  const sessionName = sanitizeSessionName(opts.sessionName ?? 'nuphos-byos')
  const cmd = new AssumeRoleWithWebIdentityCommand({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    WebIdentityToken: mintAwsWebIdentityToken(teamId),
    DurationSeconds: opts.durationSec ?? config.byos.aws.sessionDurationSec,
    ...(opts.sessionPolicy ? { Policy: opts.sessionPolicy } : {}),
  })
  const out = await sts.send(cmd)

  return requireCompleteCredentials(out.Credentials, 'AssumeRoleWithWebIdentity')
}

function requireCompleteCredentials(
  c: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string } | undefined,
  operation: string,
): TempCredentials {
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error(`${operation} returned incomplete credentials`)
  }

  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  }
}

/** RoleSessionName must match [\w+=,.@-]{2,64}. Map invalid chars to '-'. */
export function sanitizeSessionName(s: string): string {
  const cleaned = s.replace(/[^\w+=,.@-]/g, '-')

  if (cleaned.length === 0) return 'atlas'
  if (cleaned.length < 2) return `${cleaned}-x`

  return cleaned.length > 64 ? cleaned.slice(0, 64) : cleaned
}

const ENABLED_REGIONS_TTL_MS = 60 * 60 * 1000
const enabledRegionsCache = new Map<string, { regions: string[]; expiresAt: number }>()

const ACCOUNT_ALIAS_TTL_MS = 60 * 60 * 1000
const accountAliasCache = new Map<string, { alias: string | null; expiresAt: number }>()

/**
 * Read the display-only account alias without doing STS/IAM network I/O.
 * Credential pickers and chat startup use this path so a slow AWS account can
 * never delay an Agent turn; account bind/detail routes warm the same cache.
 */
export function cachedAwsAccountAlias(roleArn: string): string | null {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) return null
  const cached = accountAliasCache.get(accountId)

  return cached && cached.expiresAt > Date.now() ? cached.alias : null
}

export async function getAwsAccountAlias(roleArn: string): Promise<string | null> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) return null
  const cached = accountAliasCache.get(accountId)

  if (cached && cached.expiresAt > Date.now()) return cached.alias

  let alias: string | null

  try {
    const temp = await assumeRoleAsConnector(roleArn)
    const region = 'us-east-1'

    const iam = new IAMClient({ region, credentials: temp })
    const iamOut = await iam.send(new ListAccountAliasesCommand({}))

    alias = iamOut.AccountAliases?.[0] ?? null

    if (!alias) {
      const account = new AccountClient({ region, credentials: temp })

      try {
        const out = await account.send(new GetAccountInformationCommand({}))

        if (out.AccountName) alias = out.AccountName
      } catch {
        // GetAccountInformation requires account:GetAccountInformation; fall through
      }
      if (!alias) {
        try {
          const out = await account.send(new GetContactInformationCommand({}))

          alias = out.ContactInformation?.CompanyName ?? out.ContactInformation?.FullName ?? null
        } catch {
          // give up
        }
      }
    }
  } catch {
    alias = null
  }
  accountAliasCache.set(accountId, { alias, expiresAt: Date.now() + ACCOUNT_ALIAS_TTL_MS })

  return alias
}

export async function getEnabledRegions(
  accountId: string,
  temp: TempCredentials,
): Promise<string[]> {
  const cached = enabledRegionsCache.get(accountId)

  if (cached && cached.expiresAt > Date.now()) return cached.regions

  const ec2 = new EC2Client({ region: 'us-east-1', credentials: temp })
  const out = await ec2.send(new DescribeRegionsCommand({}))
  const regions = (out.Regions ?? []).map((r) => r.RegionName).filter((r): r is string => !!r)

  enabledRegionsCache.set(accountId, { regions, expiresAt: Date.now() + ENABLED_REGIONS_TTL_MS })

  return regions
}
