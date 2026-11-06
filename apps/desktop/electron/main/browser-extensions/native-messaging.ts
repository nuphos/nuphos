// Native messaging, only between a known password manager's extension and its own
// desktop app. It speaks the package's preload protocol (`crx-native-msg-<id>`).
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ChildProcess } from 'node:child_process'

/** The hosts an extension may start: host name → the extension IDs it serves. */
export const ALLOWED_HOSTS: Readonly<Record<string, readonly string[]>> = {
  // 1Password and 1Password Beta from the Chrome Web Store.
  'com.1password.1password': [
    'aeblfdkhhhdcdjpifhhbdiojplfjncoa',
    'khgocmkkpikpnmmkgmdnfckapcdkgfaf',
  ],
}

/** Chrome's cap on one message from a host. */
const MAX_FROM_HOST = 1024 * 1024

/** Where Chrome and Chromium read host manifests, system-wide first. */
export function manifestDirs(platform = process.platform, home = os.homedir()): string[] {
  if (platform === 'darwin')
    return [
      '/Library/Google/Chrome/NativeMessagingHosts',
      '/Library/Application Support/Chromium/NativeMessagingHosts',
      path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts'),
    ]
  if (platform === 'linux')
    return [
      '/etc/opt/chrome/native-messaging-hosts',
      '/etc/chromium/native-messaging-hosts',
      path.join(home, '.config/google-chrome/NativeMessagingHosts'),
      path.join(home, '.config/chromium/NativeMessagingHosts'),
    ]

  // Windows lists hosts in the registry; not supported yet.
  return []
}

/** The program to start for `host`, if `extensionId` may start it. Like Chrome, the first manifest found decides. */
export async function findHost(
  host: string,
  extensionId: string,
  dirs: string[],
): Promise<string | null> {
  if (!Object.hasOwn(ALLOWED_HOSTS, host) || !ALLOWED_HOSTS[host].includes(extensionId)) return null
  for (const dir of dirs) {
    let text: string

    try {
      text = await readFile(path.join(dir, `${host}.json`), 'utf8')
    } catch {
      continue
    }
    try {
      const manifest = JSON.parse(text) as Record<string, unknown>

      return manifest.name === host &&
        manifest.type === 'stdio' &&
        typeof manifest.path === 'string' &&
        path.isAbsolute(manifest.path) &&
        Array.isArray(manifest.allowed_origins) &&
        manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`)
        ? manifest.path
        : null
    } catch {
      return null
    }
  }

  return null
}

/** One message as Chrome frames it: a 4-byte little-endian length, then UTF-8 JSON. */
export function encode(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message ?? null), 'utf8')
  const head = Buffer.alloc(4)

  head.writeUInt32LE(body.length)

  return Buffer.concat([head, body])
}

/** Splits a host's output into messages, across or within chunks. Throws on a bad frame. */
export function decoder(onMessage: (message: unknown) => void) {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  let pending = Buffer.alloc(0)

  return (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0)

      if (length > MAX_FROM_HOST) throw new Error('native message too large')
      if (pending.length < 4 + length) return
      const body = pending.subarray(4, 4 + length)

      pending = pending.subarray(4 + length)
      onMessage(JSON.parse(utf8.decode(body)))
    }
  }
}

/** A page's WebContents or a service worker: what the package's router passes as `sender`. */
export type Sender = {
  send: (channel: string, ...args: unknown[]) => void
  ipc: {
    on: (channel: string, listener: (event: unknown, message: unknown) => void) => void
    off: (channel: string, listener: (event: unknown, message: unknown) => void) => void
  }
} & ({ scope: string } | { getURL: () => string })

type Event = { sender: Sender; extension: { id: string } }

/**
 * The calling extension, from the sender's own origin. The router takes the ID from
 * the message, so any extension page could otherwise claim to be another.
 */
function caller(event: Event): string {
  const url = 'scope' in event.sender ? event.sender.scope : event.sender.getURL()
  const { protocol, host } = new URL(url)

  if (protocol !== 'chrome-extension:' || host !== event.extension.id)
    throw new Error('native messaging is only for an extension’s own pages')

  return host
}

function start(program: string, extensionId: string): ChildProcess {
  return spawn(program, [`chrome-extension://${extensionId}/`], {
    cwd: path.dirname(program),
    stdio: ['pipe', 'pipe', 'ignore'],
  })
}

/** `runtime.connectNative`, `disconnectNative` and `sendNativeMessage` for the package's router. */
export function nativeMessaging(dirs: string[]) {
  const ports = new Map<string, { extensionId: string; close: () => void }>()

  const connectNative = async (event: Event, connectionId: unknown, host: unknown) => {
    const extensionId = caller(event)

    if (typeof connectionId !== 'string' || typeof host !== 'string' || ports.has(connectionId))
      throw new Error('bad native connection')
    const channel = `crx-native-msg-${connectionId}`
    const { sender } = event
    let child: ChildProcess | null = null
    // Extensions post right after connecting, before the host has started.
    const early: Buffer[] = []
    const fromExtension = (_event: unknown, message: unknown) => {
      if (child) child.stdin?.write(encode(message))
      else early.push(encode(message))
    }
    const close = () => {
      if (!ports.delete(connectionId)) return
      sender.ipc.off(channel, fromExtension)
      child?.kill()
      try {
        sender.send(`${channel}-disconnect`)
      } catch {
        // The page or worker is already gone.
      }
    }

    ports.set(connectionId, { extensionId, close })
    sender.ipc.on(channel, fromExtension)
    const program = await findHost(host, extensionId, dirs)

    if (!program || !ports.has(connectionId)) return close()
    child = start(program, extensionId)
    for (const frame of early.splice(0)) child.stdin?.write(frame)
    const read = decoder((message) => sender.send(channel, message))

    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        read(chunk)
      } catch {
        close()
      }
    })
    child.stdin?.on('error', close)
    child.on('error', close)
    child.on('exit', close)
  }

  const disconnectNative = (event: Event, connectionId: unknown) => {
    const port = typeof connectionId === 'string' ? ports.get(connectionId) : undefined

    if (port?.extensionId === caller(event)) port.close()
  }

  const sendNativeMessage = async (event: Event, host: unknown, message: unknown) => {
    const extensionId = caller(event)
    const program = typeof host === 'string' ? await findHost(host, extensionId, dirs) : null

    if (!program) return
    const child = start(program, extensionId)

    return new Promise<unknown>((resolve) => {
      const done = (reply?: unknown) => {
        resolve(reply)
        child.kill()
      }
      const read = decoder(done)

      child.stdout?.on('data', (chunk: Buffer) => {
        try {
          read(chunk)
        } catch {
          done()
        }
      })
      child.stdin?.on('error', () => done())
      child.on('error', () => done())
      child.on('exit', () => done())
      child.stdin?.write(encode(message))
    })
  }

  /** Stops an extension's hosts, or all of them. */
  const closeAll = (extensionId?: string) => {
    for (const port of ports.values())
      if (!extensionId || port.extensionId === extensionId) port.close()
  }

  return { connectNative, disconnectNative, sendNativeMessage, closeAll }
}
