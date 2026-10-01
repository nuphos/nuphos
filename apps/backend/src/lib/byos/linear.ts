import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { LINEAR_GRAPHQL_URL, LinearApiError, linearFetch, USER_AGENT } from '@/lib/byos/linear-http'

export { LinearApiError, LinearOAuthNotConfigured } from '@/lib/byos/linear-http'
export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  parseTokenResponse,
} from '@/lib/byos/linear-oauth'
export type { AuthorizeUrlInput, ExchangedTokens } from '@/lib/byos/linear-oauth'
export {
  getAccessToken,
  getAccessTokenWithExpiry,
  getDefaultClientCredentials,
  invalidateAccessToken,
  LinearReconnectRequired,
  withLinearAccessToken,
} from '@/lib/byos/linear-tokens'

export function getSetupRedirect(): string | null {
  return config.byos.linear.setupRedirect ?? null
}

export function isLinearConfigured(): boolean {
  // All three must be set: without the encryption key, /linear-app/setup
  // throws mid-handler in encryptLinearSecret and the desktop install promise
  // waits out its full timeout instead of redirecting back into the app.
  return Boolean(
    config.byos.linear.clientId &&
    config.byos.linear.clientSecret &&
    config.byos.linear.setupRedirect &&
    config.byos.linear.encryptionKey,
  )
}

// ── GraphQL ──

export async function linearGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await linearFetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  const payload = (await res.json().catch(() => null)) as {
    data?: T
    errors?: { message?: string }[]
  } | null

  if (!res.ok) {
    const detail = payload?.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join('; ')

    throw new LinearApiError(
      res.status,
      `Linear GraphQL failed: ${String(res.status)} ${detail ?? ''}`.trim(),
    )
  }
  if (payload?.errors?.length) {
    throw new LinearApiError(
      400,
      `Linear GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`,
    )
  }
  if (payload?.data === undefined) {
    throw new LinearApiError(502, 'Linear GraphQL returned an empty response')
  }

  return payload.data
}

export type LinearViewerInfo = {
  user: { id: string; name: string | null }
  organization: { id: string; name: string; urlKey: string | null }
}

// Identifies the authorising user + their organization (workspace) so the bind
// route can label the binding and store the workspace id.
export async function getViewer(accessToken: string): Promise<LinearViewerInfo> {
  const data = await linearGraphql<{
    viewer: { id: string; name: string | null } | null
    organization: { id: string; name: string; urlKey: string | null } | null
  }>(
    accessToken,
    `query NuphosViewer {
      viewer { id name }
      organization { id name urlKey }
    }`,
  )

  if (!data.viewer || !data.organization) {
    throw new LinearApiError(502, 'Linear viewer/organization query returned no data')
  }

  return {
    user: data.viewer,
    organization: data.organization,
  }
}

// ── Webhook signature ──
//
// Linear signs webhook deliveries with an HMAC-SHA256 of the raw request body,
// keyed by the app's webhook signing secret, sent hex-encoded in the
// `Linear-Signature` header. timingSafeEqual avoids leaking via comparison time.
export function verifyWebhookSignature(
  rawBody: Uint8Array,
  header: string | null | undefined,
): boolean {
  const secret = config.byos.linear.webhookSecret

  if (!secret) return false
  if (!header) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = Buffer.from(header)
  const expectedBuf = Buffer.from(expected)

  if (provided.length !== expectedBuf.length) return false

  return timingSafeEqual(provided, expectedBuf)
}
