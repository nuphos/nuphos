import { Hono } from 'hono'

import { sendDownloadLinkEmail } from '@/lib/download-link-email'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'

export const desktopRoutes = new Hono<{ Variables: AuthVariables }>()

// Emails the signed-in user the desktop download links. The landing page's
// /download flow calls this for visitors on devices that can't run the
// desktop app (phones, tablets); the address always comes from the session,
// never from the request, so the email can only go to the account that
// authenticated.
desktopRoutes.post('/download-email', requireAuth, async (c) => {
  const email = c.get('userEmail')

  await sendDownloadLinkEmail(email)

  return c.json({ ok: true, email })
})
