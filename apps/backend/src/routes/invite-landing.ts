import { Hono } from 'hono'

/*
 * Public landing page behind the "Accept invitation" button in team
 * invitation emails. Invitation emails used to link straight to the website,
 * which stranded users who already had the desktop app installed. This page
 * closes both halves of the flow:
 *
 *  - App installed: the page immediately fires the `nuphos://open` deep link,
 *    so the desktop app comes to the front. The app refreshes pending
 *    invitations on window focus and pops its invitation flow (onboarding
 *    pick screen for new accounts, the takeover modal for signed-in users) —
 *    no invitation token needs to travel through the link; invitations are
 *    keyed to the invitee's email server-side.
 *  - App not installed: the deep link silently no-ops and the visible
 *    download button takes over. After installing and signing in with the
 *    invited address, the invitation is the first thing the app shows.
 *
 * No auth and no invitation id: the page only ever reveals what the sender
 * already put in the email (the team name, passed back as a query param for
 * display), so there is nothing to leak.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const OPEN_APP_URL = 'nuphos://open'
const DOWNLOAD_URL = 'https://nuphos.ai/download'

// Pure builder — no config, no network — so copy and escaping are
// unit-testable (same split as desktop-callback-page / buildInvitationEmail).
export function inviteLandingPage(teamName: string | null): string {
  const team = teamName?.trim() ? escapeHtml(teamName.trim()) : ''
  const heading = team ? `Join <b>${team}</b> on Nuphos` : 'Join your team on Nuphos'

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Team invitation · Nuphos</title>
<link rel="icon" href="https://nuphos.ai/favicon.svg" type="image/svg+xml" />
<style>
  *{box-sizing:border-box}
  body{font-family:Geist,-apple-system,'Segoe UI',Roboto,sans-serif;background:#18181b;color:#fff;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:24px}
  .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:32px;width:400px;max-width:100%;text-align:center}
  h1{font-size:19px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
  p.sub{color:rgba(255,255,255,.65);font-size:13.5px;margin:0 0 20px;line-height:1.6}
  .btn{display:block;width:100%;text-align:center;text-decoration:none;margin-top:18px;padding:10px 12px 11px;border:0;border-radius:6px;background:#7d36ec;box-shadow:inset 0 -2px 0 0 #5621aa;color:#fff;font-size:14px;font-weight:500;font-family:inherit;cursor:pointer}
  .btn:hover{background:#8b46f2}
  .btn.secondary{background:rgba(255,255,255,.1);box-shadow:none;margin-top:10px}
  .btn.secondary:hover{background:rgba(255,255,255,.16)}
</style></head>
<body><div class="card">
  <h1>${heading}</h1>
  <p class="sub">Open the Nuphos desktop app and sign in with the email address this
  invitation was sent to — your invitation will be waiting. Don't have the app yet?
  Download it first.</p>
  <a class="btn" href="${OPEN_APP_URL}">Open Nuphos</a>
  <a class="btn secondary" href="${DOWNLOAD_URL}">Download Nuphos</a>
</div>
<script>location.href = ${JSON.stringify(OPEN_APP_URL)}</script>
</body></html>`
}

export const inviteLandingRoutes = new Hono()

inviteLandingRoutes.get('/', (c) => {
  // Display-only; cap the length so a crafted link can't render a novel.
  const team = (c.req.query('team') ?? '').slice(0, 80)

  return c.html(inviteLandingPage(team || null))
})
