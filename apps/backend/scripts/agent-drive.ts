// Drive the Agent from the terminal — one turn, against a running backend, no
// desktop app. Prints the tool trace so you can see what the agent actually
// ran, and can assert on it, which is what makes this a test rather than a
// demo.
//
//   bun scripts/agent-drive.ts --user you@zeabur.com \
//     --message "list the pods in kube-system on the prod cluster" \
//     --creds k8s \
//     --forbid 'setup-cluster|get-credentials|setup-credentials' \
//     --require '\-\-context'
//
// --require / --forbid are regexes matched against `<toolName> <toolInput>` for
// every tool call in the turn. Repeatable.
//
// Auth: mints a short-lived session token for --user with the backend's own
// signing key, so it needs the same env the backend runs with (run it from
// apps/backend, where .env is picked up). It never reads a token from a
// browser or the desktop app.
//
// Exit codes: 0 = turn finished and every assertion held, 1 = assertion failed
// or the stream errored, 2 = the turn paused (approval, budget, watchdog) —
// reported with its reason rather than silently passing.
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { connectDb, db } from '@/lib/db'
import { signNuphosToken, getMyTeams } from '@/lib/identity'

import { consume, fail, parseArgs, resolveCredentialAccess } from './agent-drive-lib'

/**
 * `bun run dev` runs the backend on 3718 (aligned with the named tunnel) while
 * config's default is 3717, so probe both rather than making the caller
 * remember which one is up today.
 */
async function findLocalBackend(): Promise<string> {
  const ports = [...new Set([config.port, 3718])]

  for (const port of ports) {
    const url = `https://127.0.0.1:${port}`
    const ok = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false)

    if (ok) {
      console.log(`backend: ${url}`)

      return url
    }
  }
  fail(
    `no backend answered /health on ${ports.join(' or ')} — start it with \`bun run dev\`, or pass --base`,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.message) fail('--message is required')
  if (!args.user) fail('--user is required (email or user id)')

  // The dev server terminates TLS itself with a local cert, so plain http gets
  // an empty reply and reads as a hung backend. Verification is off for
  // loopback only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const base = args.base ? args.base.replace(/\/$/, '') : await findLocalBackend()

  await connectDb()
  const users = db().collection<{ _id: ObjectId; email: string }>('users')
  const user = ObjectId.isValid(args.user)
    ? await users.findOne({ _id: new ObjectId(args.user) })
    : await users.findOne({ email: args.user })

  if (!user) fail(`no user matches ${args.user}`)
  const userId = user._id.toHexString()
  const token = signNuphosToken(userId, 15 * 60)

  let teamId = args.team

  if (!teamId) {
    const teams = await getMyTeams(userId)

    if (teams.length === 0) fail(`${args.user} belongs to no team`)
    teamId = teams[0]!.id
    const alternatives = teams.length > 1 ? ` — ${teams.length} available, pass --team to pick` : ''

    console.log(`team: ${teams[0]!.name} (${teamId})${alternatives}`)
  }

  const credentialAccess = args.creds
    ? await resolveCredentialAccess(base, token, teamId, args.creds)
    : undefined

  if (credentialAccess) {
    const summary = Object.entries(credentialAccess)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(' ')

    console.log(`credentials: ${summary || '(none bound)'}`)
  }

  const sessionId = args.session ?? crypto.randomUUID()

  console.log(`session: ${sessionId}`)
  console.log(`> ${args.message}\n`)

  const res = await fetch(`${base}/agent/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      id: sessionId,
      teamId,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: args.message }],
        },
      ],
      ...(credentialAccess ? { credentialAccess } : {}),
    }),
  })

  if (!res.ok) fail(`POST /agent/chat returned HTTP ${res.status}: ${await res.text()}`)

  const trace = await consume(res, args.quiet)

  // The stream ending doesn't say why. The stored conversation does — a paused
  // turn looks identical to a finished one on the wire.
  const state = (await fetch(`${base}/agent/conversations/${sessionId}?tail=1&teamId=${teamId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { pauseReason?: string } | null

  console.log('\n─────────────')
  console.log(
    `tools: ${trace.tools.length === 0 ? '(none)' : trace.tools.map((t) => t.name).join(', ')}`,
  )
  const pauseReason = state?.pauseReason

  if (pauseReason) console.log(`paused: ${pauseReason}`)

  let failed = false

  // A stream that ends with neither terminal frame is the silent-stall shape:
  // tool calls happen, no answer arrives, nothing is persisted. Never let that
  // read as a pass.
  if (!trace.completed && !trace.paused) {
    console.log(
      '✗ stream ended without atlas-turn-complete or atlas-turn-paused (turn died mid-flight)',
    )
    failed = true
  }
  if (trace.paused) console.log('paused: step/token cap (atlas-turn-paused)')
  const haystack = trace.tools.map((t) => `${t.name} ${t.input}`).join('\n')

  for (const pattern of args.require) {
    const hit = new RegExp(pattern).test(haystack)

    console.log(`${hit ? '✓' : '✗'} require /${pattern}/`)
    if (!hit) failed = true
  }
  for (const pattern of args.forbid) {
    const hit = new RegExp(pattern).test(haystack)

    console.log(`${hit ? '✗' : '✓'} forbid  /${pattern}/`)
    if (hit) failed = true
  }

  if (trace.errors.length > 0) failed = true
  if (failed) process.exit(1)
  if (pauseReason || trace.paused) process.exit(2)
  process.exit(0)
}

await main()
