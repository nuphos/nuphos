// A TCP hop in front of the backend whose open connections can stop passing what the backend
// sends, as a network path that silently drops one direction does, or be reset on the computer's
// side only, as a reset somewhere between the computer and the edge is.
import { connect, createServer } from 'node:net'

import type { Socket } from 'node:net'

export async function proxyTo(port: number) {
  const pairs = new Set<{ client: Socket; upstream: Socket; silent: boolean }>()
  let held = Promise.resolve()
  const server = createServer((client) => {
    client.pause()
    void held.then(() => {
      if (client.destroyed) return
      const pair = { client, upstream: connect(port, '127.0.0.1'), silent: false }
      const end = () => {
        pairs.delete(pair)
        client.destroy()
        pair.upstream.destroy()
      }

      pairs.add(pair)
      client.on('data', (chunk) => pair.upstream.write(chunk))
      pair.upstream.on('data', (chunk) => {
        if (!pair.silent && !client.destroyed) client.write(chunk)
      })
      client.on('close', end).on('error', end)
      pair.upstream.on('close', end).on('error', end)
      client.resume()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`,
    /** From now on, connections already open get nothing more from the backend; new ones do. */
    silenceOpenConnections: () => {
      for (const pair of pairs) pair.silent = true
    },
    /** Resets the computer's side of open connections; the backend's side hears nothing. */
    resetOpenConnections: () => {
      for (const pair of pairs) pair.client.removeAllListeners('close').destroy()
    },
    /** New connections wait until the returned release is called. */
    holdNewConnections: () => {
      const { promise, resolve } = Promise.withResolvers<void>()

      held = promise

      return resolve
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
