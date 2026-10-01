// One stack per real worktree. The OS releases this loopback lease on exit,
// including crashes; no stale PID/socket files can admit two provisioners.
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { connect, createServer } from 'node:net'

async function leaseOwner(port: number): Promise<string> {
  return new Promise((resolve) => {
    const client = connect({ host: '127.0.0.1', port })
    let reply = ''
    const finish = () => {
      client.destroy()
      resolve(reply.trim())
    }

    client.setTimeout(500, finish)
    client.on('error', finish)
    client.on('end', finish)
    client.on('data', (chunk: Buffer) => {
      reply += chunk.toString()
      if (reply.includes('\n') || reply.length > 100) finish()
    })
  })
}

export async function acquireDevInstance(root: string): Promise<() => void> {
  const canonical = await realpath(root)
  const hash = createHash('sha256').update(canonical).digest('hex')
  const identity = `nuphos-dev:${hash}`
  const port = 49_152 + (Number.parseInt(hash.slice(0, 8), 16) % 15_000)
  const server = createServer((client) => client.end(`${identity}\n`))

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    server.unref()

    return () => server.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    if ((await leaseOwner(port)) === identity)
      throw new Error(
        `A dev server is already running for ${canonical}. Use the existing Electron window, or stop its dev command before restarting.`,
        { cause: error },
      )
    // Fail closed on a collision. Picking a second port could admit a duplicate
    // later if the unrelated listener on the first port disappears.
    throw new Error(
      `Development instance lease port ${String(port)} is occupied by another process.`,
      { cause: error },
    )
  }
}
