// How an MCP call over HTTP is answered: as JSON, kept alive while a tool works.
import { stream } from 'hono/streaming'

import type { JsonRpcResponse } from './protocol'
import type { Context } from 'hono'

/**
 * How long a call may stay silent before it starts sending whitespace, and how often it sends
 * more. Under every read timeout in front of the backend: 60s on ingress-nginx, 100s at
 * Cloudflare, and the backend's own 120s `idleTimeout`.
 */
export const MCP_QUIET_MS = 20_000

type Answer = { status: 200 | 202 | 400; body: JsonRpcResponse | JsonRpcResponse[] | null }

/**
 * Answers a call as JSON. One still working after `quietMs` is answered 200 at once and sends a
 * space every `quietMs` until its JSON (#3156), since a proxy drops a request that stays silent
 * past its read timeout. JSON readers skip leading whitespace. Only a call that already answered
 * can have another status, so a call still working is always 200.
 */
export async function answerMcp(c: Context, work: Promise<Answer>, quietMs = MCP_QUIET_MS) {
  let timer: Timer | undefined
  const answered = await Promise.race([
    work,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, quietMs)
    }),
  ])

  clearTimeout(timer)
  if (answered)
    return answered.body === null
      ? c.body(null, answered.status)
      : c.json(answered.body, answered.status)
  c.header('Content-Type', 'application/json')
  // ingress-nginx would otherwise hold the spaces back until the end.
  c.header('X-Accel-Buffering', 'no')

  return stream(c, async (out) => {
    await out.write(' ')
    const beat = setInterval(() => void out.write(' '), quietMs)

    try {
      await out.write(JSON.stringify((await work).body))
    } finally {
      clearInterval(beat)
    }
  })
}
