import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { nuphosAuthorizeComputerUse } from './computer-use-permission.mjs'

const authorize = (platform) =>
  runInNewContext(`(${nuphosAuthorizeComputerUse.toString()})`, {
    process: { platform, env: { NUPHOS_CUA_PERMISSION_CLIENT: '/bundle/cua-permission' } },
  })
const cua = { _meta: { connector_id: 'computer-use' } }

test('non-CUA requests and other platforms never invoke native authorization', async () => {
  const unexpected = () => {
    throw new Error('unexpected native call')
  }
  await authorize('darwin')({ _meta: { connector_id: 'browser' } }, undefined, unexpected)
  await authorize('darwin')({}, undefined, unexpected)
  await authorize('linux')(cua, undefined, unexpected)
})

test('CUA waits for consent and receives cancellation signal without a handshake timeout', async () => {
  let allow
  const consent = new Promise((resolve) => {
    allow = resolve
  })
  const controller = new AbortController()
  let done = false
  const pending = authorize('darwin')(cua, controller.signal, (command, args, options) => {
    assert.equal(command, '/bundle/cua-permission')
    assert.equal(args.length, 0)
    assert.equal(options.signal, controller.signal)
    assert.equal(options.timeout, undefined)
    return consent
  }).then(() => {
    done = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  allow()
  await pending
  assert.equal(done, true)
})

test('denied or canceled consent cannot accept the CUA operation', async () => {
  await assert.rejects(
    authorize('darwin')(cua, undefined, () => Promise.reject(new Error('denied'))),
    /denied/u,
  )
  const controller = new AbortController()
  const pending = authorize('darwin')(
    cua,
    controller.signal,
    (_command, _args, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true }),
      ),
  )
  controller.abort()
  await assert.rejects(pending, /canceled/u)
})
