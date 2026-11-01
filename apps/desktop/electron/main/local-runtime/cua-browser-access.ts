import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** The App's browser service refuses browser APIs unless this host signs off on the turn. */
const DOMAIN = 'codex.browserAccess.v1'
const METHOD = 'browser/access'
const HEADER = 4

export type BrowserAccessRequest = {
  executorId?: string
  sessionId?: string
  turnId?: string
  nonce?: string
}

type Message = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }

const le = os.endianness() === 'LE'

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(HEADER)

  if (le) header.writeUInt32LE(body.length)
  else header.writeUInt32BE(body.length)

  return Buffer.concat([header, body])
}

/**
 * The browser access host the Codex App runs for its `cua_repl`: a private
 * pipe answering `browser/access` with a signed allow, but only for the turn
 * this conversation's call is running.
 */
export class BrowserAccessHost {
  readonly env: Record<string, string>
  private readonly server: net.Server
  private readonly dir: string | undefined
  private readonly privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  private readonly executorId = randomBytes(16).toString('hex')
  readonly listening: Promise<void>
  private readonly session: string
  private readonly turn: () => string | undefined

  constructor(session: string, turn: () => string | undefined) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    let pipe: string

    this.session = session
    this.turn = turn
    this.privateKey = privateKey
    if (process.platform === 'win32') {
      pipe = `\\\\.\\pipe\\nuphos-browser-access-${randomBytes(16).toString('hex')}`
    } else {
      // mkdtemp's 0700 directory keeps other users off the socket.
      this.dir = mkdtempSync(path.join(os.tmpdir(), 'nuphos-cua-'))
      pipe = path.join(this.dir, 'access.sock')
    }
    this.env = {
      BROWSER_USE_ACCESS_EXECUTOR_ID: this.executorId,
      BROWSER_USE_ACCESS_PIPE_PATH: pipe,
      BROWSER_USE_ACCESS_VERIFYING_IDENTITY: publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64'),
    }
    this.server = net.createServer((socket) => this.connect(socket))
    this.listening = new Promise((resolve) => {
      this.server.once('listening', () => resolve())
      // Without a host the App's own error reaches the agent, as before.
      this.server.once('error', () => resolve())
    })
    this.server.listen(pipe)
  }

  /** Whether the App may use browsers for this request. */
  allows(request: BrowserAccessRequest): boolean {
    const turn = this.turn()

    return (
      request.executorId === this.executorId &&
      request.sessionId === this.session &&
      turn !== undefined &&
      request.turnId === turn &&
      typeof request.nonce === 'string' &&
      request.nonce.length > 0
    )
  }

  close(): void {
    this.server.close()
    if (this.dir) rmSync(this.dir, { recursive: true, force: true })
  }

  private connect(socket: net.Socket): void {
    let buffer = Buffer.alloc(0)

    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= HEADER) {
        const size = le ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0)

        if (buffer.length < HEADER + size) return
        const body = buffer.subarray(HEADER, HEADER + size).toString('utf8')

        buffer = buffer.subarray(HEADER + size)
        let message: Message

        try {
          message = JSON.parse(body) as Message
        } catch {
          socket.destroy()

          return
        }
        if (message.id !== undefined) socket.write(frame(this.answer(message)))
      }
    })
  }

  private answer(message: Message): Record<string, unknown> {
    const reply = { jsonrpc: '2.0', id: message.id }

    if (message.method !== METHOD)
      return {
        ...reply,
        error: { code: -32601, message: `${String(message.method)} is not supported` },
      }
    const request = (message.params ?? {}) as BrowserAccessRequest

    if (!this.allows(request))
      return {
        ...reply,
        error: { code: 1, message: 'Browser access is not allowed for this turn' },
      }
    // The App compares this string byte for byte, so the request is echoed as it arrived.
    const payload = JSON.stringify({ domain: DOMAIN, request: message.params, allowed: true })

    return {
      ...reply,
      result: {
        payload,
        signature: sign(null, Buffer.from(payload), this.privateKey).toString('base64'),
      },
    }
  }
}
