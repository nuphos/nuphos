import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { aliyunErrorCode } from './aliyun-errors'
import { SWEEP_READ_TIMEOUT_MS } from './aliyun-sweep'
// OIDC web-identity federation reuses the shared Nuphos issuer (same signing
// key, JWKS, and per-team subject as the AWS/Volcengine connectors).
import {
  awsOidcSubjectForTeam,
  getAwsOidcIssuer,
  isAwsOidcConfigured,
  mintNuphosOidcToken,
} from './aws-oidc'

import type { AliyunSite } from './types'

/**
 * Short-lived Alibaba Cloud STS credentials, obtained via OIDC web-identity
 * federation (like AWS/Volcengine): Nuphos mints a per-team token and calls
 * sts:AssumeRoleWithOIDC into the customer's RAM role. The securityToken
 * accompanies the temporary AccessKeyId/Secret. `site` picks the partition
 * (China vs International) and therefore which API endpoints/regions to hit.
 */
export type AliyunHandle = {
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  site: AliyunSite
}

/**
 * Region used to bootstrap region discovery / as the sandbox default. Must be a
 * region the partition's credentials can actually authenticate against.
 */
export function aliyunBootstrapRegion(site: AliyunSite): string {
  return site === 'international' ? 'ap-southeast-1' : 'cn-hangzhou'
}

/**
 * sts:AssumeRoleWithOIDC (STS 2015-04-01) is served from the partition's
 * regional STS gateway and is unsigned — the OIDC token is the credential, so no
 * static Aliyun keys are involved (mirrors AWS AssumeRoleWithWebIdentity).
 */
const STS_VERSION = '2015-04-01'

function aliyunStsHost(site: AliyunSite): string {
  return `sts.${aliyunBootstrapRegion(site)}.aliyuncs.com`
}

/**
 * Whether the Nuphos OIDC issuer is configured (shared with the AWS connector —
 * one Nuphos IdP). Without a signing key we cannot mint web-identity tokens, so
 * AssumeRoleWithOIDC would have nothing to present.
 */
export function aliyunOidcConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * The values a customer needs to register Nuphos as a RAM OIDC identity provider
 * and pin their role's trust policy: the issuer URL, the audience (client id) to
 * configure on the provider, and this team's subject claim.
 */
export function aliyunOidcInfo(teamId: string): {
  configured: boolean
  issuer: string
  audience: string
  subject: string
} {
  return {
    configured: aliyunOidcConfigured(),
    issuer: getAwsOidcIssuer(),
    audience: config.byos.aliyun.oidc.audience,
    subject: awsOidcSubjectForTeam(teamId),
  }
}

/** RoleSessionName must be 2–64 chars of [\w+=,.@-]; sanitize defensively. */
function sanitizeSessionName(name: string): string {
  return (name || 'nuphos').replace(/[^\w+=,.@-]/g, '-').slice(0, 64)
}

/**
 * Assume a customer RAM role via OIDC web-identity federation, returning
 * short-lived STS credentials. Mirrors the Volcengine adapter: Nuphos mints a
 * per-team RS256 token and calls sts:AssumeRoleWithOIDC *unsigned* — the token is
 * the credential. Aliyun requires BOTH the role ARN and the OIDC provider ARN
 * (unlike Volcengine, which resolves the provider from the token issuer).
 */
export async function assumeRoleWithOidc(
  roleArn: string,
  oidcProviderArn: string,
  teamId: string,
  opts: { site?: AliyunSite; sessionName?: string; durationSec?: number } = {},
): Promise<AliyunHandle> {
  if (!aliyunOidcConfigured()) {
    throw new AppError(
      503,
      'aliyun_connector_unavailable',
      'The Nuphos OIDC signing key (AWS_BYOS_OIDC_PRIVATE_KEY) is not configured, so Alibaba Cloud roles cannot be assumed.',
    )
  }
  const site = opts.site ?? 'china'
  const body = new URLSearchParams({
    Action: 'AssumeRoleWithOIDC',
    Version: STS_VERSION,
    Format: 'JSON',
    // Aliyun's RPC framework requires these common parameters even for the
    // unsigned OIDC call (AWS/Volcengine don't). Timestamp must be ISO-8601 UTC
    // without milliseconds; SignatureNonce dedups replays.
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureNonce: crypto.randomUUID(),
    RoleArn: roleArn,
    OIDCProviderArn: oidcProviderArn,
    OIDCToken: mintNuphosOidcToken(teamId, config.byos.aliyun.oidc.audience),
    RoleSessionName: sanitizeSessionName(opts.sessionName ?? 'nuphos'),
    DurationSeconds: String(opts.durationSec ?? config.byos.aliyun.oidc.sessionDurationSec),
  })
  let resp: {
    Code?: string
    Message?: string
    Credentials?: { AccessKeyId?: string; AccessKeySecret?: string; SecurityToken?: string }
  }

  try {
    const r = await fetch(`https://${aliyunStsHost(site)}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(SWEEP_READ_TIMEOUT_MS),
    })

    resp = (await r.json()) as typeof resp
  } catch (e) {
    throw new AppError(
      502,
      'aliyun_assume_role_failed',
      `sts:AssumeRoleWithOIDC request failed for ${roleArn}: ${(e as Error).message}`,
    )
  }
  const creds = resp.Credentials

  if (!creds?.AccessKeyId || !creds.AccessKeySecret || !creds.SecurityToken) {
    // Aliyun returns errors in-band with an RPC `Code`/`Message`. Surface an
    // AppError so the member routes (/credentials, /clusters, /ecs-instances,
    // /swas-instances) that call this directly return a client-actionable 502
    // instead of a generic internal_error 500 from the error boundary.
    throw new AppError(
      502,
      'aliyun_assume_role_failed',
      resp.Message ?? `sts:AssumeRoleWithOIDC returned no credentials for ${roleArn}`,
      { roleArn, upstreamCode: resp.Code },
    )
  }

  return {
    accessKeyId: creds.AccessKeyId,
    accessKeySecret: creds.AccessKeySecret,
    securityToken: creds.SecurityToken,
    site,
  }
}

/**
 * Verify the role is assumable via OIDC, so the connect dialog fails fast on a
 * missing/incorrect trust policy instead of storing an unusable binding.
 */
export async function verifyAliyunRole(
  roleArn: string,
  oidcProviderArn: string,
  teamId: string,
  site: AliyunSite,
): Promise<void> {
  try {
    await assumeRoleWithOidc(roleArn, oidcProviderArn, teamId, {
      site,
      sessionName: 'nuphos-bind-verify',
      durationSec: 900,
    })
  } catch (e) {
    // The connector-unconfigured 503 is a deploy problem, not a bad trust
    // policy — pass it through. Everything else (including the in-band
    // aliyun_assume_role_failed AppError) is re-wrapped into the actionable bind
    // hint, folding in the upstream Aliyun message.
    if (e instanceof AppError && e.code === 'aliyun_connector_unavailable') throw e
    throw new AppError(
      400,
      'aliyun_role_not_assumable',
      `Nuphos cannot assume ${roleArn}. Check the RAM role's trust policy and OIDC provider: the role must trust the Nuphos OIDC provider (${getAwsOidcIssuer()}) for this team's subject, and the Site (China vs International) must match the account. (${(e as Error).message})`,
      { roleArn, upstreamCode: aliyunErrorCode(e) },
    )
  }
}
