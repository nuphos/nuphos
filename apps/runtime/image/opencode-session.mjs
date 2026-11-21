// OpenCode can retry a free-tier refusal inside an open prompt without another ACP update.
// Its loopback status endpoint gives the session-specific retry reason without parsing logs.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

export function openCodeStatusRefusal(status, sessionId) {
  const entry = status?.[sessionId]

  if (entry?.type !== 'retry') return undefined
  if (
    entry.action?.reason !== 'free_tier_limit' &&
    !/^free usage limit reached\b/i.test(entry.message ?? '')
  )
    return undefined
  return typeof entry.message === 'string' && entry.message.trim() ? entry.message : undefined
}

/** Choose a loopback port and a fresh password for one OpenCode process. */
export async function openCodeEndpoint() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return { port, password: randomBytes(24).toString('hex') }
}

/** An unavailable or malformed endpoint is not a reason to end a turn. */
export async function openCodeRefusal(endpoint, sessionId, directory) {
  try {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/session/status${query}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return undefined
    return openCodeStatusRefusal(await response.json(), sessionId)
  } catch {
    return undefined
  }
}
