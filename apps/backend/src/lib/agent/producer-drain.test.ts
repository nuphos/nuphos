import { expect, test } from 'bun:test'

import { drainAgentProducers, trackAgentProducer } from './producer-drain'

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
