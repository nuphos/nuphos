import { authSession } from '../auth-session.ts'

import { readConfig } from './config.ts'
import { apiErrorMessage } from './web.ts'

/** The AI data sharing notice this build shows; bump with the text and the backend's list. */
export const AI_CONSENT_VERSION = '2026-11-23'

export type AIConsent = { version: string; accepted: boolean }

/** Whether the account agreed to the notice this build shows. */
export function readAIConsent(): Promise<AIConsent> {
  return consentRequest({ method: 'GET' })
}

export function saveAIConsent(accepted: boolean): Promise<AIConsent> {
  return consentRequest({
    method: 'PUT',
    body: JSON.stringify({ version: AI_CONSENT_VERSION, accepted }),
  })
}

async function consentRequest(init: { method: string; body?: string }): Promise<AIConsent> {
  const start = authSession.context()
  const read = await readConfig()
  const api = read.api ?? start.api

  if (!read.token) throw new Error('Please sign in again')
  const res = await fetch(`${api}/auth/ai-consent`, {
    ...init,
    headers: {
      authorization: `Bearer ${read.token}`,
      'content-type': 'application/json',
      // GET answers for the notice this build shows.
      'x-nuphos-ai-consent-version': AI_CONSENT_VERSION,
    },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(await apiErrorMessage(res))
  const body = (await res.json()) as Partial<AIConsent>

  if (typeof body.version !== 'string' || typeof body.accepted !== 'boolean')
    throw new Error('Malformed AI consent response')

  return {
    version: body.version,
    accepted: body.accepted && body.version === AI_CONSENT_VERSION,
  }
}
