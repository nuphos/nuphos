import assert from 'node:assert/strict'
import { test } from 'node:test'

import { watchPasskeyRequests } from './passkey-requests.ts'

type Options = { publicKey?: unknown; mediation?: string; signal?: AbortSignal }

/** A page whose passkey requests wait until their signal aborts, as Electron's do. */
function page() {
  const seen: Options[] = []

  class Container {
    get(options?: Options) {
      seen.push(options ?? {})

      return new Promise((_resolve, reject) => {
        const signal = options?.signal

        signal?.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
        })
      })
    }

    create() {
      return Promise.resolve('created')
    }
  }
  const capabilities = { hybridTransport: true, passkeyPlatformAuthenticator: true }
  const PublicKeyCredential = {
    getClientCapabilities: () =>
      Promise.resolve({ ...capabilities, userVerifyingPlatformAuthenticator: false }),
  }

  return { seen, navigator: { credentials: new Container() }, PublicKeyCredential }
}

test('a passkey request is reported, and cancelling it refuses the page', async () => {
  const target = page()
  const reports: [number, boolean][] = []
  const cancel = watchPasskeyRequests((id, waiting) => reports.push([id, waiting]), target)
  const request = target.navigator.credentials.get({ publicKey: {} })

  assert.deepEqual(reports, [[1, true]])
  cancel(1)
  await assert.rejects(request, { name: 'NotAllowedError' })
  assert.deepEqual(reports, [
    [1, true],
    [1, false],
  ])
})

test("the page's own abort still ends its request", async () => {
  const target = page()
  const reports: [number, boolean][] = []
  const own = new AbortController()

  watchPasskeyRequests((id, waiting) => reports.push([id, waiting]), target)
  const request = target.navigator.credentials.get({ publicKey: {}, signal: own.signal })

  own.abort(new Error('page changed its mind'))
  await assert.rejects(request, /changed its mind/u)
  assert.equal(reports.length, 2)
})

test('a finished request reports its end and keeps its answer', async () => {
  const target = page()
  const reports: [number, boolean][] = []

  watchPasskeyRequests((id, waiting) => reports.push([id, waiting]), target)
  const create = target.navigator.credentials.create as (options: Options) => Promise<string>

  assert.equal(await create.call(target.navigator.credentials, { publicKey: {} }), 'created')
  assert.deepEqual(reports, [
    [1, true],
    [1, false],
  ])
})

test('password and conditional requests pass through unreported', () => {
  const target = page()
  const reports: unknown[] = []

  watchPasskeyRequests((...report) => reports.push(report), target)
  void target.navigator.credentials.get({ mediation: 'conditional', publicKey: {} })
  void target.navigator.credentials.get({})
  assert.deepEqual(reports, [])
  assert.deepEqual(target.seen, [{ mediation: 'conditional', publicKey: {} }, {}])
  assert.equal(target.navigator.credentials.get.name, 'get')
})

test('the page is not told that phone or saved passkeys work', async () => {
  const target = page()

  watchPasskeyRequests(() => undefined, target)
  assert.deepEqual(await target.PublicKeyCredential.getClientCapabilities(), {
    hybridTransport: false,
    passkeyPlatformAuthenticator: false,
    userVerifyingPlatformAuthenticator: false,
  })
})
