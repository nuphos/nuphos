import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { SWEEP_READ_TIMEOUT_MS } from './aliyun'
// OIDC web-identity federation reuses the shared Nuphos issuer (same signing
// key, JWKS, and per-team subject as the AWS connector — one Nuphos IdP).
import {
  awsOidcSubjectForTeam,
  getAwsOidcIssuer,
  isAwsOidcConfigured,
  mintNuphosOidcToken,
} from './aws-oidc'
import { unwrapVolcResult, volcErrorCode } from './volcengine-api'

import type { VolcengineHandle, VolcResponse } from './volcengine-api'

/**
 * sts:AssumeRoleWithOIDC is served from the global sts.volcengineapi.com and is
 * unsigned — the OIDC token is the credential, so no static Volcengine keys are
 * involved (mirrors AWS AssumeRoleWithWebIdentity).
 */
const STS_HOST = 'sts.volcengineapi.com'
const STS_VERSION = '2018-01-01'

/**
 * Whether the Nuphos OIDC issuer is configured (shared with the AWS connector —
 * one Nuphos IdP). Without a signing key we cannot mint web-identity tokens, so
 * AssumeRoleWithOIDC would have nothing to present.
 */
export function volcengineOidcConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * The values a customer needs to register Nuphos as an OIDC identity provider in
 * Volcengine IAM and pin their role's trust policy: the issuer URL, the audience
 * (client id) to configure on the provider, and this team's subject claim.
 */
export function volcengineOidcInfo(teamId: string): {
  configured: boolean
  issuer: string
  audience: string
  subject: string
} {
  return {
    configured: volcengineOidcConfigured(),
    issuer: getAwsOidcIssuer(),
    audience: config.byos.volcengine.oidc.audience,
    subject: awsOidcSubjectForTeam(teamId),
  }
}

/** RoleSessionName must be ≤64 chars of [\w+=,.@-]; sanitize defensively. */
function sanitizeSessionName(name: string): string {
  return (name || 'nuphos').replace(/[^\w+=,.@-]/g, '-').slice(0, 64)
}

/**
 * Assume a customer role via OIDC web-identity federation, returning short-lived
 * credentials. Mirrors AWS `assumeRoleWithWebIdentityForTeam`: Nuphos mints a
 * per-team RS256 token and calls sts:AssumeRoleWithOIDC *unsigned* — the token
 * is the credential. The customer's role trust policy must trust the Nuphos OIDC
 * provider for this team's subject; Volcengine resolves the provider from the
 * token's issuer, so no OIDCProviderTrn is sent.
 */
export async function assumeRoleWithOidc(
  roleTrn: string,
  teamId: string,
  opts: { sessionName?: string; durationSec?: number } = {},
): Promise<VolcengineHandle> {
  if (!volcengineOidcConfigured()) {
    throw new AppError(
      503,
      'volcengine_connector_unavailable',
      'The Nuphos OIDC signing key (AWS_BYOS_OIDC_PRIVATE_KEY) is not configured, so Volcengine roles cannot be assumed.',
    )
  }
  const body = new URLSearchParams({
    RoleTrn: roleTrn,
    RoleSessionName: sanitizeSessionName(opts.sessionName ?? 'nuphos'),
    OIDCToken: mintNuphosOidcToken(teamId, config.byos.volcengine.oidc.audience),
    DurationSeconds: String(opts.durationSec ?? config.byos.volcengine.oidc.sessionDurationSec),
  })
  let resp: VolcResponse<{
    Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string }
  }>

  try {
    const r = await fetch(`https://${STS_HOST}/?Action=AssumeRoleWithOIDC&Version=${STS_VERSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(SWEEP_READ_TIMEOUT_MS),
    })

    resp = (await r.json()) as typeof resp
  } catch (e) {
    throw new AppError(
      502,
      'volcengine_assume_role_failed',
      `sts:AssumeRoleWithOIDC request failed for ${roleTrn}: ${(e as Error).message}`,
    )
  }
  const creds = unwrapVolcResult(resp, 'sts:AssumeRoleWithOIDC')?.Credentials

  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new AppError(
      502,
      'volcengine_assume_role_failed',
      `sts:AssumeRoleWithOIDC returned no credentials for ${roleTrn}`,
    )
  }

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  }
}

/**
 * Verify the role is assumable via OIDC, so the connect dialog fails fast on a
 * missing/incorrect trust policy instead of storing an unusable binding.
 */
export async function verifyVolcengineRole(roleTrn: string, teamId: string): Promise<void> {
  try {
    await assumeRoleWithOidc(roleTrn, teamId, {
      sessionName: 'nuphos-bind-verify',
      durationSec: 900,
    })
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError(
      400,
      'volcengine_role_not_assumable',
      `Nuphos cannot assume ${roleTrn}. Check the role's trust policy: it must trust the Nuphos OIDC provider (${getAwsOidcIssuer()}) for this team's subject. (${(e as Error).message})`,
      { roleTrn, upstreamCode: volcErrorCode(e) },
    )
  }
}
