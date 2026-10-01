import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENT_TOOL_DEFAULT_DEADLINE_MS,
  clientToolDeadlineMs,
  withClientToolDeadline,
} from './clientToolDeadline.ts'

const never = () => new Promise<never>(() => {})

// local_exec no longer executes through this client-tool path (the backend
// dispatches it to a device directly), so it gets the default deadline like
// any other unlisted tool name.
test('an unlisted tool name gets the default deadline', () => {
  assert.equal(clientToolDeadlineMs('local_exec'), CLIENT_TOOL_DEFAULT_DEADLINE_MS)
  assert.equal(clientToolDeadlineMs('upload_attachment'), CLIENT_TOOL_DEFAULT_DEADLINE_MS)
})

test('an invoke that never settles rejects instead of parking the turn forever', async () => {
  const seen: { toolName: string; deadlineMs: number }[] = []

  await assert.rejects(
    withClientToolDeadline('local_exec', never, {
      deadlineMs: 10,
      onDeadline: (i) => seen.push(i),
    }),
    /local_exec did not respond after 0s on this machine\./,
  )
  assert.deepEqual(seen, [{ toolName: 'local_exec', deadlineMs: 10 }])
})

test('a result that arrives in time passes through untouched', async () => {
  const out = { stdout: 'hi', stderr: '', exitCode: 0 }

  assert.equal(
    await withClientToolDeadline('local_exec', async () => out, { deadlineMs: 5_000 }),
    out,
  )
})

test('a rejection from the tool itself is not masked by the deadline', async () => {
  await assert.rejects(
    withClientToolDeadline(
      'local_exec',
      async () => {
        throw new Error('no handler')
      },
      {
        deadlineMs: 5_000,
      },
    ),
    /no handler/,
  )
})

test('the deadline timer is cleared once the call settles', async () => {
  let fired = false

  await withClientToolDeadline('local_exec', async () => 'done', {
    deadlineMs: 10,
    onDeadline: () => {
      fired = true
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(fired, false)
})
