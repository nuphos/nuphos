import assert from 'node:assert/strict'
import test from 'node:test'

// Resolved once at module load from the preload bridge, so each case installs
// its own `globalThis.api` and imports a fresh copy.
let caseId = 0

async function load(api: unknown) {
  const previous = (globalThis as { api?: unknown }).api

  ;(globalThis as { api?: unknown }).api = api
  try {
    return (await import(`./webBaseUrl.ts?case=${++caseId}`)) as typeof import('./webBaseUrl.ts')
  } finally {
    ;(globalThis as { api?: unknown }).api = previous
  }
}

test('takes the origin the main process resolved', async () => {
  const m = await load({ webBaseUrl: 'https://nuphos.acme.internal' })

  assert.equal(m.WEB_BASE_URL, 'https://nuphos.acme.internal')
  assert.ok(m.isAppWebUrl('/teams/x'))
  assert.ok(m.isAppWebUrl('https://nuphos.acme.internal/teams/x'))
  assert.equal(m.isAppWebUrl('https://nuphos.ai/teams/x'), null)
})

test('falls back when there is no bridge — unit tests and any non-Electron render', async () => {
  assert.equal((await load(undefined)).WEB_BASE_URL, 'https://nuphos.ai')
  assert.equal((await load({})).WEB_BASE_URL, 'https://nuphos.ai')
  assert.equal((await load({ webBaseUrl: '' })).WEB_BASE_URL, 'https://nuphos.ai')
})

test('subdomains are not app pages', async () => {
  const m = await load({ webBaseUrl: 'https://nuphos.ai' })

  // The chat-link handler used to accept any *.nuphos.ai host and hand it to
  // the deep-link resolver, which dropped the host and navigated to the bare
  // pathname — so a docs link opened whatever app page shared that path.
  assert.equal(m.isAppWebUrl('https://docs.nuphos.ai/connectors/capabilities'), null)
  assert.equal(m.isAppWebUrl('https://api.nuphos.ai/teams/x'), null)
})

test('a same-host URL on another scheme or port is not ours', async () => {
  const m = await load({ webBaseUrl: 'https://nuphos.ai' })

  assert.equal(m.isAppWebUrl('http://nuphos.ai/teams/x'), null)
  assert.equal(m.isAppWebUrl('https://nuphos.ai:8443/teams/x'), null)
})

test('a configured port is part of the identity, not an obstacle', async () => {
  const m = await load({ webBaseUrl: 'http://localhost:5173' })

  assert.ok(m.isAppWebUrl('http://localhost:5173/teams/x'))
  assert.equal(m.isAppWebUrl('http://localhost:4173/teams/x'), null)
})
