// The headless Chromium behind `nuphos agent`'s `local_browser` (cli-browser.ts), and its
// debugging pipe: JSON messages ended by NUL on fds 3 and 4, so no port is opened.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { RecordedTab } from './browser-recording.ts'
import type { Readable, Writable } from 'node:stream'

/** The browser's ends of its debugging pipe, and its lifetime. */
export type Browser = { read: Readable; write: Writable; exited: Promise<void> }
type Message = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  sessionId?: string
  result?: unknown
  error?: { message: string }
}
export type Listener = (method: string, params: Record<string, unknown>, sessionId?: string) => void

const NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** One debugging connection: commands answered by id, events to the listeners. */
export class Cdp {
  readonly listeners = new Set<Listener>()
  private readonly pending = new Map<
    number,
    { resolve: (v: never) => void; reject: (e: Error) => void }
  >()
  private next = 0
  private buffer = ''

  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
    browser.read.setEncoding('utf8')
    browser.read.on('data', (chunk: string) => {
      const parts = (this.buffer + chunk).split('\0')

      this.buffer = parts.pop() ?? ''
      for (const part of parts) {
        let message: Message

        try {
          message = JSON.parse(part) as Message
        } catch {
          continue // Not a message; the next one still is.
        }
        this.receive(message)
      }
    })
  }

  send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.next

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.browser.write.write(`${JSON.stringify({ id, method, params, sessionId })}\0`)
    })
  }

  end(): void {
    for (const { reject } of this.pending.values()) reject(new Error('The browser exited.'))
    this.pending.clear()
  }

  private receive(message: Message): void {
    const waiting = message.id === undefined ? undefined : this.pending.get(message.id)

    if (waiting) {
      this.pending.delete(message.id!)
      if (message.error) waiting.reject(new Error(message.error.message))
      else waiting.resolve(message.result as never)
    } else if (message.method)
      for (const listener of this.listeners)
        listener(message.method, message.params ?? {}, message.sessionId)
  }
}

/** The first Chromium on PATH (or Chrome on a Mac), which `nuphos agent` drives headless. */
export function findBrowser(env = process.env): string | undefined {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)

  for (const name of NAMES)
    for (const dir of dirs) if (existsSync(join(dir, name))) return join(dir, name)

  return process.platform === 'darwin' && existsSync(MAC_CHROME) ? MAC_CHROME : undefined
}

/** A headless Chromium on its own profile; it quits when the host does, as its pipe closes. */
export function launchChromium(executable: string, profile: string): Browser {
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
  ]

  // Chromium will not start as root with its sandbox, as `nuphos agent` may run on a server.
  if (process.getuid?.() === 0) args.push('--no-sandbox')
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const write = child.stdio[3] as Writable
  const read = child.stdio[4] as Readable

  // A browser that dies resets its pipes: its exit ends the connection (cli-browser.ts), and an
  // unheard error here would take `nuphos agent` down with it.
  write.on('error', () => {})
  read.on('error', () => {})

  return {
    write,
    read,
    exited: new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    }),
  }
}

/** A page's side of the shared HAR recorder (browser-recording.ts), over its debugging session. */
export function recorder(cdp: Cdp, sessionId: string): RecordedTab['debugger'] {
  type OnMessage = Parameters<RecordedTab['debugger']['on']>[1]
  const forwards = new Map<OnMessage, Listener>()

  return {
    attach: () => {},
    // Recording ends with the page's network events off again.
    detach: () => void cdp.send('Network.disable', {}, sessionId).catch(() => {}),
    isAttached: () => true,
    sendCommand: (method, params) => cdp.send(method, params, sessionId),
    on: (_event, listener) => {
      const forward: Listener = (method, params, from) => {
        if (from === sessionId) listener({}, method, params)
      }

      forwards.set(listener, forward)
      cdp.listeners.add(forward)
    },
    off: (_event, listener) => {
      cdp.listeners.delete(forwards.get(listener)!)
      forwards.delete(listener)
    },
  }
}
