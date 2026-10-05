import crypto from 'node:crypto'

import { apiUrl } from '../api-endpoint.ts'

import { apiErrorMessage, NUPHOS_LOGIN_URL } from './config.ts'

export type LoginPlan =
  | {
      mode: 'native'
      browserUrl: string
      clientState: string
      handle: string
      codeVerifier: string
    }
  | { mode: 'legacy'; browserUrl: string; clientState: string }

/**
 * Both halves of the native flow are probed rather than assumed, because
 * NUPHOS_API_URL and NUPHOS_LOGIN_URL can point at a self-hosted deployment
 * that has not been updated yet. A failed probe is not an error — it just
 * means the legacy path.
 */
export async function planLogin(port: number): Promise<LoginPlan> {
  const clientState = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://127.0.0.1:${String(port)}/callback`

  const legacy = (): LoginPlan => {
    const url = new URL(NUPHOS_LOGIN_URL)

    url.searchParams.set(
      'state',
      Buffer.from(
        JSON.stringify({ callbackUrl: `http://localhost:${String(port)}/callback`, clientState }),
        'utf8',
      ).toString('base64'),
    )

    return { mode: 'legacy', browserUrl: url.toString(), clientState }
  }

  const startUrl = nativeStartUrl()

  if (!startUrl) return legacy()

  // Probed before registering, so falling back to legacy leaves no orphaned
  // registration sitting on the backend for its whole TTL.
  if (!(await landingPageSupportsNativeStart(startUrl))) {
    console.warn('auth: landing page has no native start endpoint, using the legacy flow')

    return legacy()
  }

  const codeVerifier = crypto.randomBytes(48).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  let handle: string

  try {
    handle = await registerNativeSession({ redirectUri, codeChallenge, clientState })
  } catch (e) {
    console.warn('auth: native sign-in unavailable on this backend, using the legacy flow', e)

    return legacy()
  }

  startUrl.searchParams.set('handle', handle)

  return { mode: 'native', browserUrl: startUrl.toString(), clientState, handle, codeVerifier }
}

function nativeStartUrl(): URL | null {
  try {
    return new URL('/api/google/start', NUPHOS_LOGIN_URL)
  } catch {
    return null
  }
}

/** Hops to follow before giving up; enough for apex→www plus http→https. */
const START_PROBE_MAX_HOPS = 3

/**
 * A GET here is side-effect free — it only mints a redirect — so probing costs
 * nothing. A throwaway handle is used because the endpoint only checks its
 * shape, and the real one has not been registered yet.
 *
 * A 3xx is NOT evidence on its own: a landing page that 301s unknown paths
 * (apex→www, http→https) answers one too, and selecting the native flow against
 * a deployment that has no `/api/google/start` hangs the sign-in until it times
 * out. Only landing on accounts.google.com proves the endpoint is really there.
 */
async function landingPageSupportsNativeStart(startUrl: URL): Promise<boolean> {
  const probeUrl = new URL(startUrl.toString())

  probeUrl.searchParams.set('handle', crypto.randomBytes(32).toString('base64url'))

  let target = probeUrl.toString()

  for (let hop = 0; hop < START_PROBE_MAX_HOPS; hop += 1) {
    let res: Response

    try {
      res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
    } catch {
      return false
    }
    if (res.status < 300 || res.status >= 400) return false

    const location = res.headers.get('location')

    if (!location) return false
    let next: URL

    try {
      next = new URL(location, target)
    } catch {
      return false
    }
    if (next.hostname === 'accounts.google.com') return true
    target = next.toString()
  }

  return false
}

async function registerNativeSession(input: {
  redirectUri: string
  codeChallenge: string
  clientState: string
}): Promise<string> {
  const res = await fetch(`${apiUrl()}/auth/native/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, codeChallengeMethod: 'S256' }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(await apiErrorMessage(res))

  const body = (await res.json().catch(() => null)) as { handle?: unknown } | null

  if (typeof body?.handle !== 'string' || !body.handle) {
    throw new Error('Malformed native session response')
  }

  return body.handle
}
