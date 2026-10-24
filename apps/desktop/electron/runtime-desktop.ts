import { apiUrl } from './api-endpoint.ts'
import { readToken } from './atlas/client.ts'
import { authSession } from './auth-session.ts'
import { onPageGone } from './page-owner.ts'

import type { DesktopTarget, RuntimeDesktopEvent } from '../src/api/local-terminal-types.ts'
import type { WebContents } from 'electron'

type Session = { owner: WebContents; socket: WebSocket; release: () => void }

/** RFB client messages are small; a control frame smaller. */
const MAX_INPUT_CHARS = 64 * 1024

/**
 * The main process holds the authenticated socket of each desktop view, as it
 * does for runtime terminals; the renderer sees frames by view id and feeds its
 * noVNC through them. Frames stay base64 text end to end.
 */
export class RuntimeDesktopSessions {
  private readonly sessions = new Map<string, Session>()
  private get(owner: WebContents, id: string) {
    const session = this.sessions.get(id)

    if (session && session.owner !== owner) throw new Error('Desktop belongs to another window')

    return session
  }
  async start(owner: WebContents, id: string, target: DesktopTarget): Promise<void> {
    if (this.get(owner, id)) return
    if (this.sessions.size >= 8) throw new Error('Close a desktop before opening another one.')
    const token = await readToken()

    if (!token) throw new Error('Signed out')
    const url = new URL(
      `/teams/${encodeURIComponent(target.teamId)}/runtime-desktop/${encodeURIComponent(target.sessionId)}/${String(target.display)}`,
      apiUrl(),
    )

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } })
    const send = (event: RuntimeDesktopEvent) => {
      if (!owner.isDestroyed()) owner.send('runtime-desktop:event', event)
    }

    this.sessions.set(id, {
      owner,
      socket,
      release: onPageGone(owner, () => this.close(owner, id)),
    })
    socket.addEventListener('open', () => send({ id, type: 'open' }))
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') send({ id, type: 'data', data: event.data })
    })
    socket.addEventListener('close', () => {
      this.close(owner, id)
      send({ id, type: 'close' })
    })
    socket.addEventListener('error', () => socket.close())
  }
  input(owner: WebContents, id: string, data: string) {
    if (data.length > MAX_INPUT_CHARS) throw new Error('Desktop input is too large')
    this.get(owner, id)?.socket.send(data)
  }
  close(owner: WebContents, id: string) {
    const session = this.get(owner, id)

    if (!session) return
    this.sessions.delete(id)
    session.release()
    session.socket.close()
  }
  closeAll() {
    for (const [id, session] of this.sessions) this.close(session.owner, id)
  }
}
export const runtimeDesktops = new RuntimeDesktopSessions()
// An authenticated socket must never survive a Desktop account/session transition.
authSession.subscribe(() => runtimeDesktops.closeAll())
