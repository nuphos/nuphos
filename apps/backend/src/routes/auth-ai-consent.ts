import { Hono } from 'hono'

import { readAIConsent, saveAIConsent, shownConsentVersion } from '@/lib/identity/ai-consent'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'

export const authAIConsent = new Hono<{ Variables: AuthVariables }>()

// Answers for the notice the client shows; clients that send no known version get AI_CONSENT_VERSION.
authAIConsent.get('/', requireAuth, async (c) =>
  c.json(
    await readAIConsent(
      c.get('userId'),
      shownConsentVersion(c.req.header('x-nuphos-ai-consent-version')),
    ),
  ),
)

authAIConsent.put('/', requireAuth, async (c) =>
  c.json(await saveAIConsent(c.get('userId'), await c.req.json().catch(() => null))),
)
