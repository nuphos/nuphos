import { config } from '@/config'
import { AppError } from '@/lib/errors'

// OIDC web-identity federation reuses the shared Nuphos issuer (same signing
// key, JWKS, and per-team subject as the AWS/Aliyun/Volcengine connectors).
import {
  awsOidcSubjectForTeam,
  getAwsOidcIssuer,
  getAwsOidcJwks,
  isAwsOidcConfigured,
  mintNuphosOidcToken,
} from './aws-oidc'
import { tencentBootstrapRegion, tencentErrorCode } from './tencent-core'

import type { TencentHandle } from './tencent-core'
import type { TencentSite } from './types'

/**
 * sts:AssumeRoleWithWebIdentity (STS 2018-08-13). Tencent uses the v3 request
 * flow but the OIDC token is the credential, so the call is made with
 * `Authorization: SKIP` (no HMAC signature, no static keys) — mirroring AWS /
 * Aliyun / Volcengine web-identity federation.
 */
const STS_VERSION = '2018-08-13'
const STS_READ_TIMEOUT_MS = 20_000

function tencentStsHost(site: TencentSite): string {
  return site === 'international' ? 'sts.intl.tencentcloudapi.com' : 'sts.tencentcloudapi.com'
}

/**
 * Whether the Nuphos OIDC issuer is configured (shared with the AWS connector —
 * one Nuphos IdP). Without a signing key we cannot mint web-identity tokens, so
 * AssumeRoleWithWebIdentity would have nothing to present.
 */
export function tencentOidcConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * The values a customer needs to register Nuphos as a CAM OIDC identity provider
 * and pin their role's trust policy: the issuer URL, the audience (client id) to
 * configure on the provider, and this team's subject claim. Unlike AWS / Aliyun
 * / Volcengine, Tencent CAM does NOT auto-fetch the issuer's JWKS — the customer
 * must paste the signing public key, so include the JWKS here.
 */
export function tencentOidcInfo(teamId: string): {
  configured: boolean
  issuer: string
  audience: string
  subject: string
  jwks: string
} {
  const configured = tencentOidcConfigured()

  return {
    configured,
    issuer: getAwsOidcIssuer(),
    audience: config.byos.tencent.oidc.audience,
    subject: awsOidcSubjectForTeam(teamId),
    // getAwsOidcJwks() throws when the signing key is unconfigured, so only
    // populate it when the connector is ready.
    jwks: configured ? JSON.stringify(getAwsOidcJwks()) : '',
  }
}

/** RoleSessionName must be 2-64 chars of [\w+=,.@-]; sanitize defensively. */
function sanitizeSessionName(name: string): string {
  const sanitized = (name || 'nuphos').replace(/[^\w+=,.@-]/g, '-').slice(0, 64)

  // Enforce Tencent's 2-char minimum: an all-invalid 1-char input could sanitize
  // to a single '-'. Fall back to a safe default.
  return sanitized.length >= 2 ? sanitized : 'nuphos'
}

/**
 * Assume a customer CAM role via OIDC web-identity federation, returning
 * short-lived STS credentials. Nuphos mints a per-team RS256 token and calls
 * sts:AssumeRoleWithWebIdentity with `Authorization: SKIP` — the token is the
 * credential. `ProviderId` is the OIDC provider's *name* (Tencent references the
 * provider by name, not ARN); the role's trust policy must trust it.
 */
export async function assumeRoleWithWebIdentity(
  roleArn: string,
  providerId: string,
  teamId: string,
  opts: { site?: TencentSite; sessionName?: string; durationSec?: number } = {},
): Promise<TencentHandle> {
  if (!tencentOidcConfigured()) {
    throw new AppError(
      503,
      'tencent_connector_unavailable',
      'The Nuphos OIDC signing key (AWS_BYOS_OIDC_PRIVATE_KEY) is not configured, so Tencent Cloud roles cannot be assumed.',
    )
  }
  const site = opts.site ?? 'china'
  const payload = {
    ProviderId: providerId,
    WebIdentityToken: mintNuphosOidcToken(teamId, config.byos.tencent.oidc.audience),
    RoleArn: roleArn,
    RoleSessionName: sanitizeSessionName(opts.sessionName ?? 'nuphos'),
    DurationSeconds: opts.durationSec ?? config.byos.tencent.oidc.sessionDurationSec,
  }
  let resp: {
    Response?: {
      Error?: { Code?: string; Message?: string }
      Credentials?: { Token?: string; TmpSecretId?: string; TmpSecretKey?: string }
    }
  }

  try {
    const r = await fetch(`https://${tencentStsHost(site)}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The OIDC token authenticates the request; no HMAC signature is used.
        Authorization: 'SKIP',
        'X-TC-Action': 'AssumeRoleWithWebIdentity',
        'X-TC-Version': STS_VERSION,
        'X-TC-Region': tencentBootstrapRegion(site),
        'X-TC-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(STS_READ_TIMEOUT_MS),
    })

    resp = (await r.json()) as typeof resp
  } catch (e) {
    throw new AppError(
      502,
      'tencent_assume_role_failed',
      `sts:AssumeRoleWithWebIdentity request failed for ${roleArn}: ${(e as Error).message}`,
    )
  }
  const inner = resp.Response
  const creds = inner?.Credentials

  if (!creds?.TmpSecretId || !creds.TmpSecretKey || !creds.Token) {
    // Tencent returns errors in-band under Response.Error. Surface an AppError
    // so the member routes that assume the role directly return a
    // client-actionable response instead of a generic internal_error 500.
    throw new AppError(
      502,
      'tencent_assume_role_failed',
      inner?.Error?.Message ??
        `sts:AssumeRoleWithWebIdentity returned no credentials for ${roleArn}`,
      { roleArn, upstreamCode: inner?.Error?.Code },
    )
  }

  return { secretId: creds.TmpSecretId, secretKey: creds.TmpSecretKey, token: creds.Token, site }
}

/**
 * Verify the role is assumable via OIDC, so the connect dialog fails fast on a
 * missing/incorrect trust policy instead of storing an unusable binding.
 */
export async function verifyTencentRole(
  roleArn: string,
  providerId: string,
  teamId: string,
  site: TencentSite,
): Promise<void> {
  try {
    await assumeRoleWithWebIdentity(roleArn, providerId, teamId, {
      site,
      sessionName: 'nuphos-bind-verify',
      durationSec: 900,
    })
  } catch (e) {
    // The connector-unconfigured 503 is a deploy problem, not a bad trust
    // policy — pass it through. Everything else is re-wrapped into the
    // actionable bind hint, folding in the upstream Tencent message.
    if (e instanceof AppError && e.code === 'tencent_connector_unavailable') throw e
    throw new AppError(
      400,
      'tencent_role_not_assumable',
      `Nuphos cannot assume ${roleArn}. Check the CAM role's trust policy and OIDC provider: the role must trust the Nuphos OIDC provider (${getAwsOidcIssuer()}) for this team's subject, and the Site (China vs International) must match the account. (${(e as Error).message})`,
      { roleArn, upstreamCode: tencentErrorCode(e) },
    )
  }
}
