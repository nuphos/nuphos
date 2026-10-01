import { escapeHtml } from '@/routes/oauth/shared'

import type { AuthorizeParams } from '@/routes/oauth/authorize-validate'

export function consentPage(
  params: AuthorizeParams,
  opts: { clientName: string | null; error?: string },
): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`
  const appName = escapeHtml(opts.clientName || 'An application')
  const errorHtml = opts.error
    ? `<p style="color:#c0392b;margin:0 0 12px">${escapeHtml(opts.error)}</p>`
    : ''

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize · Nuphos</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
  .card{background:#171a21;border:1px solid #262b36;border-radius:12px;padding:28px;width:360px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 4px}
  p.sub{color:#9aa4b2;font-size:13px;margin:0 0 20px}
  label{display:block;font-size:12px;color:#9aa4b2;margin:14px 0 6px}
  input[type=email],input[type=text]{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #2c333f;background:#0f1115;color:#e6e6e6;font-size:14px}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#4f7cff;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  button.secondary{background:#2c333f;margin-top:8px}
  .scope{background:#0f1115;border:1px solid #2c333f;border-radius:8px;padding:8px 10px;font-size:12px;color:#c9d1d9;margin-top:6px}
</style></head>
<body><div class="card">
  <h1>Authorize access</h1>
  <p class="sub"><b>${appName}</b> wants to connect to your Nuphos account.</p>
  ${errorHtml}
  <div class="scope">Scope: <b>${escapeHtml(params.scope)}</b> — talk to the Nuphos Agent on your behalf.</div>
  <form method="post" action="/oauth/authorize">
    ${hidden('response_type', 'code')}
    ${hidden('client_id', params.clientId)}
    ${hidden('redirect_uri', params.redirectUri)}
    ${hidden('state', params.state)}
    ${hidden('scope', params.scope)}
    ${hidden('code_challenge', params.codeChallenge)}
    ${hidden('code_challenge_method', 'S256')}
    ${hidden('resource', params.resource)}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required />
    <button type="button" class="secondary" id="send">Send code</button>
    <label for="code">Verification code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" required />
    <button type="submit">Authorize</button>
  </form>
  <script>
    document.getElementById('send').addEventListener('click', async () => {
      const email = document.getElementById('email').value.trim()
      if (!email) return
      const btn = document.getElementById('send')
      btn.disabled = true; btn.textContent = 'Sending…'
      try {
        const r = await fetch('/oauth/authorize/email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        btn.textContent = r.ok ? 'Code sent ✓' : 'Failed — retry'
      } catch { btn.textContent = 'Failed — retry' }
      finally { setTimeout(() => { btn.disabled = false }, 1500) }
    })
  </script>
</div></body></html>`
}

// Consent page for a browser that already has a valid Nuphos session cookie:
// no OTP, just an Authorize button. The hidden consent_token is the CSRF guard
// — see signConsentToken.
export function oneClickConsentPage(
  params: AuthorizeParams,
  opts: { clientName: string | null; email: string; consentToken: string },
): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`
  const appName = escapeHtml(opts.clientName || 'An application')
  const switchParams = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: params.scope,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    resource: params.resource,
    prompt: 'login',
  })

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize · Nuphos</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
  .card{background:#171a21;border:1px solid #262b36;border-radius:12px;padding:28px;width:360px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 4px}
  p.sub{color:#9aa4b2;font-size:13px;margin:0 0 20px}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#4f7cff;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  .scope{background:#0f1115;border:1px solid #2c333f;border-radius:8px;padding:8px 10px;font-size:12px;color:#c9d1d9;margin-top:6px}
  .who{font-size:13px;color:#c9d1d9;margin:16px 0 0}
  a.switch{display:block;margin-top:12px;font-size:12px;color:#9aa4b2;text-align:center}
</style></head>
<body><div class="card">
  <h1>Authorize access</h1>
  <p class="sub"><b>${appName}</b> wants to connect to your Nuphos account.</p>
  <div class="scope">Scope: <b>${escapeHtml(params.scope)}</b> — talk to the Nuphos Agent on your behalf.</div>
  <p class="who">Signed in as <b>${escapeHtml(opts.email)}</b></p>
  <form method="post" action="/oauth/authorize">
    ${hidden('response_type', 'code')}
    ${hidden('client_id', params.clientId)}
    ${hidden('redirect_uri', params.redirectUri)}
    ${hidden('state', params.state)}
    ${hidden('scope', params.scope)}
    ${hidden('code_challenge', params.codeChallenge)}
    ${hidden('code_challenge_method', 'S256')}
    ${hidden('resource', params.resource)}
    ${hidden('consent_token', opts.consentToken)}
    <button type="submit">Authorize</button>
  </form>
  <a class="switch" href="/oauth/authorize?${switchParams.toString()}">Use a different account</a>
</div></body></html>`
}
