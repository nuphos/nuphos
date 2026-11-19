import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { afterForkStored, forkLookupWaits } from './forkStored.ts'

// How the main process hands an API error with a code across IPC.
const apiError = (code: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: code, code })}`)

let calls = 0
const recordAfter = (failures: Error[]) => () => {
  calls++
  const failure = failures.shift()

  return failure ? Promise.reject(failure) : Promise.resolve()
}

beforeEach(() => {
  calls = 0
  forkLookupWaits.ms = [1, 1]
})

test("records once the fork's history import lands", async () => {
  const imported = Promise.withResolvers<undefined>()

  const done = afterForkStored(imported.promise, recordAfter([]))

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls, 0, 'not before the server has the history')
  imported.resolve(undefined)
  await done
  assert.equal(calls, 1)
})

test('never records when the import fails', async () => {
  await assert.rejects(
    afterForkStored(Promise.reject(new Error('import failed')), recordAfter([])),
    /import failed/,
  )
  assert.equal(calls, 0)
})

test('a fork with no history is tried again until its first turn stores it', async () => {
  await afterForkStored(
    undefined,
    recordAfter([apiError('fork_not_found'), apiError('fork_not_found')]),
  )
  assert.equal(calls, 3)
})

test('gives up once the waits run out', async () => {
  const failures = [1, 2, 3].map(() => apiError('fork_not_found'))

  await assert.rejects(afterForkStored(undefined, recordAfter(failures)), /fork_not_found/)
  assert.equal(calls, 3)
})

test('any other error is not tried again', async () => {
  await assert.rejects(
    afterForkStored(undefined, recordAfter([apiError('conversation_read_only')])),
    /conversation_read_only/,
  )
  assert.equal(calls, 1)
})
