import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

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

const { boxBackendUrl, connection, CREATE_TIMEOUT_MS, killBoxMachine } =
  await import('./box-instabox-client')
const { config } = await import('@/config')
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

describe('boxBackendUrl', () => {
  const saved = { backend: config.agent.publicBackendUrl, base: config.auth.publicBaseUrl }

  beforeEach(() => {
    config.agent.publicBackendUrl = saved.backend
    config.auth.publicBaseUrl = saved.base
  })

  test('a Box dials the public backend URL when one is set, not the web URL', () => {
    config.auth.publicBaseUrl = 'https://app.example.test'
    config.agent.publicBackendUrl = 'https://api.example.test'
    expect(boxBackendUrl()).toBe('https://api.example.test')
  })

  test('without one it falls back to the public URL, and never hands out localhost', () => {
    config.agent.publicBackendUrl = undefined
    config.auth.publicBaseUrl = 'https://app.example.test'
    expect(boxBackendUrl()).toBe('https://app.example.test')
    config.auth.publicBaseUrl = 'http://localhost:3718'
    expect(boxBackendUrl()).toBeUndefined()
    config.agent.publicBackendUrl = 'http://localhost:3718'
    expect(boxBackendUrl()).toBeUndefined()
  })
})

describe('connection', () => {
  const saved = config.box.instabox

  beforeEach(() => {
    config.box.instabox = { apiKey: 'test-key' }
  })
  afterEach(() => {
    config.box.instabox = saved
  })

  test('a long operation still caps each request, so one stalled poll cannot hang it', () => {
    expect(connection(CREATE_TIMEOUT_MS)).toMatchObject({
      requestTimeoutMs: 15_000,
      operationTimeoutMs: CREATE_TIMEOUT_MS,
    })
  })

  test('a short operation keeps its own shorter budget for both', () => {
    expect(connection(5_000)).toMatchObject({ requestTimeoutMs: 5_000, operationTimeoutMs: 5_000 })
  })
})
