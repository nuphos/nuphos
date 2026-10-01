// Wiping the shared stack under a loopback-listener lock: binding is atomic and
// the OS frees it when the holder exits, so no stale lock exists to clean up.
import { connect, createServer } from 'node:net'

export const RESET_LOCK_PORT = 48_871
const IDENTITY = 'nuphos-dev-reset\n'

export function acquireResetLock(port = RESET_LOCK_PORT): Promise<(() => void) | null> {
  return new Promise((resolve) => {
    const server = createServer((client) => client.end(IDENTITY))

    server.once('error', () => resolve(null))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.unref()
      resolve(() => server.close())
    })
  })
}

export function resetInProgress(port = RESET_LOCK_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const client = connect({ host: '127.0.0.1', port })
    let reply = ''
    const done = (held: boolean) => {
      client.destroy()
      resolve(held)
    }

    client.setTimeout(500, () => done(false))
    client.on('error', () => done(false))
    client.on('data', (chunk: Buffer) => {
      reply += chunk.toString()
      if (reply.includes('\n')) done(reply === IDENTITY)
    })
    client.on('end', () => done(reply === IDENTITY))
  })
}

export type ResetDeps = {
  confirm: () => Promise<boolean>
  acquire: () => Promise<(() => void) | null>
  otherLaunchers: () => number
  wipe: () => Promise<boolean>
}

export type ResetOutcome =
  { outcome: 'declined' | 'busy' | 'wiped' | 'failed' } | { outcome: 'in-use'; others: number }

/** Asks first, then counts launchers under the lock, right before wiping. */
export async function runReset(deps: ResetDeps): Promise<ResetOutcome> {
  if (!(await deps.confirm())) return { outcome: 'declined' }
  const release = await deps.acquire()

  if (!release) return { outcome: 'busy' }
  try {
    const others = deps.otherLaunchers()

    if (others > 0) return { outcome: 'in-use', others }

    return { outcome: (await deps.wipe()) ? 'wiped' : 'failed' }
  } finally {
    release()
  }
}

export function resetMessage(result: ResetOutcome): string {
  switch (result.outcome) {
    case 'declined':
      return 'Not reset. Pass --yes to skip the question.'
    case 'busy':
      return 'Another reset is running.'
    case 'in-use':
      return `${String(result.others)} dev launcher(s) still use the stack; quit them first (q in their dashboards).`
    case 'wiped':
      return 'Local stack wiped.'
    case 'failed':
      return 'docker compose down -v failed.'
  }
}
