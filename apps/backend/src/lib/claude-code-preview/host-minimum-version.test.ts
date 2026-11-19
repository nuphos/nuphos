import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import {
  MINIMUM_HOST_VERSION,
  hostOutdated,
  updateAvailable,
  DESKTOP_UPDATE_READY_HINT,
  withOutdatedHint,
} from './host-minimum-version'
import { ownComputer } from './session-desktops'

import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/host-minimum-version.test.ts

const agents = {}

describe('the oldest Nuphos a computer may run', () => {
  test('a Desktop below the floor is out of date, one at it is not', () => {
    // #3829: before 0.127.0 a downloaded update waits for a manual restart.
    expect(MINIMUM_HOST_VERSION.desktop).toBe('0.127.0')
    expect(hostOutdated({ client: 'nuphos-desktop/0.119.2' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.124.0' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.126.0' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.127.0' })).toBeUndefined()
    expect(hostOutdated({ client: 'nuphos-desktop/0.130.1' })).toBeUndefined()
  })

  test('a CLI host is held to the CLI’s own floor', () => {
    expect(MINIMUM_HOST_VERSION.cli).toBe('0.20.0')
    expect(hostOutdated({ client: 'nuphos-cli/0.19.4' })).toBe('cli')
    expect(hostOutdated({ client: 'nuphos-cli/0.20.0' })).toBeUndefined()
    // A Box's host names its CLI in its status; an older one sends no client header.
    expect(hostOutdated({ status: { agents, cliVersion: '0.4.0' } })).toBe('cli')
    expect(hostOutdated({ status: { agents, cliVersion: '0.21.0' } })).toBeUndefined()
  })

  test('the version a host reports in its status wins over the one it connected with', () => {
    const status = { agents, app: { version: '0.118.0' } }

    expect(hostOutdated({ client: 'nuphos-desktop/0.125.0', status })).toBe('desktop')
  })

  test('a computer whose version is unknown is never called out of date', () => {
    expect(hostOutdated(null)).toBeUndefined()
    expect(hostOutdated({})).toBeUndefined()
    expect(hostOutdated({ client: 'nuphos-cli/dev' })).toBeUndefined()
    expect(hostOutdated({ client: 'nuphos-desktop/0.125.0-beta.1' })).toBeUndefined()
    expect(hostOutdated({ client: 'curl/8.0.0' })).toBeUndefined()
  })
})

// The floor only says a computer should update: nothing refuses a turn or a runtime start for it.
describe('a computer below the floor', () => {
  test('is used only for update notices, never to block runtime operations', () => {
    const src = `${import.meta.dir}/../..`
    const readers = [...new Bun.Glob('**/*.ts').scanSync(src)].filter(
      (file) =>
        !file.endsWith('.test.ts') &&
        !file.endsWith('host-minimum-version.ts') &&
        readFileSync(`${src}/${file}`, 'utf8').includes('host-minimum-version'),
    )

    // #3562: a failed turn also says so; that only adds a line to its error and summary.
    expect(new Set(readers)).toEqual(
      new Set([
        'lib/claude-code-preview/preview-transcript.ts',
        'lib/claude-code-preview/runtime-refusal.ts',
        'lib/agent/channel-wake.ts',
        'lib/claude-code-preview/session-desktops.ts',
      ]),
    )
  })

  test('still opens its desktop and reports its app, with the notice added', async () => {
    const presence = createMemoryPresenceStore()
    const app = { version: '0.125.0' } as LocalRuntimeStatus['app']

    await presence.claim('owner', 'mac', 'c1', {
      conn: 'c1',
      status: { agents: {}, desktopOpen: true, app } as LocalRuntimeStatus,
      seenAt: Date.now(),
    })
    const card = await ownComputer({ userId: 'owner', deviceId: 'mac' }, 'owner', presence)

    expect(card).toMatchObject({ outdated: 'desktop', app })
    expect(card.desktopRuntimeId).toBeString()
  })
})

describe('whether a newer Nuphos is out for a computer', () => {
  const cli = (version: string) => () => Promise.resolve({ version, url: '', body: '' })
  const noFeed = () => Promise.reject(new Error('a Desktop never reads the CLI feed'))

  test('a Desktop is behind when its updater found a newer release', async () => {
    const app = { version: '0.125.0', update: { version: '0.127.0', ready: true } }

    expect(await updateAvailable({ status: { agents, app } }, noFeed)).toBe(true)
  })

  test('a Desktop whose updater found nothing newer counts as current', async () => {
    expect(await updateAvailable({ status: { agents, app: { version: '0.125.0' } } }, noFeed)).toBe(
      false,
    )
    const same = { version: '0.127.0', update: { version: '0.127.0', ready: true } }

    expect(await updateAvailable({ status: { agents, app: same } }, noFeed)).toBe(false)
  })

  test('a CLI host is behind when a newer CLI is released', async () => {
    expect(await updateAvailable({ client: 'nuphos-cli/0.22.0' }, cli('0.23.0'))).toBe(true)
    expect(await updateAvailable({ status: { agents, cliVersion: '0.22.0' } }, cli('0.23.0'))).toBe(
      true,
    )
    expect(await updateAvailable({ client: 'nuphos-cli/0.23.0' }, cli('0.23.0'))).toBe(false)
  })

  test('an unknown host or an unreadable feed is never called behind', async () => {
    expect(await updateAvailable(null, cli('0.23.0'))).toBe(false)
    expect(await updateAvailable({ client: 'nuphos-cli/dev' }, cli('0.23.0'))).toBe(false)
    expect(
      await updateAvailable({ client: 'nuphos-cli/0.22.0' }, () => Promise.resolve(null)),
    ).toBe(false)
  })
})

test('a Bot update hint neither repeats a product error nor exposes a raw error', () => {
  const shown = `A runtime could not start. ${DESKTOP_UPDATE_READY_HINT}`
  const error = new Error(`internal path and RPC detail\n\n${DESKTOP_UPDATE_READY_HINT}`)

  expect(withOutdatedHint(shown, error)).toBe(shown)
  expect(withOutdatedHint(undefined, error)).toBe(DESKTOP_UPDATE_READY_HINT)
  expect(withOutdatedHint(undefined, new Error('internal path'))).toBeUndefined()
})
