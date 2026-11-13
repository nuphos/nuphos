import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { authenticateToken } from '@/lib/identity/auth'
import { decideDeviceLogin, findPendingDeviceLogin } from '@/lib/identity/device-login'
import { providerSettings, SOCIAL_PROVIDERS } from '@/lib/identity/social'

import type { SocialProvider } from '@/lib/identity/social'
import type { Context } from 'hono'

/** Where `nuphos login` sends people on a server that is not nuphos.ai. */
export const DEVICE_PAGE_PATH = '/auth/social/device'

const STYLE =
  'body{font:17px system-ui;max-width:400px;margin:12vh auto;padding:24px}a,button,input{display:block;box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border:1px solid;border-radius:8px;font:inherit;color:inherit;background:none;text-decoration:none;text-align:center}code{font-size:20px;letter-spacing:2px}.muted{opacity:.7;font-size:15px}'

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${String(ch.charCodeAt(0))};`)
}

function page(body: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Approve sign-in</title><style>${STYLE}</style><h1>Approve a sign-in</h1>${body}</html>`
}

export function providerName(provider: SocialProvider) {
  if (provider === 'oidc') return config.auth.oidc.name

  return provider === 'google' ? 'Google' : 'Apple'
}

async function signedInUser(c: Context) {
  const token = getCookie(c, '__Host-nuphos-social')

  return token ? ((await authenticateToken(token))?.user ?? null) : null
}

async function signInLinks(next: string, switching = false) {
  const offered = await Promise.all(
    SOCIAL_PROVIDERS.map((p) =>
      providerSettings(p).then(
        () => p,
        () => null,
      ),
    ),
  )

  return offered
    .filter((p): p is SocialProvider => p !== null)
    .map((p) =>
      switching
        ? `<a href="${p}/start?prompt=login&amp;next=${encodeURIComponent(next)}">Use another ${escapeHtml(providerName(p))} account</a>`
        : `<a href="${p}/start?next=${encodeURIComponent(next)}">Continue with ${escapeHtml(providerName(p))}</a>`,
    )
    .join('')
}

/** Only a return to this page survives sign-in, so the parameter cannot redirect anywhere else. */
export function safeNext(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 200) return undefined
  const url = new URL(raw, 'http://local')

  if (url.origin !== 'http://local' || url.pathname !== DEVICE_PAGE_PATH) return undefined

  return url.pathname + url.search
}

// Cloudflare's Email Obfuscation would swap the address for a script this page's CSP blocks.
const showEmail = (email: string) => `<!--email_off-->${escapeHtml(email)}<!--/email_off-->`

export const deviceApproval = new Hono()

deviceApproval.get('/', async (c) => {
  const code = c.req.query('code')?.trim() ?? ''
  const user = await signedInUser(c)
  const next = code ? `${DEVICE_PAGE_PATH}?code=${encodeURIComponent(code)}` : DEVICE_PAGE_PATH

  if (!user) {
    const links = await signInLinks(next)

    if (!links) throw new AppError(503, 'provider_unavailable', 'Social sign-in is not configured')

    return c.html(page(`<p>Sign in first, then enter the code your terminal shows.</p>${links}`))
  }
  const pending = code ? await findPendingDeviceLogin(code) : null
  const signedInAs = `<p class="muted">Signed in as ${showEmail(user.email)}</p>`
  const switchLinks = await signInLinks(next, true)

  if (!pending) {
    return c.html(
      page(
        `${signedInAs}${code ? '<p>That code is wrong or has expired.</p>' : ''}<form method="get"><input name="code" placeholder="ABCD-EFGH" autocomplete="off" autofocus required><button>Continue</button></form>${switchLinks}`,
      ),
    )
  }
  const from = pending.requesterIp ? ` from ${escapeHtml(pending.requesterIp)}` : ''

  return c.html(
    page(
      `<p><b>${escapeHtml(pending.clientName)}</b>${from} wants to sign in to Nuphos as <b>${showEmail(user.email)}</b>.</p><p>Code <code>${escapeHtml(code.toUpperCase())}</code></p><p class="muted">Approve only a code you started yourself.</p><form method="post"><input type="hidden" name="code" value="${escapeHtml(code)}"><button name="decision" value="approve">Approve</button><button name="decision" value="deny">Deny</button></form>${switchLinks}`,
    ),
  )
})

deviceApproval.post('/', async (c) => {
  // The session cookie is SameSite=Lax, so a cross-site form never carries it; Sec-Fetch-Site
  // also refuses a same-site page on another host. Not Origin: under this route's
  // `Referrer-Policy: no-referrer` browsers send `Origin: null` even from this page.
  const site = c.req.header('sec-fetch-site')

  if (site && site !== 'same-origin')
    throw new AppError(403, 'forbidden', 'Approve from this page only')
  const user = await signedInUser(c)

  if (!user) throw new AppError(401, 'unauthorized', 'Sign in first')
  const form = await c.req.parseBody()
  const deny = form.decision === 'deny'

  await decideDeviceLogin(form.code, user, { decision: deny ? 'deny' : 'personal' })

  return c.html(
    page(
      deny
        ? '<p>Denied. The terminal will not be signed in.</p>'
        : '<p>Approved. Return to your terminal.</p>',
    ),
  )
})
