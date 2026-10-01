import { Writable } from 'node:stream'

import type * as k8s from '@kubernetes/client-node'

// A Writable that forwards the pod's stdout to the renderer AND looks like a
// resizable TTY to client-node. Exec only wires up the resize channel when its
// stdout `isResizable` (has rows/columns + emits 'resize'), so exposing those
// lets us drive the remote tty size by calling setSize().
export class RendererTtyStream extends Writable {
  columns: number
  rows: number
  private readonly onData: (chunk: string) => void

  constructor(onData: (chunk: string) => void, cols: number, rows: number) {
    super()
    this.onData = onData
    this.columns = cols
    this.rows = rows
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.onData(chunk.toString('utf8'))
    cb()
  }

  setSize(cols: number, rows: number): void {
    this.columns = cols
    this.rows = rows
    this.emit('resize')
  }
}

export function exitCodeFromStatus(status: k8s.V1Status): number | null {
  // A non-zero command exit comes back as a Failure status carrying an
  // `ExitCode` cause; a clean exit is reported as Success.
  const cause = (status.details?.causes ?? []).find((c) => c.reason === 'ExitCode')

  if (cause?.message != null) {
    const n = Number(cause.message)

    return Number.isFinite(n) ? n : null
  }

  return status.status === 'Success' ? 0 : null
}

// client-node / WebSocket failures often reject with a plain object, not an
// Error, so String(error) collapses to "[object Object]". Dig out a real
// message from the shapes these actually use.
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const nested = obj.error as { message?: unknown } | undefined
    const body = obj.body as { message?: unknown } | undefined
    const parts = [
      obj.message,
      nested?.message,
      body?.message,
      obj.reason,
      obj.statusMessage,
      obj.code,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0)

    if (parts.length) return parts.join(': ')
    try {
      return JSON.stringify(error)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }

  return String(error)
}
