import type Redis from 'ioredis'

/**
 * Drops the socket so the retry strategy reconnects. Only a ready client is
 * touched: disconnecting a client that is already reconnecting makes ioredis
 * end it for good, with every later command failing as "Connection is closed."
 */
export function forceReconnect(client: Pick<Redis, 'status' | 'disconnect'>): boolean {
  if (client.status !== 'ready') return false
  client.disconnect(true)

  return true
}

/**
 * True when a client has reached `end`. ioredis never leaves that state, so
 * only a restart brings the replica back. A Redis outage leaves a client
 * `reconnecting`, not `end`, so this does not flag every replica at once.
 */
export function anyClientEnded(clients: (Pick<Redis, 'status'> | null)[]): boolean {
  return clients.some((client) => client?.status === 'end')
}
