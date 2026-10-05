import { StringDecoder } from 'node:string_decoder'

import { apiUrl } from './api-endpoint.ts'
import { readToken } from './atlas/client.ts'
import { authSession } from './auth-session.ts'

import type { LocalTerminalEvent, TerminalTarget } from '../src/api/local-terminal-types.ts'
import type { WebContents } from 'electron'

type Session = {
  owner: WebContents
  target: TerminalTarget
  socket?: WebSocket
  events: LocalTerminalEvent[]
  bytes: number
  label: string
  ready: Promise<{ id: string; shell: string }>
  closed: boolean
  resizeTimer?: ReturnType<typeof setTimeout>
}

/** The main process, not a mounted view, owns the connection and bounded scrollback. */
export class RuntimeTerminalSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly owners = new WeakSet<WebContents>()
  private get(owner: WebContents, id: string) {
    const session = this.sessions.get(id)

    if (session && session.owner !== owner) throw new Error('Terminal belongs to another window')

    return session
  }
  describe(owner: WebContents, id: string) {
    return this.get(owner, id)?.target
  }
  start(owner: WebContents, id: string, target: TerminalTarget, cols = 80, rows = 24) {
    const existing = this.get(owner, id)

    if (existing) return existing.ready
    if (this.sessions.size >= 32) throw new Error('Close a terminal before opening another one.')
    const session: Session = {
      owner,
      target,
      events: [],
      bytes: 0,
      label: 'Runtime',
      closed: false,
      ready: Promise.resolve({ id, shell: 'Runtime' }),
    }

    this.sessions.set(id, session)
    if (!this.owners.has(owner)) {
      this.owners.add(owner)
      const closeOwner = () => {
        for (const [key, value] of this.sessions) if (value.owner === owner) this.close(owner, key)
      }

      owner.once('destroyed', closeOwner)
      owner.on('render-process-gone', closeOwner)
      owner.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) closeOwner()
      })
    }
    session.ready = this.connect(session, id, cols, rows)

    return session.ready
  }
  private async connect(session: Session, id: string, cols: number, rows: number) {
    const token = await readToken()

    if (!token || session.closed) throw new Error('Terminal closed or signed out')
    const url = new URL(
      `/teams/${encodeURIComponent(session.target.teamId)}/runtime-terminal/${encodeURIComponent(session.target.sessionId)}`,
      apiUrl(),
    )

    url.searchParams.set('cols', String(cols))
    url.searchParams.set('rows', String(rows))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } })

    session.socket = socket
    const decoder = new StringDecoder('utf8')

    return new Promise<{ id: string; shell: string }>((resolve, reject) => {
      let ready = false
      const timer = setTimeout(() => {
        reject(new Error('Runtime terminal connection timed out'))
        this.close(session.owner, id)
      }, 30000)
      const finish = () => {
        clearTimeout(timer)
        if (!ready) reject(new Error('Runtime terminal disconnected'))
        if (ready && !session.closed) this.send(session, { id, type: 'exit', code: -1 })
        this.close(session.owner, id)
      }

      socket.addEventListener('error', finish)
      socket.addEventListener('close', finish)
      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data !== 'string' || event.data.length > 32768)
            throw new Error('Invalid terminal frame')
          const frame = JSON.parse(event.data) as {
            type: string
            sequence?: number
            data?: string
            label?: string
            message?: string
            code?: number
          }

          if (frame.type === 'ready') {
            ready = true
            clearTimeout(timer)
            session.label = frame.label || 'Runtime'
            resolve({ id, shell: session.label })
          } else if (frame.type === 'data' && typeof frame.data === 'string') {
            this.send(session, {
              id,
              type: 'data',
              data: decoder.write(Buffer.from(frame.data, 'base64')),
            })
            socket.send(JSON.stringify({ type: 'ack', sequence: frame.sequence }))
          } else if (frame.type === 'error') {
            clearTimeout(timer)
            reject(new Error(frame.message || 'Runtime terminal unavailable'))
            this.close(session.owner, id)
          } else if (frame.type === 'exit') {
            this.send(session, { id, type: 'exit', code: frame.code ?? -1 })
            this.close(session.owner, id)
            finish()
          }
        } catch {
          finish()
        }
      })
    })
  }
  private send(session: Session, event: LocalTerminalEvent) {
    session.events.push(event)
    session.bytes += event.type === 'data' ? event.data.length : 0
    while (session.bytes > 256 * 1024 && session.events.length > 1) {
      const first = session.events.shift()!

      if (first.type === 'data') session.bytes -= first.data.length
    }
    if (!session.owner.isDestroyed()) session.owner.send('local-terminal:event', event)
  }
  replay(owner: WebContents, id: string) {
    for (const event of this.get(owner, id)?.events ?? []) owner.send('local-terminal:event', event)
  }
  input(owner: WebContents, id: string, data: string) {
    if (Buffer.byteLength(data, 'utf8') > 16384) throw new Error('Terminal input is too large')
    this.get(owner, id)?.socket?.send(JSON.stringify({ type: 'input', data }))
  }
  resize(owner: WebContents, id: string, cols: number, rows: number) {
    const session = this.get(owner, id)

    if (!session) return
    clearTimeout(session.resizeTimer)
    session.resizeTimer = setTimeout(() => {
      if (!session.closed) session.socket?.send(JSON.stringify({ type: 'resize', cols, rows }))
    }, 75)
  }
  close(owner: WebContents, id: string) {
    const session = this.get(owner, id)

    if (!session) return
    session.closed = true
    clearTimeout(session.resizeTimer)
    this.sessions.delete(id)
    session.socket?.close()
  }
  closeAll() {
    for (const [id, session] of this.sessions) this.close(session.owner, id)
  }
}
export const runtimeTerminals = new RuntimeTerminalSessions()
// An authenticated socket must never survive a Desktop account/session transition.
authSession.subscribe(() => runtimeTerminals.closeAll())
