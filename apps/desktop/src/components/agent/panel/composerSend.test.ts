import assert from 'node:assert/strict'
import test from 'node:test'

import { settleSend, submitDraft } from './composerSend.ts'

function composer() {
  const draft = { text: 'hello', cleared: 0 }
  const pending = { current: false }

  return {
    draft,
    pending,
    opts: {
      pending,
      clear: () => {
        draft.cleared += 1
        draft.text = ''
      },
      unchanged: () => draft.text === 'hello',
    },
  }
}

function deferred() {
  let resolve!: (accepted: boolean) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('an accepted send clears the draft before anything else can run', async () => {
  const c = composer()

  submitDraft(() => Promise.resolve(true), c.opts)
  // A microtask, not a timer: it lands before the next paint or keystroke.
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(c.draft.cleared, 1)
})

test('a send refused before dispatch keeps the draft', async () => {
  const c = composer()

  submitDraft(() => Promise.resolve(false), c.opts)
  await flush()
  assert.equal(c.draft.cleared, 0)
  assert.equal(c.draft.text, 'hello')
  assert.equal(c.pending.current, false)
})

test('a late acceptance clears the draft it was sent with', async () => {
  const c = composer()
  const d = deferred()

  submitDraft(() => d.promise, c.opts)
  assert.equal(c.draft.cleared, 0, 'nothing clears while the answer is pending')
  d.resolve(true)
  await flush()
  assert.equal(c.draft.cleared, 1)
  assert.equal(c.pending.current, false)
})

test('a late acceptance leaves newer typing alone', async () => {
  const c = composer()
  const d = deferred()

  submitDraft(() => d.promise, c.opts)
  c.draft.text = 'hello, and something else'
  d.resolve(true)
  await flush()
  assert.equal(c.draft.cleared, 0)
  assert.equal(c.draft.text, 'hello, and something else')
})

test('a late refusal or failure keeps the draft', async () => {
  for (const settle of ['refuse', 'reject'] as const) {
    const c = composer()
    const d = deferred()

    submitDraft(() => d.promise, c.opts)
    if (settle === 'refuse') d.resolve(false)
    else d.reject(new Error('listing failed'))
    await flush()
    assert.equal(c.draft.cleared, 0, settle)
    assert.equal(c.pending.current, false, settle)
  }
})

test('a second submit while one is pending does not send again', async () => {
  const c = composer()
  const d = deferred()
  let sends = 0
  const send = () => {
    sends += 1

    return d.promise
  }

  submitDraft(send, c.opts)
  submitDraft(send, c.opts)
  assert.equal(sends, 1)
  d.resolve(false)
  await flush()
  submitDraft(send, c.opts)
  assert.equal(sends, 2, 'a settled refusal lets the user send again')
})

test('settleSend tells an accepted send from a refused or failed one', async () => {
  const runs: string[] = []
  const track = (name: string) => ({
    accepted: () => runs.push(`${name}:accepted`),
    refused: () => runs.push(`${name}:refused`),
  })

  settleSend(Promise.resolve(true), track('yes'))
  settleSend(Promise.resolve(false), track('no'))
  settleSend(Promise.reject(new Error('x')), track('fail'))
  settleSend(Promise.resolve(true), { refused: () => runs.push('unused') })
  await flush()
  assert.deepEqual(runs.sort(), ['fail:refused', 'no:refused', 'yes:accepted'])
})
