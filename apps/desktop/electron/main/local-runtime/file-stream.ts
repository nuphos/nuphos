import { spawn } from 'node:child_process'

import { RUNTIME_FILE_PROGRAM } from '../../../../backend/src/lib/claude-code-preview/runtime-file-program.ts'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { ChildProcess } from 'node:child_process'

/** A bounded, read-only operation on the existing authenticated device tunnel. */
export class LocalFileStream implements SocketLike {
  readyState = 0
  private child?: ChildProcess
  private readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>()

  private readonly workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set()

    set.add(listener)
    this.listeners.set(type, set)
  }

  send(input: string): void {
    if (this.readyState !== 1 || this.child) return
    if (input.length > 16384) return this.close()
    let request: { sessionId?: unknown; path?: unknown; action?: unknown }

    try {
      request = JSON.parse(input)
      if (!request || typeof request !== 'object') return this.close()
    } catch {
      return this.close()
    }
    const child = spawn(process.execPath, ['--input-type=module', '-e', RUNTIME_FILE_PROGRAM], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SystemRoot: process.env.SystemRoot,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10_000,
    })

    this.child = child
    let output = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 750_000) this.close()
    })
    child.on('error', () => this.close())
    child.stdin.on('error', () => this.close())
    child.on('close', () => {
      if (this.readyState !== 1) return
      this.emit('message', { data: output })
      this.close()
    })
    child.stdin.end(
      JSON.stringify({
        sessionId: request.sessionId,
        path: request.path,
        action: request.action,
        workspace: this.workspace,
        workspaceScope: 'local-user',
      }),
    )
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.child?.kill()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
