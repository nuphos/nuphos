import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { runBrowserCall as RunBrowserCall } from './browser-tabs.ts'
import type { BrowserCall } from './browser-stream.ts'

type Tab = { id: string; kind: string; title: string; href: string; url?: string }

/** One app window; its renderer answers as the workspace store would, and records what it was asked. */
function appWindow(docks: Record<string, Tab[]>) {
  const asked: string[] = []
  const window = {
    asked,
    sent: [] as unknown[][],
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    isVisible: () => true,
    show: () => {},
    focus: () => {},
    webContents: {
      send: (...args: unknown[]) => window.sent.push(args),
      executeJavaScript: async (script: string) => {
        const [, fn = '', rawArgs = ''] =
          /^window\.(\w+)\?\.\((.*)\) \?\? null$/s.exec(script) ?? []
        const args = JSON.parse(`[${rawArgs}]`) as unknown[]
        const session = String(args[0])

        asked.push(fn)
        if (fn === 'nuphosDockMirror')
          return {
            tabs: docks[session] ?? [],
            activeTabId: docks[session]?.[0]?.id ?? null,
            recent: [{ href: '/teams/t/runtimes', title: 'Runtimes' }],
          }
        if (fn === 'nuphosCloseDockTab') {
          const before = docks[session]?.length ?? 0

          docks[session] = (docks[session] ?? []).filter((tab) => tab.id !== args[1])

          return docks[session].length < before
        }
        if (fn === 'nuphosOpenDockTab') return 'new-tab'

        return null
      },
    },
  }

  return window
}

const browser: Tab = {
  id: 'b1',
  kind: 'team.browser',
  title: 'Create your account',
  href: '/teams/t/browser?url=https%3A%2F%2Fexample.com%2Fsignup',
  url: 'https://example.com/signup',
}
const terminal: Tab = {
  id: 'term',
  kind: 'team.terminal',
  title: 'Local terminal',
  href: '/teams/t/terminal',
}
let window = appWindow({})
let runBrowserCall: typeof RunBrowserCall

before(async () => {
  mock.module('electron', {
    namedExports: {
      app: { on: () => {}, off: () => {} },
      BrowserWindow: { getAllWindows: () => [window] },
      ipcMain: { on: () => {} },
      net: { request: () => ({}) },
      session: { fromPartition: () => ({}) },
      webContents: { getAllWebContents: () => [] },
    },
  })
  mock.module('../browser-extensions/host.ts', { namedExports: { extensionHost: () => null } })
  mock.module('../browser-extensions/manage.ts', { namedExports: { browserSession: () => ({}) } })
  ;({ runBrowserCall } = await import('./browser-tabs.ts'))
})

const call = (fields: Partial<BrowserCall>): BrowserCall => ({
  action: 'dock',
  team: 't',
  session: 'mine',
  ...fields,
})
const answer = async (fields: Partial<BrowserCall>) => {
  const result = await runBrowserCall(call(fields))
  const text = (result.content as { text: string }[])[0]?.text ?? 'null'

  return { result, value: result.isError ? text : (JSON.parse(text) as unknown) }
}

test("dock mirrors the conversation's whole dock, any page, with the front tab and Recent", async () => {
  window = appWindow({ mine: [browser, terminal], other: [{ ...terminal, id: 'x' }] })

  assert.deepEqual((await answer({})).value, {
    tabs: [browser, terminal],
    activeTabId: 'b1',
    recent: [{ href: '/teams/t/runtimes', title: 'Runtimes' }],
  })
})

test('focus shows any kind of dock tab, only one in this conversation', async () => {
  window = appWindow({ mine: [browser, terminal] })

  assert.equal(
    (await answer({ action: 'focus', session: 'other', dockTab: 'term' })).result.isError,
    true,
  )
  assert.deepEqual(window.sent, [])
  assert.equal((await answer({ action: 'focus', dockTab: 'term' })).result.isError, undefined)
  assert.deepEqual(window.sent, [
    ['agent:focus-session', { sessionId: 'mine', teamId: 't', dockTab: 'term' }],
  ])
})

test("close closes the conversation's own dock tab and nothing else", async () => {
  const docks = { mine: [browser, terminal], other: [{ ...terminal, id: 'theirs' }] }

  window = appWindow(docks)
  assert.equal((await answer({ action: 'close', dockTab: 'theirs' })).result.isError, true)
  assert.deepEqual((await answer({ action: 'close', dockTab: 'b1' })).value, { closed: 'b1' })
  assert.deepEqual(
    docks.mine.map((tab) => tab.id),
    ['term'],
  )
  assert.equal(docks.other.length, 1)
})

test('dock_open opens an app path or a workspace page, and needs one of them', async () => {
  window = appWindow({ mine: [] })

  assert.deepEqual((await answer({ action: 'dock_open', href: '/teams/t/files' })).value, {
    id: 'new-tab',
  })
  assert.deepEqual((await answer({ action: 'dock_open', page: 'team.plans' })).value, {
    id: 'new-tab',
  })
  assert.equal((await answer({ action: 'dock_open' })).result.isError, true)
})
