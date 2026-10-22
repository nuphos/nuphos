import net from 'node:net'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { probeDatabaseConnection } from './database-health'

import type { ParsedDatabaseConnection } from './database-connections'
import type { AddressInfo } from 'node:net'

let server: net.Server
let port: number
let accepted = 0

beforeAll(async () => {
  server = net.createServer((socket) => {
    accepted += 1
    socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
})

function postgresAt(host: string): ParsedDatabaseConnection {
  return {
    engine: 'postgresql',
    connectionUri: `postgres://user:pass@${host}:${String(port)}/app`,
    endpoint: `${host}:${String(port)}`,
    databaseName: 'app',
    tls: { enabled: false, mode: 'disable' },
    username: 'user',
  }
}

describe('Postgres probe', () => {
  test.each(['127.0.0.1', 'localhost', `127.0.0.1:1,127.0.0.1`])(
    'never dials a private host (%s)',
    async (host) => {
      const before = accepted
      const health = await probeDatabaseConnection(postgresAt(host), 2_000)

      expect(health.status).not.toBe('healthy')
      expect(accepted).toBe(before)
    },
  )
})
