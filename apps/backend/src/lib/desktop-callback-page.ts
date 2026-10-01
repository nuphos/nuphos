// Connector OAuth callbacks must not end in a bare 302 to the nuphos:// deep
// link: a custom-scheme navigation never commits a document, so the provider's
// authorize page (and its submit spinner) would stay on screen forever. This
// page commits, then fires the same deep link from script.

import type { Context } from 'hono'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function desktopCallbackPage(deepLink: string): string {
  const href = escapeHtml(deepLink)
  const js = JSON.stringify(deepLink).replaceAll('<', '\\u003c')

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Nuphos</title>
<link rel="icon" href="https://nuphos.ai/favicon.svg" type="image/svg+xml" />
<style>
  *{box-sizing:border-box}
  body{font-family:Geist,-apple-system,'Segoe UI',Roboto,sans-serif;background:#18181b;color:#fff;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:24px}
  .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:32px;width:400px;max-width:100%;text-align:center}
  h1{font-size:19px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
  p.sub{color:rgba(255,255,255,.65);font-size:13.5px;margin:0 0 20px;line-height:1.6}
  .btn{display:inline-block;padding:10px 18px;border-radius:6px;background:#7d36ec;box-shadow:inset 0 -2px 0 #5621aa;color:#fff;font-size:14px;font-weight:500;text-decoration:none}
</style></head>
<body><div class="card">
  <h1>Returning to Nuphos&hellip;</h1>
  <p class="sub">You can close this window. If the app didn't open, use the button below.</p>
  <a class="btn" href="${href}">Open Nuphos</a>
</div>
<script>location.href = ${js}</script>
</body></html>`
}

// Build the nuphos://<host> deep link from params and return the landing page
// as the response. Shared by every connector's OAuth /setup callback so the
// escaping boundary and page markup live in exactly one place.
export function desktopCallbackResponse(
  c: Context,
  baseUrl: string,
  params: Record<string, string>,
) {
  const u = new URL(baseUrl)

  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)

  return c.html(desktopCallbackPage(u.toString()))
}
