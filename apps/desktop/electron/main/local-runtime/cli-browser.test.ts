import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { cliBrowser, createCliBrowser } from './cli-browser.ts'

type Command = { id: number; method: string; params: Record<string, unknown>; sessionId?: string }

/** A Chromium on the far end of the debugging pipe, answering as a real one would. */
function fakeChromium({ failContexts = 0 } = {}) {
  const read = new PassThrough()
  const write = new PassThrough()
  const commands: Command[] = []
  const pages = new Map<string, { url: string; title: string }>()
  let contexts = 0
  let buffer = ''
  const emit = (message: object) => read.write(`${JSON.stringify(message)}\0`)

  write.setEncoding('utf8')
  write.on('data', (chunk: string) => {
    const parts = (buffer + chunk).split('\0')

    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const command = JSON.parse(part) as Command
      const { id, method, params, sessionId } = command
      const targetId = sessionId?.replace('session-', '') ?? ''
      let result: object = {}

      commands.push(command)
      if (method === 'Target.createBrowserContext' && failContexts > 0) {
        failContexts--
        emit({ id, error: { message: 'Failed to create browser context.' } })
        continue
      } else if (method === 'Target.createBrowserContext')
        result = { browserContextId: `ctx-${String(++contexts)}` }
      else if (method === 'Target.createTarget') {
        const created = `target-${String(pages.size + 1)}`

        pages.set(created, { url: 'about:blank', title: '' })
        result = { targetId: created }
      } else if (method === 'Target.attachToTarget')
        result = { sessionId: `session-${params.targetId as string}` }
      else if (method === 'Target.getTargetInfo')
        result = {
          targetInfo: { targetId: params.targetId, ...pages.get(params.targetId as string) },
        }
      else if (method === 'Page.navigate') {
        pages.set(targetId, { url: params.url as string, title: 'Example Domain' })
        emit({ method: 'Page.frameStartedLoading', params: { frameId: targetId }, sessionId })
        result = { frameId: targetId }
        setTimeout(() =>
          emit({ method: 'Page.frameStoppedLoading', params: { frameId: targetId }, sessionId }),
        )
      } else if (method === 'Runtime.evaluate')
        result =
          params.expression === 'throw'
            ? {
                result: {},
                exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: boom' } },
              }
            : String(params.expression).startsWith('finish(')
              ? { result: { value: JSON.stringify([{ ms: 0, key: true, data: 'VlA4' }]) } }
              : { result: { value: 42 } }
      else if (method === 'Page.captureScreenshot') result = { data: 'SlBFRw==' }
      emit({ id, result, ...(sessionId ? { sessionId } : {}) })
    }
  })

  return {
    commands,
    /** Writes `raw` down the pipe as one message, whatever it is. */
    garble: (raw: string) => read.write(`${raw}\0`),
    browser: { read, write, exited: new Promise<void>(() => undefined) },
  }
}

const temp = mkdtempSync(join(tmpdir(), 'cli-browser-test-'))
const call = (session: string, rest: Record<string, unknown>) =>
  ({ team: 't', session, ...rest }) as Parameters<ReturnType<typeof createCliBrowser>>[0]
const textOf = (result: { content: unknown[] }) =>
  (result.content.find((c) => (c as { type: string }).type === 'text') as { text: string }).text

test('a headless browser opens a page, reads it, and screenshots it at the desktop size', async () => {
  const chromium = fakeChromium()
  let launches = 0
  const run = createCliBrowser(() => {
    launches++

    return chromium.browser
  }, temp)

  const opened = JSON.parse(
    textOf(await run(call('s1', { action: 'open', url: 'https://example.com/' }))),
  )

  assert.deepEqual(opened, {
    tab: 1,
    url: 'https://example.com/',
    title: 'Example Domain',
    loading: false,
  })
  assert.deepEqual(
    chromium.commands.find((c) => c.method === 'Emulation.setDeviceMetricsOverride')?.params,
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  )
  assert.equal(textOf(await run(call('s1', { action: 'eval', tab: 1, script: '6*7' }))), '42')
  await assert.rejects(run(call('s1', { action: 'eval', tab: 1, script: 'throw' })), /boom/)

  const shot = await run(call('s1', { action: 'screenshot', tab: 1 }))

  assert.deepEqual(shot.content[0], { type: 'image', mimeType: 'image/jpeg', data: 'SlBFRw==' })
  assert.equal(launches, 1)
})

test('a conversation sees and drives only the tabs it opened', async () => {
  const run = createCliBrowser(() => fakeChromium().browser, temp)

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  assert.equal(textOf(await run(call('s2', { action: 'tabs' }))), '[]')
  const other = await run(call('s2', { action: 'screenshot', tab: 1 }))

  assert.equal(other.isError, true)
  assert.match(textOf(other), /not one this conversation opened/)
})

test('record_stop writes the tab traffic as HAR through the shared recorder', async () => {
  const chromium = fakeChromium()
  const run = createCliBrowser(() => chromium.browser, temp)

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  await run(call('s1', { action: 'record_start', tab: 1 }))
  assert.ok(
    chromium.commands.some(
      (c) => c.method === 'Network.enable' && c.sessionId === 'session-target-1',
    ),
  )
  const stopped = JSON.parse(textOf(await run(call('s1', { action: 'record_stop', tab: 1 })))) as {
    file: string
  }

  assert.equal(
    (JSON.parse(readFileSync(stopped.file, 'utf8')) as { log: { version: string } }).log.version,
    '1.2',
  )
})

test('show answers that the computer has no screen', async () => {
  const run = createCliBrowser(() => fakeChromium().browser, temp)

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  const shown = await run(call('s1', { action: 'show', tab: 1 }))

  assert.equal(shown.isError, true)
  assert.match(textOf(shown), /without a screen/)
})

test('a computer offers local_browser only when it has a Chromium to run it on', () => {
  assert.deepEqual(cliBrowser(temp, undefined), {})
  assert.equal(typeof cliBrowser(temp, '/usr/bin/chromium').connectBrowser, 'function')
})

test("each conversation's tabs get their own browser context, dropped with its last tab", async () => {
  const chromium = fakeChromium()
  const run = createCliBrowser(() => chromium.browser, temp)
  const contextOf = (n: number) =>
    chromium.commands.filter((c) => c.method === 'Target.createTarget')[n]?.params.browserContextId

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  await run(call('s2', { action: 'open', url: 'https://example.com/' }))
  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  assert.deepEqual([contextOf(0), contextOf(1), contextOf(2)], ['ctx-1', 'ctx-2', 'ctx-1'])

  const disposed = () =>
    chromium.commands
      .filter((c) => c.method === 'Target.disposeBrowserContext')
      .map((c) => c.params.browserContextId)

  await run(call('s1', { action: 'close', tab: 1 }))
  assert.deepEqual(disposed(), [])
  await run(call('s1', { action: 'close', tab: 3 }))
  assert.deepEqual(disposed(), ['ctx-1'])
})

test('a conversation may keep only so many tabs open', async () => {
  const run = createCliBrowser(() => fakeChromium().browser, temp)

  for (let i = 0; i < 10; i++)
    assert.notEqual(
      (await run(call('s1', { action: 'open', url: 'https://example.com/' }))).isError,
      true,
    )
  const refused = await run(call('s1', { action: 'open', url: 'https://example.com/' }))

  assert.equal(refused.isError, true)
  assert.match(textOf(refused), /10 tabs/)
  assert.notEqual(
    (await run(call('s2', { action: 'open', url: 'https://example.com/' }))).isError,
    true,
  )
})

test('a garbled message from the browser is skipped, not thrown', async () => {
  const chromium = fakeChromium()
  const run = createCliBrowser(() => chromium.browser, temp)

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  chromium.garble('not json')
  assert.equal(textOf(await run(call('s1', { action: 'eval', tab: 1, script: '6*7' }))), '42')
})

test('a browser context that failed to be created is created again on the next open', async () => {
  const run = createCliBrowser(() => fakeChromium({ failContexts: 1 }).browser, temp)

  await assert.rejects(
    run(call('s1', { action: 'open', url: 'https://example.com/' })),
    /browser context/,
  )
  assert.notEqual(
    (await run(call('s1', { action: 'open', url: 'https://example.com/' }))).isError,
    true,
  )
})

test('opens still in flight count toward the tab cap and keep their context alive', async () => {
  const chromium = fakeChromium()
  const run = createCliBrowser(() => chromium.browser, temp)
  const opens = Array.from({ length: 11 }, () =>
    run(call('s1', { action: 'open', url: 'https://example.com/' })),
  )

  assert.equal((await Promise.all(opens)).filter((r) => r.isError).length, 1)

  const other = createCliBrowser(() => chromium.browser, temp)

  await other(call('s2', { action: 'open', url: 'https://example.com/' }))
  // Its only tab closes while a second one is still opening: the context must stay.
  const opening = other(call('s2', { action: 'open', url: 'https://example.com/' }))

  await other(call('s2', { action: 'close', tab: 1 }))
  await opening
  assert.ok(!chromium.commands.some((c) => c.method === 'Target.disposeBrowserContext'))
})

test('record_start with video records the tab from a helper window and record_stop returns a WebM', async () => {
  const chromium = fakeChromium()
  const run = createCliBrowser(() => chromium.browser, temp)

  await run(call('s1', { action: 'open', url: 'https://example.com/' }))
  await run(call('s1', { action: 'record_start', tab: 1, video: true }))
  // Its own window, so the recorded tab stays in front and keeps painting.
  assert.ok(
    chromium.commands.some(
      (c) => c.method === 'Target.createTarget' && c.params.newWindow === true,
    ),
  )
  assert.ok(
    chromium.commands.some(
      (c) => c.method === 'Page.startScreencast' && c.sessionId === 'session-target-1',
    ),
  )
  const stopped = JSON.parse(textOf(await run(call('s1', { action: 'record_stop', tab: 1 })))) as {
    video: { file: string }
  }

  assert.equal(readFileSync(stopped.video.file).subarray(0, 4).toString('hex'), '1a45dfa3')
  assert.ok(chromium.commands.some((c) => c.method === 'Target.closeTarget'))
})
