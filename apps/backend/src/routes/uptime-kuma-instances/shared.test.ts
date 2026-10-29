import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { getRawMonitor } from '@/lib/byos/uptime-kuma-socket'
import { errorHandler } from '@/lib/errors'

import { uptimeKumaError } from './shared'

import type { KumaAck } from '@/lib/byos/uptime-kuma-core'
import type { Socket } from 'socket.io-client'

// A socket whose getMonitor ack is fixed, standing in for an Uptime Kuma server.
function socketAnswering(ack: KumaAck): Socket {
  const emitter = {
    emit: (_event: string, ...args: unknown[]) => {
      const callback = args.at(-1) as (err: Error | null, res: KumaAck) => void

      callback(null, ack)
    },
  }

  return { timeout: () => emitter } as unknown as Socket
}

async function getMonitorStatus(ack: KumaAck): Promise<{ status: number; code: string }> {
  const app = new Hono()

  app.onError(errorHandler)
  app.get('/', async (c) => {
    const monitor = await getRawMonitor(socketAnswering(ack), 42).catch((err: unknown) => {
      throw uptimeKumaError(err, 'Could not get Uptime Kuma monitor')
    })

    return c.json({ monitor })
  })
  const res = await app.request('/')
  const body = (await res.json()) as { error: { code: string } }

  return { status: res.status, code: body.error.code }
}

describe('Uptime Kuma GET monitor', () => {
  // Uptime Kuma 2.x and 1.23 answer an unknown id with the TypeError from its null row.
  test('a missing monitor is 404 monitor_not_found', async () => {
    for (const msg of [
      "Cannot read properties of null (reading 'id')",
      "Cannot read properties of null (reading 'toJSON')",
    ]) {
      expect(await getMonitorStatus({ ok: false, msg })).toEqual({
        status: 404,
        code: 'monitor_not_found',
      })
    }
  })

  test('a real upstream failure is still 503', async () => {
    expect(await getMonitorStatus({ ok: false, msg: 'SQLITE_BUSY: database is locked' })).toEqual({
      status: 503,
      code: 'uptime_kuma_api_error',
    })
  })
})
