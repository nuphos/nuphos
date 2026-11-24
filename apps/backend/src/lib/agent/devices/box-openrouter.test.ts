import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { config } from '@/config'

import {
  GIFT_MODEL,
  OPENCODE_CONFIG_COMMAND,
  giftOpenRouterKey,
  openCodeConfig,
  revokeOpenRouterKey,
} from './box-openrouter'

const savedFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = savedFetch
  delete config.box.openRouterManagementKey
})

/** Answers every request with `answer`; the requests asked. */
function openRouter(answer: () => Response) {
  const asked: { url: string; init?: RequestInit }[] = []

  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: input instanceof Request ? input.url : input.toString(), init })

      return Promise.resolve(answer())
    },
    { preconnect: savedFetch.preconnect },
  )

  return asked
}

test('the Box command gives the runtime’s OpenCode home the config, readable only by its owner', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'box-openrouter-'))

  try {
    const run = Bun.spawnSync(['bash', '-c', OPENCODE_CONFIG_COMMAND], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NUPHOS_USER_ID: 'u1',
        // A key JSON must escape still makes valid JSON.
        OPENCODE_CONFIG: openCodeConfig('sk-or-v1-a"b\\c'),
      },
    })

    expect(run.exitCode).toBe(0)
    const dir = path.join(home, '.local/share/nuphos/agent/users/u1/opencode-home/.config/opencode')
    const file = path.join(dir, 'opencode.json')

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: GIFT_MODEL,
      small_model: GIFT_MODEL,
      provider: { openrouter: { options: { apiKey: 'sk-or-v1-a"b\\c' } } },
    })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a key is asked for with the management key, capped at 1 USD, and comes with its hash', async () => {
  config.box.openRouterManagementKey = 'mgmt'
  const asked = openRouter(() => Response.json({ data: { hash: 'h1' }, key: 'sk-or-v1-gift' }))

  expect(await giftOpenRouterKey('t1')).toEqual({ key: 'sk-or-v1-gift', hash: 'h1' })
  expect(asked.map(({ url, init }) => `${String(init?.method)} ${url}`)).toEqual([
    'POST https://openrouter.ai/api/v1/keys',
  ])
  expect(new Headers(asked[0]?.init?.headers).get('authorization')).toBe('Bearer mgmt')
  expect(JSON.parse(asked[0]?.init?.body as string)).toMatchObject({ limit: 1 })
})

test('a deployment without a management key gives none, and a refusal throws', async () => {
  const asked = openRouter(() => new Response('no', { status: 401 }))

  expect(await giftOpenRouterKey('t1')).toBeUndefined()
  expect(asked).toEqual([])
  config.box.openRouterManagementKey = 'mgmt'
  await expect(giftOpenRouterKey('t1')).rejects.toThrow('401')
})

test('a revoke deletes the key by its hash, and one already gone is no error', async () => {
  config.box.openRouterManagementKey = 'mgmt'
  const asked = openRouter(() => new Response(null, { status: 404 }))

  await revokeOpenRouterKey('h1')
  expect(asked.map(({ url, init }) => `${String(init?.method)} ${url}`)).toEqual([
    'DELETE https://openrouter.ai/api/v1/keys/h1',
  ])
})
