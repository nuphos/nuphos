import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { cliBrowser, createCliBrowser } from './cli-browser.ts'

type Command = { id: number; method: string; params: Record<string, unknown>; sessionId?: string }

/** A Chromium on the far end of the debugging pipe, answering as a real one would. */
function fakeChromium() {
  const read = new PassThrough()
  const write = new PassThrough()
  const commands: Command[] = []
  const pages = new Map<string, { url: string; title: string }>()
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
      if (method === 'Target.createTarget') {
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
            : { result: { value: 42 } }
      else if (method === 'Page.captureScreenshot') result = { data: 'SlBFRw==' }
      emit({ id, result, ...(sessionId ? { sessionId } : {}) })
    }
  })

  return {
    commands,
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
