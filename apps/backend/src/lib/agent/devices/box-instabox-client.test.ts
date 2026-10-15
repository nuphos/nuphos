import { beforeEach, describe, expect, test } from 'bun:test'

import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'

// instabox as the client sees it: nothing here talks to a network.
const calls: string[] = []
let machines: { sandboxId: string }[] = []
let killFails = false

useInstaboxMachines({
  listMachines: (_conn, metadata) => {
    calls.push(`list ${metadata.deviceId ?? ''}`)

    return Promise.resolve(machines)
  },
  killMachine: (_conn, sandboxId) => {
    calls.push(`kill ${sandboxId}`)

    return killFails ? Promise.reject(new Error('instabox is down')) : Promise.resolve()
  },
})

const { killBoxMachine } = await import('./box-instabox-client')
const conn = { apiKey: 'test-key', requestTimeoutMs: 1_000, operationTimeoutMs: 1_000 }

describe('killBoxMachine', () => {
  beforeEach(() => {
    calls.length = 0
    machines = []
    killFails = false
  })

  test('kills the machine the row names', async () => {
    await killBoxMachine(conn, 'm_known', 'd1')
    expect(calls).toEqual(['kill m_known'])
  })

  test('a row without a machine id still kills the machine made for it', async () => {
    // The backend went away between ordering the machine and recording its id.
    machines = [{ sandboxId: 'm_orphan' }]
    await killBoxMachine(conn, undefined, 'd1')
    expect(calls).toEqual(['list d1', 'kill m_orphan'])
  })

  test('a row without a machine id and no machine has nothing to kill', async () => {
    await killBoxMachine(conn, undefined, 'd1')
    expect(calls).toEqual(['list d1'])
  })

  test('a kill that fails throws, so the caller keeps the row', async () => {
    machines = [{ sandboxId: 'm_orphan' }]
    killFails = true
    await expect(killBoxMachine(conn, undefined, 'd1')).rejects.toThrow('instabox is down')
  })
})
