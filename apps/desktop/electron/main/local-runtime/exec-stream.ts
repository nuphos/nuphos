import { randomUUID } from 'node:crypto'

import { abortClientTools, normalizeToolError, runLocalCommand } from '../../agent/local-exec.ts'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Listener = (event: SocketEvent) => void

/** A single command behaves like the other streams multiplexed on the device
 * tunnel. Closing it (disconnect, logout, timeout) cancels the local process. */
export class LocalExecStream implements SocketLike {
  readyState = 0
  private readonly id = `device-exec:${randomUUID()}`
  private readonly listeners = new Map<string, Set<Listener>>()
  private started = false

  private readonly deps: {
    runLocalCommand: typeof runLocalCommand
    abortClientTools: typeof abortClientTools
  }

  constructor(deps = { runLocalCommand, abortClientTools }) {
    this.deps = deps
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()

    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(command: string): void {
    if (this.readyState !== 1 || this.started) return
    this.started = true
    void this.deps
      .runLocalCommand(command, { sessionId: this.id })
      .catch((error: unknown) => ({
        stdout: '',
        stderr: normalizeToolError(error),
        exitCode: 1,
      }))
      .then((result) => {
        if (this.readyState !== 1) return
        this.started = false
        this.emit('message', { data: JSON.stringify(result) })
        this.close()
      })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    if (this.started) this.deps.abortClientTools(this.id)
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
