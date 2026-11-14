// A DeepSeek Harness plugin, loaded only by dsh-login.mjs through a `--patch` overlay
// on the `acp` profile. DSH's own services do the work: `credentials` stores an API key
// and `deepseekAccount` runs the browser sign-in (PKCE, code exchange, grant storage).
// Frames go to dsh-login.mjs on fd 3 and never carry a credential; the API key arrives
// on stdin.
import { createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'

export const name = 'nuphos-sign-in'
export const inject = ['credentials', 'deepseekAccount']

const TERMINAL = new Set(['succeeded', 'cancelled', 'expired', 'failed'])

export function apply(ctx) {
  const out = createWriteStream('', { fd: 3 })
  const send = (frame) => out.write(`${JSON.stringify(frame)}\n`)
  const run =
    process.env.NUPHOS_DSH_SIGN_IN === 'account' ? () => account(ctx, send) : () => apiKey(ctx)
  run().then(
    () => send({ type: 'done', phase: 'succeeded' }),
    (error) => send({ type: 'done', phase: error?.phase ?? 'failed' }),
  )
}

async function apiKey(ctx) {
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
  const { value } = await lines.next()
  const key = value?.trim()
  if (!key) throw new Error('No API key')
  await ctx.credentials.set('DEEPSEEK_API_KEY', key)
}

async function account(ctx, send) {
  const service = ctx.deepseekAccount
  const view = await service.startSignIn(
    {
      version: process.env.NUPHOS_DSH_VERSION ?? '0.0.0',
      locale: 'en',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    },
    `http://127.0.0.1:${process.env.NUPHOS_DSH_SIGN_IN_PORT}`,
    'web',
  )
  const id = view.attempt?.id
  let shown = false
  const signal = new AbortController()
  try {
    for await (const state of service.watch(signal.signal)) {
      const attempt = state.attempt
      if (!attempt || attempt.id !== id) continue
      if (!shown && attempt.authorizeUrl) {
        shown = true
        send({ type: 'browser', url: attempt.authorizeUrl })
      }
      if (TERMINAL.has(attempt.phase)) {
        if (attempt.phase === 'succeeded') return
        throw Object.assign(new Error('Sign-in did not complete'), { phase: attempt.phase })
      }
    }
  } finally {
    signal.abort()
  }
}
