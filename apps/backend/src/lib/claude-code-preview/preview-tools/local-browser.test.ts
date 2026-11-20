import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import type { AgentConversation } from '@/lib/agent/db'
import type { TeamMembership } from '@/lib/identity/types'
import { describe, expect, test } from 'bun:test'

import { createLocalBrowserHandler, localBrowserToolModule } from './local-browser'
import { fillScript } from './local-browser-fill'

import type { DeviceToolDeps } from './device-tool'
import type { PreviewToolContext } from '../preview-tool-context'

const conversationAccess = useAgentDb({
  getConversationBySessionId: () =>
    Promise.resolve({
      sessionId: 's1',
      userId: 'owner',
      teamId: 't1',
      participantIds: ['u1'],
    } as AgentConversation),
})

useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as TeamMembership) })

type Listener = (event: { data?: unknown }) => void

const ctx: PreviewToolContext = {
  userId: 'u1',
  teamId: 't1',
  sessionId: 's1',
  turnKey: 'turn-1',
  locale: 'en',
}

/** A device that answers every call with `result`, recording the purpose and frames. */
function device(result: unknown) {
  const opened: { purpose: string; sent: Record<string, unknown>[] }[] = []
  const connect: DeviceToolDeps['connect'] = (_ctx, _deviceId, _owner, purpose) => {
    const listeners = new Map<string, Listener[]>()
    const emit = (type: string, data?: unknown) => {
      for (const listener of listeners.get(type) ?? [])
        listener(data === undefined ? {} : { data: JSON.stringify(data) })
    }
    const record = { purpose, sent: [] as Record<string, unknown>[] }

    opened.push(record)

    return {
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      send: (data: string) => {
        record.sent.push(JSON.parse(data) as Record<string, unknown>)
        emit('message', { t: 'result', result })
      },
      close: () => {},
      connect: async () => {
        emit('open')
      },
    }
  }

  return { opened, connect }
}

function deps(overrides: Partial<DeviceToolDeps>): DeviceToolDeps {
  return {
    devices: async () => [{ deviceId: 'mac', label: 'MacBook' }],
    isMember: async () => true,
    owner: async () => 'host-owner',
    connect: device(null).connect,
    approve: async () => false,
    publish: async () => {},
    audit: async () => {},
    timeoutMs: 1_000,
    ...overrides,
  }
}

describe('local_browser', () => {
  test('sends the action to the browser stream with the team, and returns the result', async () => {
    const tabs = { content: [{ type: 'text' as const, text: '[{"tab":7}]' }] }
    const fake = device(tabs)
    const audits: string[] = []

    const result = await createLocalBrowserHandler(
      ctx,
      deps({
        connect: fake.connect,
        audit: async (entry) => {
          audits.push(entry.command)
        },
      }),
    )({ action: 'eval', tab: 7, script: 'document.title' })

    expect(result).toEqual(tabs)
    expect(fake.opened).toHaveLength(1)
    expect(fake.opened[0]?.purpose).toBe('browser')
    expect(fake.opened[0]?.sent[0]).toEqual({
      t: 'call',
      session: 's1',
      turn: 'turn-1',
      action: 'eval',
      team: 't1',
      tab: 7,
      script: 'document.title',
    })

    expect(audits).toEqual([
      '[browser] eval tab=7 document.title',
      '[browser] eval tab=7 document.title',
    ])
  })

  test('rejects an incomplete call before touching the device', async () => {
    const fake = device(null)
    const handler = createLocalBrowserHandler(ctx, deps({ connect: fake.connect }))

    expect((await handler({ action: 'eval', script: '1' })).isError).toBe(true)
    expect((await handler({ action: 'open' })).isError).toBe(true)
    expect((await handler({ action: 'click' })).isError).toBe(true)
    expect((await handler({ action: 'record_start' })).isError).toBe(true)
    expect((await handler({ action: 'record_stop' })).isError).toBe(true)
    expect(fake.opened).toHaveLength(0)
  })

  test("opens on the user's own screen when a Nuphos computer is also selected", async () => {
    const targets: string[] = []
    const fake = device(null)
    const connect: DeviceToolDeps['connect'] = (c, deviceId, owner, purpose) => {
      targets.push(deviceId)

      return fake.connect(c, deviceId, owner, purpose)
    }
    const devices = async () => [
      { deviceId: 'box', label: 'Computer 1', box: true },
      { deviceId: 'mac', label: 'MacBook' },
    ]
    const handler = createLocalBrowserHandler(ctx, deps({ devices, connect }))

    await handler({ action: 'open', url: 'https://dash.cloudflare.com/login' })
    // Naming the Box still reaches it.
    await handler({ action: 'tabs', device: 'box' })

    expect(targets).toEqual(['mac', 'box'])
  })

  test('opens the tab in the channel that woke the turn, only when exactly one did', async () => {
    const docks: unknown[] = []

    for (const asked of [['channel-1'], [], ['channel-1', 'channel-2']]) {
      const fake = device(null)

      await createLocalBrowserHandler(
        ctx,
        deps({ connect: fake.connect }),
        async () => asked,
      )({
        action: 'open',
        url: 'https://example.com',
      })
      docks.push(fake.opened[0]?.sent[0]?.dock)
    }

    expect(docks).toEqual(['channel-1', undefined, undefined])
  })

  test('looks up the asking channel only for open', async () => {
    let lookups = 0
    const handler = createLocalBrowserHandler(ctx, deps({}), async () => {
      lookups += 1

      return ['channel-1']
    })

    await handler({ action: 'tabs' })

    expect(lookups).toBe(0)
  })

  test('tells the agent to open a named site and sign-in pages itself', () => {
    const description = String(
      (localBrowserToolModule.definitions[0] as { description?: string }).description,
    )

    expect(description).toContain(
      'A site or app named by the user ("open up TikTok") means its official URL (https://www.tiktok.com)',
    )

    expect(description).toContain(
      'open that login or sign-up page here yourself, sub-agents included',
    )
  })

  test('describes a computer running only nuphos agent as well as Desktop (#4055)', () => {
    const description = String(
      (localBrowserToolModule.definitions[0] as { description?: string }).description,
    )

    expect(description).toContain('a headless Chromium')
    expect(description).toContain('each conversation starts signed out')
    expect(description).toContain('show and fill are refused there')
  })
})

test('an authorized teammate can use the selected conversation browser', async () => {
  const tabs = { content: [{ type: 'text' as const, text: '[]' }] }
  const fake = device(tabs)
  const actors: string[] = []
  const result = await createLocalBrowserHandler(
    { ...ctx, conversationOwnerUserId: 'conversation-owner' },
    deps({
      connect: fake.connect,
      audit: async (entry) => {
        actors.push(entry.actorUserId)
      },
    }),
  )({ action: 'tabs' })

  expect(result).toEqual(tabs)
  expect(actors).toEqual(['u1', 'u1'])
})

test('removing a teammate stops the next browser call in the same turn', async () => {
  let participants = ['u1']

  conversationAccess({
    getConversationBySessionId: () =>
      Promise.resolve({
        sessionId: 's1',
        userId: 'owner',
        teamId: 't1',
        generalAccess: 'none',
        participantIds: participants,
      } as AgentConversation),
  })
  const tabs = { content: [{ type: 'text' as const, text: '[]' }] }
  const fake = device(tabs)
  const handler = createLocalBrowserHandler(
    { ...ctx, conversationOwnerUserId: 'owner' },
    deps({ connect: fake.connect }),
  )

  expect(await handler({ action: 'tabs' })).toEqual(tabs)
  participants = []

  await expect(handler({ action: 'tabs' })).rejects.toMatchObject({
    code: 'conversation_read_only',
  })
  expect(fake.opened).toHaveLength(1)
})

describe('local_browser fill', () => {
  // A value no selector, path or label could contain by accident.
  const VALUE = 'A123-secret-value-456'
  const SITE = 'www.clinic.example'
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- A path the tool is given as text; no file is opened.
  const path = '/tmp/nuphos-secret-Ab12Cd/0/NATIONAL_ID'
  const filled = {
    content: [{ type: 'text' as const, text: '[{"selector":"#id","filled":true}]' }],
  }
  const saved = () => Promise.resolve({ value: VALUE, site: SITE })

  test('the value reaches only the page: never the transcript, the audit log or the result', async () => {
    const fake = device(filled)
    const frames: unknown[] = []
    const audits: unknown[] = []
    const read: string[] = []

    const result = await createLocalBrowserHandler(
      ctx,
      deps({
        connect: fake.connect,
        publish: (_ctx, frame) => {
          frames.push(frame)

          return Promise.resolve()
        },
        audit: (entry) => {
          audits.push(entry)

          return Promise.resolve()
        },
      }),
      undefined,
      (_ctx, asked) => {
        read.push(asked)

        return saved()
      },
    )({ action: 'fill', tab: 7, fields: [{ selector: '#id', path }] })

    expect(read).toEqual([path])
    // The device runs it as an ordinary eval, so every Desktop that has local_browser can fill.
    const sent = fake.opened[0]?.sent[0] as { action: string; tab: number; script: string }

    expect(sent.action).toBe('eval')
    expect(sent.tab).toBe(7)
    expect(sent.script).toContain(JSON.stringify(VALUE))
    expect(sent).not.toHaveProperty('fields')

    // What the conversation stores (the call's input and output) names the file, not its content.
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({
      type: 'tool-input-available',
      input: { action: 'fill', tab: 7, fields: [{ selector: '#id', path }] },
    })
    expect(JSON.stringify(frames)).not.toContain(VALUE)
    expect(JSON.stringify(audits)).not.toContain(VALUE)
    expect((audits as { command: string }[]).map((entry) => entry.command)).toEqual([
      `[browser] fill tab=7 #id <- ${path}`,
      `[browser] fill tab=7 #id <- ${path}`,
    ])
    expect(result).toEqual(filled)
    expect(JSON.stringify(result)).not.toContain(VALUE)
  })

  test('reads only files the secure input card saved, and refuses before touching the device', async () => {
    const fake = device(filled)
    const read: string[] = []
    const handler = createLocalBrowserHandler(
      ctx,
      deps({ connect: fake.connect }),
      undefined,
      (_ctx, asked) => {
        read.push(asked)

        return saved()
      },
    )

    // eslint-disable-next-line sonarjs/publicly-writable-directories -- Paths the tool must refuse, given as text; no file is opened.
    for (const other of ['/workspace/.env', '/etc/passwd', '/tmp/nuphos-secret-x/NAME', 'NAME'])
      expect(
        (await handler({ action: 'fill', tab: 7, fields: [{ selector: '#id', path: other }] }))
          .isError,
      ).toBe(true)
    expect((await handler({ action: 'fill', tab: 7 })).isError).toBe(true)
    expect((await handler({ action: 'fill', tab: 7, fields: [] })).isError).toBe(true)
    expect((await handler({ action: 'fill', fields: [{ selector: '#id', path }] })).isError).toBe(
      true,
    )
    expect(read).toEqual([])
    expect(fake.opened).toHaveLength(0)
  })

  test('a saved file that cannot be read fails the call without asking the device', async () => {
    const fake = device(filled)
    const result = await createLocalBrowserHandler(
      ctx,
      deps({ connect: fake.connect }),
      undefined,
      () => Promise.reject(new Error(`could not read ${VALUE}`)),
    )({ action: 'fill', tab: 7, fields: [{ selector: '#id', path }] })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain(VALUE)
    expect(fake.opened).toHaveLength(0)
  })

  test('a file no card asked for with a site is never filled, nor read', async () => {
    // The conversation keeps no site for this path: it came from a single-secret card, or the agent made it.
    conversationAccess({
      getReadableConversation: () =>
        Promise.resolve({
          sessionId: 's1',
          userId: 'u1',
          teamId: 't1',
          runtimeId: 'r1',
          secretSites: [{ path: `${path}-other`, site: SITE }],
        } as AgentConversation),
    })
    const fake = device(filled)
    const result = await createLocalBrowserHandler(
      ctx,
      deps({ connect: fake.connect }),
    )({
      action: 'fill',
      tab: 7,
      fields: [{ selector: '#id', path }],
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('not saved for a website')
    expect(fake.opened).toHaveLength(0)
  })

  test('values asked for different sites are not filled in one call', async () => {
    const fake = device(filled)
    const result = await createLocalBrowserHandler(
      ctx,
      deps({ connect: fake.connect }),
      undefined,
      (_ctx, asked) =>
        Promise.resolve({ value: VALUE, site: asked === path ? SITE : 'other.example' }),
    )({
      action: 'fill',
      tab: 7,
      fields: [
        { selector: '#id', path },
        { selector: '#dob', path: `${path}_2` },
      ],
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain(VALUE)
    expect(fake.opened).toHaveLength(0)
  })

  /** Runs the page script against a stand-in page at `origin`, as the tab would. */
  function onPage(origin: string, site = SITE) {
    const events: string[] = []
    const input = {
      value: '',
      dispatchEvent: (event: Event) => {
        events.push(event.type)

        return true
      },
    }
    const page = { querySelector: (selector: string) => (selector === '#id' ? input : null) }
    const script = fillScript(
      [
        { selector: '#id', value: VALUE },
        { selector: '#missing', value: 'x' },
      ],
      site,
    )
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- Runs the script this module builds against a stand-in page, as the tab would.
    const run = new Function('document', 'location', `return ${script}`) as (
      document: unknown,
      location: unknown,
    ) => unknown

    return { input, events, report: run(page, { origin }) }
  }

  test('the page script sets each input as typing does and reports no value', () => {
    const { input, events, report } = onPage('https://www.clinic.example')

    expect(input.value).toBe(VALUE)
    expect(events).toEqual(['input', 'change'])
    expect(report).toEqual([
      { selector: '#id', filled: true },
      { selector: '#missing', filled: false, reason: 'no element matches' },
    ])
    expect(JSON.stringify(report)).not.toContain(VALUE)
  })

  test('a tab that is not on the site the card named is refused and nothing is entered', () => {
    for (const origin of [
      // Another site, a redirect's target included: the page's own origin is what counts.
      'https://evil.example',
      // Not a match by containing or ending with the name.
      'https://www.clinic.example.evil.example',
      'https://evilwww.clinic.example',
      'https://clinic.example',
      // The whole origin: scheme and port too.
      'http://www.clinic.example',
      'https://www.clinic.example:8443',
      // A sandboxed or data page has no origin to match.
      'null',
    ]) {
      const { input, events, report } = onPage(origin)

      expect(input.value).toBe('')
      expect(events).toEqual([])
      expect(report).toEqual({
        refused: `This tab is on ${origin}, not www.clinic.example, the site the card named. Nothing was entered.`,
      })
      expect(JSON.stringify(report)).not.toContain(VALUE)
    }
  })

  test('a site with a port matches only that port, and plain HTTP only on this computer', () => {
    expect(onPage('https://www.clinic.example:8443', 'www.clinic.example:8443').input.value).toBe(
      VALUE,
    )
    expect(onPage('https://www.clinic.example', 'www.clinic.example:8443').input.value).toBe('')
    expect(onPage('http://localhost:5199', 'localhost:5199').input.value).toBe(VALUE)
    expect(onPage('http://localhost:5200', 'localhost:5199').input.value).toBe('')
  })
})
