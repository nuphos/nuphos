import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitLatestStaged } from './updater-install.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

const never = deferred().promise
const check = (version: string, downloadPromise: Promise<unknown>) => ({
  updateInfo: { version },
  downloadPromise,
})

test('a newer release waits for its download and the OS installer before the restart', async () => {
  const download = deferred()
  const os = deferred()
  let done = false
  const result = awaitLatestStaged(check('0.113.0', download.promise), '0.112.0', () => os.promise)

  void result.then(() => {
    done = true
  })
  download.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  os.resolve()
  assert.equal(await result, true)
})

test('the staged release is still the newest: restart now', async () => {
  assert.equal(await awaitLatestStaged(check('0.112.0', never), '0.112.0', () => never), true)
})

test('no update found, or the check failed: restart into the staged release', async () => {
  assert.equal(await awaitLatestStaged(null, '0.112.0', () => never), true)
  assert.equal(
    await awaitLatestStaged({ updateInfo: { version: '0.112.0' } }, '0.112.0', () => never),
    true,
  )
})

test('the newer release failed to download: no restart', async () => {
  const failed = Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))

  assert.equal(await awaitLatestStaged(check('0.113.0', failed), '0.112.0', () => never), false)
})
