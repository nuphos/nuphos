#!/usr/bin/env bun
// Register / inspect / delete the xtrace memory-learning webhook endpoint.
//
// xtrace stores ONE webhook URL per org. Registering returns a `secret` that is
// shown ONCE — store it as XTRACE_WEBHOOK_SECRET so the `/webhooks/xtrace`
// handler can verify the `X-Webhook-Signature` HMAC. See
// https://docs.xtrace.ai/guides/webhooks and src/routes/xtrace-webhook.ts.
//
// Registering the SAME url again does NOT return the full secret — xtrace keeps
// the existing one and returns it masked (`whsec_••••66b0`). Pass --rotate to
// mint a fresh secret (`?rotate_secret=true`); that is the only way, besides the
// very first registration, to get the full value back.
//
// Usage:
//   bun scripts/xtrace-webhook.ts register --url https://api.example.com/webhooks/xtrace
//   bun scripts/xtrace-webhook.ts register --url https://... --rotate
//   bun scripts/xtrace-webhook.ts get
//   bun scripts/xtrace-webhook.ts delete
//
// Required env (auto-loaded from .env):
//   XTRACE_API_KEY
//   XTRACE_ORG_ID
// Optional:
//   XTRACE_BASE_URL   (default: https://api.production.xtrace.ai)

const DEFAULT_BASE_URL = 'https://api.production.xtrace.ai'

type Command = 'register' | 'get' | 'delete'

type Args = {
  command: Command
  url?: string
  rotate: boolean
  json: boolean
}

function usage(code = 1): never {
  console.error(`usage:
  bun scripts/xtrace-webhook.ts register --url <https-endpoint> [--rotate]
  bun scripts/xtrace-webhook.ts get
  bun scripts/xtrace-webhook.ts delete

options:
  --url <url>   endpoint to register (register only; must be https)
  --rotate      mint a fresh secret (register only); required to get the full
                secret back when re-registering an already-known url
  --json        print the raw API response

required env:
  XTRACE_API_KEY
  XTRACE_ORG_ID

optional env:
  XTRACE_BASE_URL   (default: ${DEFAULT_BASE_URL})`)
  process.exit(code)
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const command = argv[0] as Command | undefined

  if (command !== 'register' && command !== 'get' && command !== 'delete') usage()

  const out: Args = { command, rotate: false, json: false }

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]

    if (a === '--url') out.url = argv[++i]
    else if (a === '--rotate') out.rotate = true
    else if (a === '--json') out.json = true
    else if (a === '-h' || a === '--help') usage(0)
    else usage()
  }
  if (out.rotate && command !== 'register') usage()

  if (command === 'register') {
    if (!out.url) usage()
    let parsed: URL

    try {
      parsed = new URL(out.url)
    } catch {
      console.error(`Invalid --url: ${out.url}`)
      process.exit(1)
    }
    if (parsed.protocol !== 'https:') {
      console.error(`--url must be https (got ${parsed.protocol})`)
      process.exit(1)
    }
  }

  return out
}

async function xtraceRequest(
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const apiKey = process.env.XTRACE_API_KEY
  const orgId = process.env.XTRACE_ORG_ID

  if (!apiKey) throw new Error('XTRACE_API_KEY is not set')
  if (!orgId) throw new Error('XTRACE_ORG_ID is not set')

  const baseUrl = process.env.XTRACE_BASE_URL ?? DEFAULT_BASE_URL
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'X-Org-Id': orgId,
    Accept: 'application/json',
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(new URL(path, baseUrl).toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown

  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`xtrace ${method} ${path} -> ${res.status}: ${text || '(empty body)'}`)
  }

  return { status: res.status, json: parsed }
}

async function main(): Promise<void> {
  const args = parseArgs()

  if (args.command === 'get') {
    const { json } = await xtraceRequest('GET', '/v1/webhooks')

    if (args.json) return console.log(JSON.stringify(json, null, 2))
    const url = (json as { url?: string })?.url

    console.log(url ? `Registered webhook: ${url}` : 'No webhook registered.')
    console.log('(the secret is masked on GET — it is only returned once, at register time)')

    return
  }

  if (args.command === 'delete') {
    await xtraceRequest('DELETE', '/v1/webhooks')
    console.log('Webhook deleted.')

    return
  }

  // register
  const path = args.rotate ? '/v1/webhooks?rotate_secret=true' : '/v1/webhooks'
  const { json } = await xtraceRequest('PUT', path, { url: args.url })

  if (args.json) return console.log(JSON.stringify(json, null, 2))

  const secret = (json as { secret?: string })?.secret

  console.log(`Registered webhook: ${args.url}`)
  if (secret && isMaskedSecret(secret)) {
    // xtrace preserved an existing secret and returned it masked. Printing it
    // as XTRACE_WEBHOOK_SECRET would make every real delivery fail signature
    // verification, so refuse and point at --rotate.
    console.log(`\nxtrace returned a masked secret (${secret}) — the full value was NOT re-issued.`)
    console.log(
      'Reuse the secret you saved at first registration, or re-run with --rotate to mint a fresh one\n' +
        '(this invalidates the previous secret).',
    )
  } else if (secret) {
    console.log('\nSecret (shown ONCE — store it now):\n')
    console.log(`  XTRACE_WEBHOOK_SECRET=${secret}`)
    console.log(
      '\nSet this in the backend environment; the /webhooks/xtrace handler needs it to verify signatures.',
    )
  } else {
    console.log(
      '\nNo secret in the response. If this url was already registered, re-run with --rotate to mint a fresh secret.',
    )
  }
}

// Masked secrets come back as `whsec_••••66b0` (prefix + bullets + last 4).
// Any bullet/asterisk/ellipsis marks a redacted value we must not treat as real.
function isMaskedSecret(secret: string): boolean {
  return /[•*]|\.{3}|…/.test(secret)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
