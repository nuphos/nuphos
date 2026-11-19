// Step-up re-authentication (#1054): with two-factor authentication on, a sensitive action needs a
// code from the last ten minutes. "Ten minutes ago" is set in the database, as the clock would.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Client } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** An authenticator app: each code is for a newer 30-second step, as the backend requires. */
class Authenticator {
  private last = 0

  constructor(private readonly secret: string) {}

  async code(): Promise<string> {
    const now = () => Math.floor(Date.now() / 30_000)

    // One step of drift is allowed, so a code for the next step can go out before it starts.
    while (this.last + 1 > now() + 1) await new Promise((done) => setTimeout(done, 1000))
    this.last = Math.max(this.last + 1, now())

    return totp(this.secret, this.last)
  }
}

function totp(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replaceAll('=', '').toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)

  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1]! & 0xf

  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** Moves every sign-in of `email` (and its last code) `minutes` into the past. */
function signedInAgo(mongoUri: string, email: string, minutes: number): void {
  const run = `
    import { MongoClient } from 'mongodb'
    const [uri, email, minutes] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const user = await db.collection('users').findOne({ email })
    const at = new Date(Date.now() - Number(minutes) * 60_000)
    await db.collection('user_sessions').updateMany(
      { userId: user._id.toHexString() },
      { $set: { createdAt: at, verifiedAt: at } },
    )
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, email, String(minutes)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

/** The short-lived token the backend gives an agent run, signed the way it signs one. */
function agentRunToken(mongoUri: string, email: string): string {
  const run = `
    import { MongoClient } from 'mongodb'
    import { signNuphosToken } from './src/lib/identity/token.ts'
    const [uri, email] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const user = await client.db('nuphos_e2e').collection('users').findOne({ email })
    await client.close()
    console.log(signNuphosToken(user._id.toHexString(), 60 * 60))`

  return execFileSync('bun', ['-e', run, mongoUri, email], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
    // The backend's own config, which signing reads.
    env: {
      ...process.env,
      MONGODB_URI: mongoUri,
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
    },
  })
    .toString()
    .trim()
}

/** Signs `email` in with a fresh session and an email code. */
async function signIn(stack: Stack, email: string): Promise<Client> {
  const anonymous = client(stack.apiUrl, '')
  const before = stack.signInCode(email)

  await anonymous('POST', '/auth/email/request-code', { email })
  await until(`a new sign-in code for ${email}`, async () => {
    const code = stack.signInCode(email)

    return code !== undefined && code !== before
  })
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })

  must(verified.status === 200, `a sign-in, got ${String(verified.status)}: ${verified.text}`)

  return client(stack.apiUrl, (verified.body as { token: string }).token)
}

async function turnOnMfa(as: Client): Promise<Authenticator> {
  const setup = await as('POST', '/auth/mfa/totp/setup')

  must(
    setup.status === 200,
    `two-factor setup to start, got ${String(setup.status)}: ${setup.text}`,
  )
  const authenticator = new Authenticator((setup.body as { secret: string }).secret)
  const confirmed = await as('POST', '/auth/mfa/totp/confirm', { code: await authenticator.code() })

  must(confirmed.status === 200, `two-factor authentication on, got ${confirmed.text}`)

  return authenticator
}

const errorCode = (reply: { body: unknown }) =>
  (reply.body as { error?: { code?: string; details?: { method?: string } } } | null)?.error

function mustAskForCode(reply: { status: number; body: unknown; text: string }, what: string) {
  must(
    reply.status === 403 &&
      errorCode(reply)?.code === 'reauth_required' &&
      errorCode(reply)?.details?.method === 'mfa',
    `${what} to ask for a code (403 reauth_required, method mfa), got ${String(reply.status)}: ${reply.text}`,
  )
}

/** Past authentication and the step-up check: the route's own body check answers. */
function mustNotAsk(reply: { status: number; body: unknown; text: string }, what: string) {
  must(
    reply.status === 400 && errorCode(reply)?.code === 'validation_error',
    `${what} to reach the route without a code (400 validation_error), got ${String(reply.status)}: ${reply.text}`,
  )
}

// The refusals these scenarios ask for: a code, or (once past it) the empty body.
const REFUSALS = /"error_code":"(reauth_required|validation_error)"/

/** The MFA account the API scenarios share. */
let account: { email: string; as: Client; teamId: string; agentToken?: string } | undefined

export const stepUpScenarios: Scenario[] = [
  {
    name: 'with two-factor on, a sensitive action asks for a code, passes after one, and asks again ten minutes later',
    expected: REFUSALS,
    run: async (_page, stack) => {
      const email = `e2e-mfa-${String(Date.now())}@example.com`
      const as = await signIn(stack, email)
      const teamId = (
        (await as('POST', '/teams', { name: 'E2E two-factor' })).body as { team: { id: string } }
      ).team.id
      const authenticator = await turnOnMfa(as)
      const mint = () => as('POST', '/auth/cli-tokens', { teamId, name: 'E2E step-up' })
      // Connecting a credential; the body is checked only after the code.
      const connect = () => as('POST', `/teams/${teamId}/database-connections`, {})

      signedInAgo(stack.mongoUri, email, 11)
      mustAskForCode(await mint(), 'creating a CLI token')
      mustAskForCode(await connect(), 'connecting a credential')

      const reauth = await as('POST', '/auth/mfa/reauth', { code: await authenticator.code() })

      must(reauth.status === 204, `the code to be accepted, got ${reauth.text}`)
      const minted = await mint()

      must(minted.status === 201, `the CLI token after the code, got ${minted.text}`)
      mustNotAsk(await connect(), 'connecting a credential after the code')

      signedInAgo(stack.mongoUri, email, 11)
      mustAskForCode(await mint(), 'creating a CLI token ten minutes after the code')
      account = { email, as, teamId, agentToken: (minted.body as { token: string }).token }
    },
  },
  {
    name: 'without two-factor, a sensitive action never asks for a code',
    expected: REFUSALS,
    run: async (_page, stack) => {
      const email = `e2e-no-mfa-${String(Date.now())}@example.com`
      const as = await signIn(stack, email)
      const teamId = (
        (await as('POST', '/teams', { name: 'E2E no two-factor' })).body as { team: { id: string } }
      ).team.id

      signedInAgo(stack.mongoUri, email, 60)
      const minted = await as('POST', '/auth/cli-tokens', { teamId, name: 'E2E no step-up' })

      must(minted.status === 201, `a CLI token without a code, got ${minted.text}`)
      mustNotAsk(
        await as('POST', `/teams/${teamId}/database-connections`, {}),
        'connecting a credential',
      )
    },
  },
  {
    name: 'a CLI token and an agent run are never asked for a code',
    expected: REFUSALS,
    run: async (_page, stack) => {
      must(account?.agentToken !== undefined, 'the two-factor scenario to have run first')
      const { email, as, teamId, agentToken } = account
      const connect = (token: string) =>
        client(stack.apiUrl, token)('POST', `/teams/${teamId}/database-connections`, {})

      // The session is past its ten minutes, so the same request asks it for a code.
      mustAskForCode(
        await as('POST', `/teams/${teamId}/database-connections`, {}),
        'the old session',
      )
      mustNotAsk(await connect(agentToken), 'the CLI token')
      mustNotAsk(await connect(agentRunToken(stack.mongoUri, email)), 'the agent run')
    },
  },
  {
    name: 'Desktop asks for a code before connecting Cloudflare, and the connection starts after it',
    expected: REFUSALS,
    run: async (page, stack) => {
      // A fresh sign-in may turn two-factor on; the app's own sign-in is then made old.
      const as = await signIn(stack, stack.email)
      const authenticator = await turnOnMfa(as)

      signedInAgo(stack.mongoUri, stack.email, 11)
      // The scenario before leaves its error toast up; it would cover these shots.
      const toasts = page.getByRole('region', { name: 'Notifications' })

      for (const dismiss of await toasts.getByLabel('Dismiss', { exact: true }).all()) {
        await dismiss.click()
      }
      // The newest Cloudflare authorization the backend has started.
      const started = stack.cloudflareState()

      await page.getByRole('button', { name: 'Connectors' }).click()
      await page.getByLabel('Add Cloudflare').click()
      await page.getByRole('button', { name: 'Connect with Cloudflare' }).click()
      const prompt = page.getByRole('dialog', { name: 'Confirm it’s you' })

      await prompt.waitFor()
      await page.screenshot({ path: `${artifacts}/step-up-prompt.png` })
      must(stack.cloudflareState() === started, 'no authorization to start before the code')
      // The sixth digit submits the code, and the app sends the request again.
      await prompt.locator('input[placeholder="000000"]').fill(await authenticator.code())
      await prompt.waitFor({ state: 'detached' })
      await until(
        'the authorization to start after the code',
        async () => stack.cloudflareState() !== started,
      )
      await page.screenshot({ path: `${artifacts}/step-up-continued.png` })

      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Connect Cloudflare' }).waitFor({ state: 'detached' })
      const connectors = page.getByRole('dialog', { name: 'Connectors' })

      await connectors.getByLabel('Close modal').click()
      await connectors.waitFor({ state: 'detached' })
      // Off again, for any scenario after this one.
      const off = await as('POST', '/auth/mfa/disable', { code: await authenticator.code() })

      must(off.status === 204, `two-factor authentication off, got ${off.text}`)
    },
  },
]
