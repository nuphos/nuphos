import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import {
  MINIMUM_HOST_VERSION,
  hostOutdated,
  DESKTOP_UPDATE_READY_HINT,
  hostUpdateHint,
  withOutdatedHint,
} from './host-minimum-version'
import { ownComputer } from './session-desktops'

import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/host-minimum-version.test.ts

const agents = {}

describe('the oldest Nuphos a computer may run', () => {
  test('a Desktop below the floor is out of date, one at it is not', () => {
    // #5081: before 0.133.2 a downloaded update waits for someone to quit Nuphos by hand.
    expect(hostOutdated({ client: 'nuphos-desktop/0.119.2' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.124.0' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.126.0' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.132.0' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.133.1' })).toBe('desktop')
    expect(hostOutdated({ client: 'nuphos-desktop/0.133.2' })).toBeUndefined()
    expect(hostOutdated({ client: 'nuphos-desktop/0.137.0' })).toBeUndefined()
    expect(MINIMUM_HOST_VERSION.desktop).toBe('0.133.2')
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
        'lib/agent/reply-failed.ts',
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

test('a Bot update hint neither repeats a product error nor exposes a raw error', () => {
  const shown = `A runtime could not start. ${DESKTOP_UPDATE_READY_HINT}`
  const error = new Error(`internal path and RPC detail\n\n${DESKTOP_UPDATE_READY_HINT}`)

  expect(withOutdatedHint(shown, error)).toBe(shown)
  expect(withOutdatedHint(undefined, error)).toBe(DESKTOP_UPDATE_READY_HINT)
  expect(withOutdatedHint(undefined, new Error('internal path'))).toBeUndefined()
})

test('an update hint names the host and preserves the known sentence without raw diagnostics', async () => {
  const hint = await hostUpdateHint({ client: 'nuphos-desktop/0.123.0' }, 'Build Mac')

  expect(hint).toBe(
    "Nuphos Desktop on Build Mac is out of date. Open Settings → Updates to get the update, then quit Nuphos fully (⌘Q on a Mac) and reopen it. If it doesn't close, quit it again.",
  )
  expect(withOutdatedHint(undefined, new Error(`private diagnostic\n\n${hint}`))).toBe(hint)
})

test('an update hint inserts a host label literally, on one short line', async () => {
  const hint = await hostUpdateHint(
    { client: 'nuphos-desktop/0.123.0' },
    ` $& Mac\n${'x'.repeat(200)}`,
  )

  expect(hint).toStartWith('Nuphos Desktop on $& Mac x')
  expect(hint).not.toContain('\n')
  expect(hint).toContain(`${'x'.repeat(73)} is out of date.`)
  expect(hint).not.toContain(`${'x'.repeat(74)} is out of date.`)
  expect(withOutdatedHint(undefined, new Error(`raw\n\n${hint}`))).toBe(hint)
})
