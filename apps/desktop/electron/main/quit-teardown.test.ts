import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { teardownOnQuit } from './quit-teardown.ts'

/** Electron's quit as far as the teardown sees it: before-quit, then will-quit once every
 *  window closed. A quit after a held will-quit does nothing, as Electron 44 does on Linux. */
class FakeApp extends EventEmitter {
  exited = false
  windowRefusesToClose = false
  private held = false
  quit(): void {
    if (this.held || this.prevented('before-quit') || this.windowRefusesToClose) return
    if (this.prevented('will-quit')) this.held = true
    else this.exited = true
  }
  exit(): void {
    this.exited = true
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
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(app.exited, true)
})
