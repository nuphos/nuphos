export const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Logged in</title>
  <style>
    html,body{margin:0;padding:0;height:100%;background:#0f0e11;color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px}
    .check{width:48px;height:48px;border-radius:50%;background:rgb(34,209,128);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;font-weight:600}
    .title{font-size:18px;font-weight:600}
    .sub{font-size:13.5px;color:rgba(255,255,255,.6)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="check">✓</div>
    <div class="title">You're logged in</div>
    <div class="sub">You can close this tab and return to Nuphos.</div>
  </div>
</body>
</html>`

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }

  return value.replace(/[&<>"']/g, (char) => entities[char])
}

export function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sign-in failed</title>
  <style>
    html,body{margin:0;padding:0;height:100%;background:#0f0e11;color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
    .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:0 24px;text-align:center}
    .mark{width:48px;height:48px;border-radius:50%;background:rgb(232,72,85);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;font-weight:600}
    .title{font-size:18px;font-weight:600}
    .sub{font-size:13.5px;color:rgba(255,255,255,.6);max-width:34rem}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="mark">!</div>
    <div class="title">Sign-in failed</div>
    <div class="sub">${escapeHtml(message)}</div>
    <div class="sub">You can close this tab and try again from Nuphos.</div>
  </div>
</body>
</html>`
}

/**
 * Copy for the failure codes the landing page delivers (RFC 6749 §4.1.2.1).
 * Unknown codes fall through to the code itself, which is also the legacy
 * shape: shipped builds are sent a human sentence in `error` and no
 * `error_description`.
 */
const CALLBACK_ERROR_COPY: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  invalid_request: 'Sign-in did not complete. Please try again.',
  server_error: 'Nuphos could not complete the sign-in. Please try again.',
  temporarily_unavailable: 'Nuphos took too long to answer. Please try again.',
}

/** Anything on this machine can reach the listener, so treat both fields as untrusted text. */
export function describeCallbackFailure(params: URLSearchParams): string {
  const code = params.get('error') ?? ''
  const raw = params.get('error_description') ?? CALLBACK_ERROR_COPY[code] ?? code

  return raw.trim().slice(0, 300) || 'Sign-in failed'
}
