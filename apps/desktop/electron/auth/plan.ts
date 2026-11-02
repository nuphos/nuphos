import crypto from 'node:crypto'

import { apiUrl } from '../api-endpoint.ts'
import { nodeFetch } from '../main/chromium-fetch.ts'

import { apiErrorMessage, NUPHOS_LOGIN_URL } from './web.ts'

export type LoginPlan =
  | {
      mode: 'native'
      browserUrl: string
      clientState: string
      handle: string
      codeVerifier: string
    }
  | { mode: 'legacy'; browserUrl: string; clientState: string }

export type SocialProvider = 'google' | 'apple'

/** The providers the backend's social sign-in offers; none on servers without it. */
export async function socialProviders(): Promise<SocialProvider[]> {
  try {
    const response = await nodeFetch(`${apiUrl()}/auth/social/login`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    })

    if (!response.ok) return []

    return (response.headers.get('X-Nuphos-Social-Providers') ?? '')
      .split(',')
      .filter((p): p is SocialProvider => p === 'google' || p === 'apple')
  } catch {
    return []
  }
}

// Register, then open the provider's own start page. Servers without social sign-in fall back
// to the landing page, which only offers Google.
export async function planLogin(port: number, provider: SocialProvider): Promise<LoginPlan> {
  const clientState = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://127.0.0.1:${String(port)}/callback`

  const legacy = (): LoginPlan => {
    if (provider !== 'google') throw new Error('This server does not offer Apple sign-in')
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

  if (!(await socialProviders()).includes(provider)) return legacy()

  const codeVerifier = crypto.randomBytes(48).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  let handle: string

  try {
    handle = await registerNativeSession({ redirectUri, codeChallenge, clientState })
  } catch (e) {
    console.warn('auth: native sign-in unavailable on this backend, using the legacy flow', e)

    return legacy()
  }

  const startUrl = new URL(`${apiUrl()}/auth/social/${provider}/start`)

  startUrl.searchParams.set('handle', handle)

  return { mode: 'native', browserUrl: startUrl.toString(), clientState, handle, codeVerifier }
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
