import { expect, spyOn, test } from 'bun:test'

import * as observability from '@/lib/observability'

import {
  createDrainDiagnostics,
  drainAgentProducers,
  stopHttpWithDeadline,
  trackAgentProducer,
} from './producer-drain'

test('shutdown waits for persistence even after the stream has closed', async () => {
  let finish!: () => void
  let persisted = false
  const producer = trackAgentProducer(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    persisted = true
  })

  await Promise.resolve()
  let drained = false
  const drain = drainAgentProducers(1000).then((result) => {
    drained = result
  })

  await Promise.resolve()
  expect(drained).toBe(false)
  finish()
  await drain
  expect(persisted).toBe(true)
  expect(drained).toBe(true)
  await producer
})

test('a stuck producer is bounded and a failed producer does not reject shutdown', async () => {
  let finish!: () => void
  const producer = trackAgentProducer(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )

  expect(await drainAgentProducers(5)).toBe(false)
  finish()
  await producer
  await trackAgentProducer(async () => {
    throw new Error('persist failed')
  }).catch(() => {})
  expect(await drainAgentProducers(100)).toBe(true)
})

test('worker quiescence precedes the last producer drain', async () => {
  let workerStopped!: () => void
  let finishWrite!: () => void
  const worker = new Promise<void>((resolve) => {
    workerStopped = resolve
  })
  let drained = false
  const shutdown = drainAgentProducers(1000, worker).then((done) => {
    drained = done
  })

  await Promise.resolve()
  const write = trackAgentProducer(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve
      }),
  )

  await Promise.resolve()
  workerStopped()
  await Promise.resolve()
  expect(drained).toBe(false)
  finishWrite()
  await write
  await shutdown
  expect(drained).toBe(true)
})

test('deadline snapshot distinguishes outstanding HTTP, producers and workers', async () => {
  let finishHttp!: () => void
  let finishWorker!: () => void
  let finishProducer!: () => void
  const producer = trackAgentProducer(
    () =>
      new Promise<void>((done) => {
        finishProducer = done
      }),
  )
  const worker = new Promise<void>((done) => {
    finishWorker = done
  })
  const http = new Promise<void>((done) => {
    finishHttp = done
  })
  const diagnostic = createDrainDiagnostics({ pendingRequests: 2, pendingWebSockets: 3 }, worker)

  void diagnostic.trackHttp(http)
  await Promise.resolve()
  expect(diagnostic.snapshot()).toMatchObject({
    http_stop_settled: false,
    workers_settled: false,
    agent_producers_in_flight: 1,
    http_pending_requests: 2,
    http_pending_websockets: 3,
  })
  finishHttp()
  await http
  expect(diagnostic.snapshot()).toMatchObject({
    http_stop_settled: true,
    workers_settled: false,
    agent_producers_in_flight: 1,
  })
  finishWorker()
  await worker
  expect(diagnostic.snapshot()).toMatchObject({
    http_stop_settled: true,
    workers_settled: true,
    agent_producers_in_flight: 1,
  })
  finishProducer()
  await producer
  expect(diagnostic.snapshot()).toMatchObject({
    http_stop_settled: true,
    workers_settled: true,
    agent_producers_in_flight: 0,
  })
})

function fakeServer(drains: boolean) {
  const stops: boolean[] = []
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })

  return {
    stops,
    pendingRequests: 1,
    pendingWebSockets: 0,
    stop(force: boolean) {
      stops.push(force)
      if (force || drains) release()

      return pending
    },
  }
}

test('a drain that outlives the deadline force-stops both servers and logs the snapshot', async () => {
  const log = spyOn(observability, 'logEvent').mockImplementation(() => {})
  const server = fakeServer(false)
  const dev = fakeServer(false)

  await stopHttpWithDeadline(server, dev, 20, Promise.resolve())
  expect(server.stops).toEqual([false, true])
  expect(dev.stops).toEqual([false, true])
  expect(log).toHaveBeenCalledWith(
    'warn',
    'backend.shutdown.drain_deadline_exceeded',
    expect.objectContaining({ drain_deadline_ms: 20, http_pending_requests: 1 }),
  )
  log.mockRestore()
})

test('a drain that finishes first never force-stops', async () => {
  const log = spyOn(observability, 'logEvent').mockImplementation(() => {})
  const server = fakeServer(true)

  await stopHttpWithDeadline(server, undefined, 20, Promise.resolve())
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(server.stops).toEqual([false])
  expect(log).not.toHaveBeenCalledWith(
    'warn',
    'backend.shutdown.drain_deadline_exceeded',
    expect.anything(),
  )
  log.mockRestore()
})
