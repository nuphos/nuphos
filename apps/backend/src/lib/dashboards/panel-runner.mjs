// Dashboards panel runner harness.
//
// Runs on the team's agent runtime (the `panel` job), NOT in the backend
// process. The job writes this file plus the panel's script.mjs + params.json
// into a run directory, then invokes: `node runner.mjs <runDir>`. The harness
// injects the script's globals, imports the script, and prints exactly one
// sentinel line to stdout carrying the JSON output, which the backend validates
// against panelOutputSchema (panel-output.ts).
//
// Panel code can read NUPHOS_TOKEN directly. That token is a short-lived
// dashboard panel token: bound to this team and the script's author, GET-only, and
// limited to the credentials selected in the panel's settings. The backend
// enforces those limits; the checks in `request` below only keep the built-in
// client from sending the token anywhere else.
//
// Sentinels must stay in sync with panel-output.ts.

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const SENTINEL = '__PANEL_OUTPUT__'
const ERROR_SENTINEL = '__PANEL_ERROR__'
const MAX_ERROR_CHARS = 4_000

/** Build a bounded diagnostic from the runner-caught exception. User-written
 * stderr remains untrusted and is still discarded by the backend; only this
 * harness-authored envelope crosses the process boundary. */
function safeDiagnostic(error) {
  let text = String(error && error.stack ? error.stack : error)

  // Redact explicit credential-bearing environment values first. This covers
  // the panel token as well as provider credentials a script may mention in
  // an exception. Ignore very short values to avoid destroying normal prose.
  for (const [name, value] of Object.entries(process.env)) {
    if (!/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(name)) continue
    if (!value || value.length < 4) continue
    text = text.split(value).join('[REDACTED]')
  }

  // Defense in depth for common credential shapes not sourced from env.
  text = text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|api_key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?(?:key|token)|secret(?:[_-]?(?:access[_-]?key|key))?|token|password|credential)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')

  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}\n… truncated` : text
}

function fail(error) {
  const diagnostic = safeDiagnostic(error)

  // stdout is capped by the runtime job. stderr is intentionally left for
  // interactive runner debugging only and is discarded by production exec.
  process.stdout.write(ERROR_SENTINEL + JSON.stringify({ message: diagnostic }) + '\n')
  process.stderr.write(diagnostic + '\n')
  process.exit(1)
}

const runDir = process.argv[2]
if (!runDir) fail('panel-runner: missing run directory argument')

const backendUrl = (process.env.NUPHOS_BACKEND_URL || '').replace(/\/$/, '')
const token = process.env.NUPHOS_TOKEN || ''

// Thin, GET-only Nuphos client restricted to this dashboard's team and the
// configured backend origin. Selected credentials stay reachable so panels can
// query provider read APIs when Nuphos has no equivalent endpoint.
async function request(path) {
  if (!backendUrl) throw new Error('NUPHOS_BACKEND_URL is not set for the panel job')
  let url
  if (/^https?:\/\//i.test(path)) {
    // Absolute URLs may only target the configured backend origin, so this
    // client won't forward the bearer token to an arbitrary host. The `+ '/'`
    // boundary rejects look-alikes like `<backend>.evil.com`.
    if (path !== backendUrl && !path.startsWith(`${backendUrl}/`)) {
      throw new Error('nuphos client may only call the Nuphos backend origin')
    }
    url = path
  } else {
    url = `${backendUrl}${path.startsWith('/') ? '' : '/'}${path}`
  }
  const parsedUrl = new URL(url)
  const teamId = globalThis.params?.teamId
  if (!teamId || !parsedUrl.pathname.startsWith(`/teams/${encodeURIComponent(teamId)}/`)) {
    throw new Error('nuphos client may only call routes for this dashboard team')
  }
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  const text = await res.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) {
    const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    throw new Error(`nuphos GET ${path} failed: ${res.status} ${detail}`)
  }
  return parsed
}

const nuphos = {
  get: (path) => request(path),
}

async function main() {
  const params = JSON.parse(await readFile(join(runDir, 'params.json'), 'utf8'))

  let captured
  let emitted = false
  const emit = (payload) => {
    captured = payload
    emitted = true
  }

  globalThis.params = params
  globalThis.nuphos = nuphos
  globalThis.emit = emit

  const scriptUrl = pathToFileURL(resolve(runDir, 'script.mjs')).href
  const mod = await import(scriptUrl)

  // Precedence: an explicit emit() wins; otherwise a default export (called if
  // it's a function). This lets a script be written either imperatively
  // (emit(...)) or declaratively (export default ...).
  let output = emitted ? captured : mod?.default
  if (typeof output === 'function') output = await output(params)
  output = await output

  if (output === undefined || output === null) {
    throw new Error(
      'panel script produced no output — call emit(payload) or export default a payload',
    )
  }

  process.stdout.write(SENTINEL + JSON.stringify(output) + '\n')
}

main().catch(fail)
