import { config } from '@/config'
import { AppError } from '@/lib/errors'

// Provider-agnostic sweep timeouts live next to the Aliyun sweep helpers.
import { SWEEP_READ_TIMEOUT_MS } from './aliyun-sweep'
// OIDC federation reuses the shared Nuphos issuer (same signing key, JWKS, and
// per-team subject as the AWS connector — one Nuphos IdP).
import {
  awsOidcSubjectForTeam,
  getAwsOidcIssuer,
  isAwsOidcConfigured,
  mintNuphosOidcToken,
} from './aws-oidc'
import { verifyTeamSpecificTrust } from './huawei-trust-policy'

// Huawei Cloud IAM5 federates OIDC identity providers through Trust
// Agencies: the customer registers Nuphos as an IAM5 OIDC provider, then
// assigns a Trust Agency to that audience — the agency's permissions are
// what Nuphos gets. We store the account (domain) id, the provider name,
// and the agency name; no customer secret.
//
// IAM5 providers live in a v5 resource store the legacy Keystone
// OS-AUTH/OS-FEDERATION endpoints can't see — federation goes through STS's
// AssumeAgencyWithOIDC (POST /v5/agencies/assume-with-oidc), a single
// unsigned call keyed by URN, not X-Idp-Id/domain scoping.

// STS is regional, unlike IAM's global host; cn-north-4 (北京四) is the
// account-default region, and trust agencies/OIDC providers are
// account-level (URN has no region), so any region's STS endpoint reaches
// them.
export const BOOTSTRAP_REGION = 'cn-north-4'
const STS_HOST = `sts.${BOOTSTRAP_REGION}.myhuaweicloud.com`

/** Short-lived Huawei Cloud credentials (temporary AK/SK + security token). */
export type HuaweiHandle = {
  accessKeyId: string
  secretAccessKey: string
  securityToken: string
  expiresAt: Date
}

/** Identity provider + trust agency this binding federates into. */
export type HuaweiIdentity = {
  /** Huawei Cloud account id (domain id) — 32 hex chars. */
  domainId: string
  /** IAM5 OIDC provider name — the URN is built from this, not its hex provider_id. */
  idpId: string
  /** Trust agency name the customer assigned to Nuphos's audience. */
  agencyName: string
}

function providerUrn(identity: HuaweiIdentity): string {
  return `iam::${identity.domainId}:oidcProvider:${identity.idpId}`
}

function agencyUrn(identity: HuaweiIdentity): string {
  return `iam::${identity.domainId}:agency:${identity.agencyName}`
}

/**
 * Whether the Nuphos OIDC issuer is configured (shared with the AWS connector —
 * one Nuphos IdP). Without a signing key we cannot mint ID tokens, so the
 * federation call would have nothing to present.
 */
export function huaweiOidcConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * The values a customer needs to register Nuphos as an OIDC identity provider
 * in Huawei Cloud IAM: the issuer URL, the audience (pinned as the token
 * `aud`), and this team's subject claim — the one to condition the assigned
 * trust agency's trust policy on, so a token minted for team A can never
 * reach team B's account.
 */
export function huaweiOidcInfo(teamId: string): {
  configured: boolean
  issuer: string
  audience: string
  subject: string
} {
  return {
    configured: huaweiOidcConfigured(),
    issuer: getAwsOidcIssuer(),
    audience: config.byos.huawei.oidc.audience,
    subject: awsOidcSubjectForTeam(teamId),
  }
}

/** Best-effort upstream detail for an error message; STS answers with JSON. */
function upstreamDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error_msg?: string; error?: { message?: string } }

    return parsed.error_msg ?? parsed.error?.message ?? body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

/**
 * Exchange the Nuphos ID token for the trust agency's temporary AK/SK in one
 * unsigned call — no X-Idp-Id, no domain scoping, no intermediate token: STS
 * resolves the provider and agency from their URNs and verifies the token
 * against the provider's own JWKS.
 */
async function assumeAgencyWithOidc(
  identity: HuaweiIdentity,
  teamId: string,
  durationSec: number,
): Promise<HuaweiHandle> {
  let resp: Response

  try {
    resp = await fetch(`https://${STS_HOST}/v5/agencies/assume-with-oidc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agency_session_name: `nuphos-${teamId}`,
        agency_urn: agencyUrn(identity),
        provider_urn: providerUrn(identity),
        id_token: mintNuphosOidcToken(teamId, config.byos.huawei.oidc.audience),
        duration_seconds: durationSec,
      }),
      signal: AbortSignal.timeout(SWEEP_READ_TIMEOUT_MS),
    })
  } catch (e) {
    throw new AppError(
      502,
      'huawei_federation_failed',
      `sts:AssumeAgencyWithOIDC request failed: ${(e as Error).message}`,
    )
  }

  if (!resp.ok) {
    throw new AppError(
      502,
      'huawei_federation_failed',
      `Huawei Cloud refused to assume trust agency "${identity.agencyName}" via identity provider "${identity.idpId}" (HTTP ${String(resp.status)}): ${upstreamDetail(await resp.text())}`,
      { domainId: identity.domainId, idpId: identity.idpId, agencyName: identity.agencyName },
    )
  }

  const { credentials } = (await resp.json()) as {
    credentials?: {
      access_key_id?: string
      secret_access_key?: string
      security_token?: string
      expiration?: string
    }
  }

  if (
    !credentials?.access_key_id ||
    !credentials.secret_access_key ||
    !credentials.security_token
  ) {
    throw new AppError(
      502,
      'huawei_federation_failed',
      'Huawei Cloud returned no temporary credentials',
    )
  }

  return {
    accessKeyId: credentials.access_key_id,
    secretAccessKey: credentials.secret_access_key,
    securityToken: credentials.security_token,
    expiresAt: credentials.expiration
      ? new Date(credentials.expiration)
      : new Date(Date.now() + durationSec * 1000),
  }
}

/**
 * Federate into the customer's account via OIDC, returning short-lived
 * credentials. Mirrors AWS `assumeRoleWithWebIdentityForTeam`: Nuphos mints a
 * per-team RS256 token and exchanges it at Huawei STS — no static Huawei keys.
 */
export async function assumeHuaweiIdentity(
  identity: HuaweiIdentity,
  teamId: string,
  opts: { durationSec?: number } = {},
): Promise<HuaweiHandle> {
  if (!huaweiOidcConfigured()) {
    throw new AppError(
      503,
      'huawei_connector_unavailable',
      'The Nuphos OIDC signing key (AWS_BYOS_OIDC_PRIVATE_KEY) is not configured, so Huawei Cloud accounts cannot be reached.',
    )
  }

  return assumeAgencyWithOidc(
    identity,
    teamId,
    opts.durationSec ?? config.byos.huawei.oidc.sessionDurationSec,
  )
}

/**
 * Verify the federation works, so the connect dialog fails fast on a missing or
 * misconfigured identity provider instead of storing an unusable binding. Also
 * confirms the agency's own trust policy restricts assumption to this team's
 * subject — a successful assumption proves this team can assume it, not that
 * other Nuphos teams (who share the same issuer and audience) cannot.
 */
export async function verifyHuaweiIdentity(
  identity: HuaweiIdentity,
  teamId: string,
): Promise<void> {
  let handle: HuaweiHandle

  try {
    handle = await assumeHuaweiIdentity(identity, teamId, { durationSec: 900 })
  } catch (e) {
    if (e instanceof AppError && e.code === 'huawei_connector_unavailable') throw e
    throw new AppError(
      400,
      'huawei_identity_not_usable',
      `Nuphos cannot federate into Huawei Cloud account ${identity.domainId}. Check the IAM identity provider "${identity.idpId}": protocol OIDC, identity provider URL ${getAwsOidcIssuer()}, audience ${config.byos.huawei.oidc.audience}, and that a trust agency named "${identity.agencyName}" is assigned to that audience. (${(e as Error).message})`,
      { domainId: identity.domainId, idpId: identity.idpId, agencyName: identity.agencyName },
    )
  }

  await verifyTeamSpecificTrust(handle, identity, teamId, providerUrn(identity))
}
