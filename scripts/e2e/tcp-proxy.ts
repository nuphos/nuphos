// A TCP hop in front of the backend whose open connections can stop passing what the backend
// sends, as a network path that silently drops one direction does.
import { connect, createServer } from 'node:net'

import type { Socket } from 'node:net'

export async function proxyTo(port: number) {
  const pairs = new Set<{ client: Socket; upstream: Socket; silent: boolean }>()
  const server = createServer((client) => {
    const pair = { client, upstream: connect(port, '127.0.0.1'), silent: false }
    const end = () => {
      pairs.delete(pair)
      client.destroy()
      pair.upstream.destroy()
    }

    pairs.add(pair)
    client.on('data', (chunk) => pair.upstream.write(chunk))
    pair.upstream.on('data', (chunk) => {
      if (!pair.silent) client.write(chunk)
    })
    client.on('close', end).on('error', end)
    pair.upstream.on('close', end).on('error', end)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`,
    /** From now on, connections already open get nothing more from the backend; new ones do. */
    silenceOpenConnections: () => {
      for (const pair of pairs) pair.silent = true
    },
    close: () => {
      for (const pair of pairs) {
        pair.client.destroy()
        pair.upstream.destroy()
      }
      server.close()
    },
  }
}
