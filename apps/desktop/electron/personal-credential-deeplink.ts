import { parseAtlasError } from '../src/api/errors.ts'

import type {
  PersonalCredential,
  PersonalCredentialDeepLinkPayload,
  PersonalCredentialProvider,
} from '../src/types/team.ts'

type Complete = (
  provider: PersonalCredentialProvider,
  state: string,
  code: string,
) => Promise<PersonalCredential>

// nuphos://personal-credential?provider=…&state=…&code=… (or &error=…). The
// backend only stages the grant; the member who started the flow claims it
// with the one-time code, so the code never leaves the main process.
const PROTOCOL = 'nuphos:'
const HOST = 'personal-credential'

function parse(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl)

    return url.protocol === PROTOCOL && url.hostname === HOST ? url : null
  } catch {
    return null
  }
}

export function isPersonalCredentialUrl(rawUrl: string): boolean {
  return parse(rawUrl) !== null
}

export function personalCredentialProviderOf(rawUrl: string): PersonalCredentialProvider | null {
  const provider = parse(rawUrl)?.searchParams.get('provider')

  return provider === 'github' || provider === 'linear' ? provider : null
}

export async function completePersonalCredentialUrl(
  rawUrl: string,
  complete: Complete,
): Promise<PersonalCredentialDeepLinkPayload | null> {
  const provider = personalCredentialProviderOf(rawUrl)
  const params = parse(rawUrl)?.searchParams

  if (!provider || !params) return null
  const error = params.get('error')
  const state = params.get('state')
  const code = params.get('code')

  if (error) return { provider, error }
  if (!state || !code) return { provider, error: 'missing_code' }
  try {
    const credential = await complete(provider, state, code)

    return { provider, login: credential.login }
  } catch (e) {
    return { provider, error: parseAtlasError(e).code ?? 'complete_failed' }
  }
}
