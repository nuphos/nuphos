import { MCP_SCOPE } from '@/lib/oauth/metadata'
import { getClient } from '@/lib/oauth/store'
import { resourceUrl } from '@/routes/oauth/shared'

// ─── Authorize: validation shared by GET (render) and POST (complete) ───────

export type AuthorizeParams = {
  clientId: string
  redirectUri: string
  state: string
  scope: string
  codeChallenge: string
  resource: string
}

type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams }
  // `safe` = false means we must NOT redirect (bad client / redirect_uri), so the
  // error is shown on our own page instead of bounced to an unverified URL.
  | { ok: false; safe: boolean; error: string; description: string }

export async function validateAuthorize(input: {
  responseType: string
  clientId: string
  redirectUri: string
  state: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: string
  resource: string
}): Promise<AuthorizeValidation> {
  if (!input.clientId) {
    return { ok: false, safe: false, error: 'invalid_request', description: 'Missing client_id' }
  }
  const client = await getClient(input.clientId)

  if (!client) {
    return { ok: false, safe: false, error: 'invalid_client', description: 'Unknown client_id' }
  }
  // Exact-match the redirect against what was registered — the single most
  // important check for preventing open-redirect / code exfiltration.
  if (!input.redirectUri || !client.redirectUris.includes(input.redirectUri)) {
    return {
      ok: false,
      safe: false,
      error: 'invalid_request',
      description: 'redirect_uri does not match a registered value',
    }
  }
  // From here, errors are "safe" to bounce back to the (validated) redirect_uri.
  if (input.responseType !== 'code') {
    return {
      ok: false,
      safe: true,
      error: 'unsupported_response_type',
      description: 'Only response_type=code is supported',
    }
  }
  if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
    return {
      ok: false,
      safe: true,
      error: 'invalid_request',
      description: 'PKCE with code_challenge_method=S256 is required',
    }
  }
  const scope = input.scope.trim() || MCP_SCOPE

  if (scope.split(/\s+/).some((s) => s !== MCP_SCOPE)) {
    return {
      ok: false,
      safe: true,
      error: 'invalid_scope',
      description: `Only the "${MCP_SCOPE}" scope is supported`,
    }
  }
  if (input.resource && input.resource !== resourceUrl()) {
    return {
      ok: false,
      safe: true,
      error: 'invalid_target',
      description: 'Unknown resource indicator',
    }
  }

  return {
    ok: true,
    params: {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      scope,
      codeChallenge: input.codeChallenge,
      resource: resourceUrl(),
    },
  }
}

export function redirectBackWithError(
  redirectUri: string,
  state: string,
  error: string,
  description: string,
): string {
  const url = new URL(redirectUri)

  url.searchParams.set('error', error)
  if (description) url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)

  return url.toString()
}
