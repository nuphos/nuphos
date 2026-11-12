import crypto from 'node:crypto'

import { apiUrl } from '../api-endpoint.ts'
import { nodeFetch } from '../main/chromium-fetch.ts'

import { apiErrorMessage } from './web.ts'

export type LoginPlan = {
  /** The backend the sign-in runs on, and that issues its token. */
  api: string
  browserUrl: string
  clientState: string
  handle: string
  codeVerifier: string
}

export type SocialProvider = 'google' | 'apple'

/** The providers the backend's social sign-in offers; none on servers without it. */
export async function socialProviders(api: string = apiUrl()): Promise<SocialProvider[]> {
  try {
    const response = await nodeFetch(`${api}/auth/social/login`, {
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

// Register, then open the provider's own start page. A provider the backend does not offer
// fails here, so a self-hosted server never sends anyone to another server's sign-in.
export async function planLogin(port: number, provider: SocialProvider): Promise<LoginPlan> {
  // Read once: the whole sign-in runs on this backend, and its token is saved
  // as this backend's even if the endpoint changes before it finishes.
  const api = apiUrl()
  const clientState = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://127.0.0.1:${String(port)}/callback`

  if (!(await socialProviders(api)).includes(provider)) {
    throw new Error(
      `This server does not offer ${provider === 'apple' ? 'Apple' : 'Google'} sign-in`,
    )
  }

  const codeVerifier = crypto.randomBytes(48).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const handle = await registerNativeSession(api, { redirectUri, codeChallenge, clientState })

  const startUrl = new URL(`${api}/auth/social/${provider}/start`)

  startUrl.searchParams.set('handle', handle)

  return { api, browserUrl: startUrl.toString(), clientState, handle, codeVerifier }
}

async function registerNativeSession(
  api: string,
  input: {
    redirectUri: string
    codeChallenge: string
    clientState: string
  },
): Promise<string> {
  const res = await fetch(`${api}/auth/native/session`, {
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
