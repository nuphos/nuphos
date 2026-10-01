import { config } from '@/config'
import { AppError } from '@/lib/errors'

import {
  awsOidcSubjectForTeam,
  getAwsOidcIssuer,
  isAwsOidcConfigured,
  mintNuphosOidcToken,
} from '../aws-oidc'

// OIDC workload identity federation reuses the shared Nuphos issuer (same signing
// key, JWKS, and per-team subject as the AWS/Tencent/Aliyun/Volcengine connectors).

/** Azure Resource Manager (ARM) base + AKS control-plane API version. */
export const ARM_BASE = 'https://management.azure.com'
export const AKS_API_VERSION = '2024-05-01'
const SUBSCRIPTION_API_VERSION = '2022-12-01'
const ARM_SCOPE = 'https://management.azure.com/.default'

export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default'
export const ROLE_ASSIGNMENT_API_VERSION = '2022-04-01'
export const AUTH_PERMISSIONS_API_VERSION = '2022-04-01'
const TOKEN_READ_TIMEOUT_MS = 20_000

export const ARM_READ_TIMEOUT_MS = 30_000
export const GRAPH_READ_TIMEOUT_MS = 20_000

/** GUID shape shared by tenant / client / subscription ids. */
export const AZURE_GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * A short-lived Azure ARM access token, obtained via OIDC workload identity
 * federation: Nuphos mints a per-team token and exchanges it at the Entra token
 * endpoint (grant_type=client_credentials + client_assertion) for a bearer token
 * scoped to `management.azure.com`. `subscriptionId` pins which subscription's
 * resources the token is used against.
 */
export type AzureHandle = {
  accessToken: string
  subscriptionId: string
  expiresAt: Date
}

/** The identifying triple stored on a binding — everything needed to mint a handle. */
export type AzureIdentity = {
  tenantId: string
  clientId: string
  subscriptionId: string
}

/**
 * Whether the Nuphos OIDC issuer is configured (shared with the AWS connector —
 * one Nuphos IdP). Without a signing key we cannot mint the client assertion, so
 * the Entra token exchange would have nothing to present.
 */
export function azureOidcConfigured(): boolean {
  return isAwsOidcConfigured()
}

/**
 * The values a customer needs to add a federated credential to their Entra ID app
 * registration: the issuer URL, this team's subject claim, and the audience. Azure
 * fetches the issuer's JWKS from `<issuer>/.well-known/openid-configuration`, so —
 * unlike Tencent — no public key needs to be pasted.
 */
export function azureOidcInfo(teamId: string): {
  configured: boolean
  issuer: string
  subject: string
  audience: string
} {
  return {
    configured: azureOidcConfigured(),
    issuer: getAwsOidcIssuer(),
    subject: awsOidcSubjectForTeam(teamId),
    audience: config.byos.azure.oidc.audience,
  }
}

/**
 * Exchange a per-team Nuphos OIDC token for a short-lived Azure ARM access token.
 * Mirrors AssumeRoleWithWebIdentity on the STS clouds: the token is the
 * credential (client_assertion), no client secret is stored. Entra validates the
 * assertion against the app's federated credential (issuer + subject + audience)
 * before issuing the bearer.
 */
export async function assumeAzureViaOidc(
  identity: AzureIdentity,
  teamId: string,
  scope: string = ARM_SCOPE,
): Promise<AzureHandle> {
  if (!azureOidcConfigured()) {
    throw new AppError(
      503,
      'azure_connector_unavailable',
      'The Nuphos OIDC signing key (AWS_BYOS_OIDC_PRIVATE_KEY) is not configured, so Azure tokens cannot be minted.',
    )
  }
  const assertion = mintNuphosOidcToken(teamId, config.byos.azure.oidc.audience)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: identity.clientId,
    scope,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  })
  let resp: {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  try {
    const r = await fetch(
      `https://login.microsoftonline.com/${identity.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TOKEN_READ_TIMEOUT_MS),
      },
    )

    resp = (await r.json()) as typeof resp
  } catch (e) {
    throw new AppError(
      502,
      'azure_assume_failed',
      `Entra token exchange request failed for app ${identity.clientId}: ${(e as Error).message}`,
    )
  }
  if (!resp.access_token) {
    // Entra returns errors in-band. Surface an AppError so member routes get a
    // client-actionable response instead of a generic 500.
    throw new AppError(
      502,
      'azure_assume_failed',
      resp.error_description ??
        `Entra token exchange returned no access token for app ${identity.clientId}`,
      { clientId: identity.clientId, upstreamCode: resp.error },
    )
  }
  const ttlSec = typeof resp.expires_in === 'number' ? resp.expires_in : 3600

  return {
    accessToken: resp.access_token,
    subscriptionId: identity.subscriptionId,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
  }
}

/** Authenticated ARM GET/POST returning parsed JSON, with in-band error mapping. */
export async function armRequest<T>(
  handle: AzureHandle,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; apiVersion: string; body?: unknown } = {
    apiVersion: AKS_API_VERSION,
  },
): Promise<T> {
  const url = `${ARM_BASE}${path}${path.includes('?') ? '&' : '?'}api-version=${opts.apiVersion}`
  const r = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${handle.accessToken}`, 'Content-Type': 'application/json' },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(ARM_READ_TIMEOUT_MS),
  })
  const text = await r.text()
  const json = text ? (JSON.parse(text) as unknown) : {}

  if (!r.ok) {
    const err = (json as { error?: { code?: string; message?: string } }).error

    if (r.status === 401 || r.status === 403) {
      throw new AppError(
        403,
        'azure_permission_denied',
        err?.message ??
          `Azure denied access (${String(r.status)}) for ${path}. Check the app's RBAC role assignment on the subscription.`,
        { provider: 'azure', operation: path, upstreamCode: err?.code },
      )
    }
    throw new AppError(
      502,
      'azure_arm_error',
      err?.message ?? `Azure ARM request failed (${String(r.status)}) for ${path}`,
      { provider: 'azure', operation: path, upstreamCode: err?.code },
    )
  }

  return json as T
}

/**
 * Verify the binding is usable before storing it: exchange for a token (proves
 * the federated-credential trust) and read the subscription (proves the app has
 * at least Reader RBAC on it), so the connect dialog fails fast on a
 * misconfigured trust or a missing role assignment.
 */
export async function verifyAzureBinding(identity: AzureIdentity, teamId: string): Promise<void> {
  let handle: AzureHandle

  try {
    handle = await assumeAzureViaOidc(identity, teamId)
  } catch (e) {
    // The connector-unconfigured 503 is a deploy problem, not a bad federation —
    // pass it through. Everything else becomes the actionable bind hint.
    if (e instanceof AppError && e.code === 'azure_connector_unavailable') throw e
    throw new AppError(
      400,
      'azure_binding_not_assumable',
      `Nuphos cannot obtain an Azure token for app ${identity.clientId}. Check the app registration's federated credential: it must trust the Nuphos issuer (${getAwsOidcIssuer()}) with subject ${awsOidcSubjectForTeam(teamId)} and audience ${config.byos.azure.oidc.audience}. (${(e as Error).message})`,
      { clientId: identity.clientId },
    )
  }
  try {
    await armRequest(handle, `/subscriptions/${identity.subscriptionId}`, {
      apiVersion: SUBSCRIPTION_API_VERSION,
    })
  } catch (e) {
    if (e instanceof AppError && e.code === 'azure_permission_denied') {
      throw new AppError(
        400,
        'azure_binding_not_assumable',
        `The Azure app can authenticate but cannot read subscription ${identity.subscriptionId}. Assign it an RBAC role (at least Reader) on the subscription, then retry.`,
        { clientId: identity.clientId, subscriptionId: identity.subscriptionId },
      )
    }
    throw e
  }
}
