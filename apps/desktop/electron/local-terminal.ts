import os from 'node:os'

import { spawn } from 'node-pty'

import { userShell } from './shell-env.ts'

import type { LocalTerminalEvent } from '../src/api/local-terminal-types.ts'
import type { WebContents } from 'electron'
import type { IPty } from 'node-pty'

type TerminalSession = {
  owner: WebContents
  pty: IPty
  shell: string
  /** Output so far, so a view that remounted can replay what it missed. */
  events: LocalTerminalEvent[]
  bufferedBytes: number
  exited: boolean
  agentScope?: string
  userTookOver: boolean
}

export function terminalSize(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(2, Math.min(500, Math.floor(value))) : fallback
}

/** Sessions never outlive the renderer that owns them. */
export class LocalTerminalSessions {
  private sessions = new Map<string, TerminalSession>()
  private owners = new WeakSet<WebContents>()

  /**
   * Opens the shell for `id` — the dock tab that owns it — or returns the one
   * already running under that id. Idempotent on purpose: the view is unmounted
   * and remounted whenever its session leaves and re-enters the main pane, and
   * re-mounting must find the same shell rather than spawn another.
   */
  start(
    owner: WebContents,
    id: string,
    cols: number,
    rows: number,
    cwd = os.homedir(),
    agentScope?: string,
  ): { id: string; shell: string } {
    if (typeof id !== 'string' || !id || id.length > 200) {
      throw new Error('Invalid terminal id.')
    }
    if (this.sessions.has(id)) return { id, shell: this.owned(owner, id).shell }
    if (Array.from(this.sessions.values()).filter((s) => s.owner === owner).length >= 32) {
      throw new Error('Close an existing terminal before opening another one (32 maximum).')
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : userShell()
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )

    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    const pty = spawn(shell, process.platform === 'win32' ? ['-NoLogo'] : ['-l'], {
      name: 'xterm-256color',
      cols: terminalSize(cols, 80),
      rows: terminalSize(rows, 24),
      cwd,
      env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Nuphos' },
    })
    const session: TerminalSession = {
      owner,
      pty,
      shell,
      events: [],
      bufferedBytes: 0,
      exited: false,
      agentScope,
      userTookOver: false,
    }

    this.sessions.set(id, session)
    pty.onData((data) => this.send(session, { id, type: 'data', data }))
    pty.onExit(({ exitCode }) => {
      session.exited = true
      this.send(session, { id, type: 'exit', code: exitCode })
    })
    if (!this.owners.has(owner)) {
      this.owners.add(owner)
      owner.once('destroyed', () => this.closeOwner(owner))
      owner.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) this.closeOwner(owner)
      })
      owner.on('render-process-gone', () => this.closeOwner(owner))
    }

    return { id, shell }
  }

  private send(session: TerminalSession, event: LocalTerminalEvent) {
    session.events.push(event)
    session.bufferedBytes += event.type === 'data' ? event.data.length : 0
    while (session.bufferedBytes > 256 * 1024 && session.events.length > 1) {
      const oldest = session.events.shift()

      if (oldest?.type === 'data') session.bufferedBytes -= oldest.data.length
    }
    if (!session.owner.isDestroyed()) session.owner.send('local-terminal:event', event)
  }

  private owned(owner: WebContents, id: string): TerminalSession {
    const session = this.sessions.get(id)

    if (session?.owner !== owner)
      throw new Error('Terminal session is not available in this window.')

    return session
  }

  replay(owner: WebContents, id: string): void {
    for (const event of this.owned(owner, id).events.slice()) {
      if (!owner.isDestroyed()) owner.send('local-terminal:event', event)
    }
  }

  input(owner: WebContents, id: string, data: string, fromUser = true): void {
    const session = this.owned(owner, id)

    if (typeof data !== 'string' || data.length > 1024 * 1024)
      throw new Error('Invalid terminal input.')
    if (fromUser) session.userTookOver = true
    if (!session.exited) session.pty.write(data)
  }

  agentRequest(id: string, scope: string, data?: string) {
    const session = this.sessions.get(id)

    if (!session) throw new Error('Terminal is no longer available.')

    if (session.agentScope !== scope) throw new Error('Terminal belongs to another conversation.')
    if (data !== undefined) {
      if (session.userTookOver)
        throw new Error('The user took over this terminal. Open a new terminal.')
      if (session.exited) throw new Error('Terminal has exited.')
      if (data.length > 65536) throw new Error('Terminal input is too large.')
      session.pty.write(data)
    }

    const output = session.events
      .filter((e) => e.type === 'data')
      .map((e) => e.data)
      .join('')

    return {
      terminalId: id,
      output: output.slice(-65536),
      outputIsRecentSnapshot: true,
      exited: session.exited,
      userTookOver: session.userTookOver,
    }
  }

  resize(owner: WebContents, id: string, cols: number, rows: number): void {
    const session = this.owned(owner, id)

    if (!session.exited) session.pty.resize(terminalSize(cols, 80), terminalSize(rows, 24))
  }

  close(owner: WebContents, id: string): void {
    if (!this.sessions.has(id)) return
    const session = this.owned(owner, id)

    this.sessions.delete(id)
    if (!session.exited) session.pty.kill()
  }

  private closeOwner(owner: WebContents): void {
    for (const [id, session] of this.sessions) {
      if (session.owner === owner) this.close(owner, id)
    }
  }

  closeAll(): void {
    for (const [id, session] of this.sessions) this.close(session.owner, id)
  }
}

export const localTerminals = new LocalTerminalSessions()
