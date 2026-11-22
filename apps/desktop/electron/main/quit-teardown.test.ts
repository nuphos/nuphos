import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { teardownOnQuit } from './quit-teardown.ts'

/**
 * Electron's quit as far as the teardown sees it: before-quit, then will-quit once every window
 * closed. A quit asked for before a prevented will-quit has finished dispatching is dropped.
 */
class FakeApp extends EventEmitter {
  exited = false
  windowRefusesToClose = false
  private quitting = false
  quit(): void {
    if (this.quitting) return
    if (this.prevented('before-quit') || this.windowRefusesToClose) return
    this.quitting = true
    if (!this.prevented('will-quit')) this.exited = true
    else setImmediate(() => (this.quitting = false))
  }
  private prevented(name: string): boolean {
    let prevented = false

    this.emit(name, {
      preventDefault: () => {
        prevented = true
      },
    })

    return prevented
  }
}

/** Lets a settled teardown's deferred quit run. */
async function nextTurns(): Promise<void> {
  for (let i = 0; i < 2; i++) await new Promise((resolve) => setImmediate(resolve))
}

test('a quit a window cancels leaves the runtime running', () => {
  const app = new FakeApp()
  let stopped = false

  teardownOnQuit(app as never, () => {
    stopped = true

    return Promise.resolve()
  })
  app.windowRefusesToClose = true
  app.quit()

  assert.equal(stopped, false)
  assert.equal(app.exited, false)
})

test('a quit that goes ahead exits only after the teardown settles', async () => {
  const app = new FakeApp()
  let finish: (() => void) | undefined

  teardownOnQuit(
    app as never,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  app.quit()
  assert.equal(app.exited, false)
  finish?.()
  await nextTurns()

  assert.equal(app.exited, true)
})

test('a teardown with nothing to wait for still exits (#4524)', async () => {
  const app = new FakeApp()

  teardownOnQuit(app as never, () => Promise.resolve())
  app.quit()
  await nextTurns()

  assert.equal(app.exited, true)
})
