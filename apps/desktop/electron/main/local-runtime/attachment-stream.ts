import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { LocalFileStream } from './file-stream.ts'

import type { LocalRuntimeState } from './controller-types.ts'
import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { ChildProcess } from 'node:child_process'

/** Only the locally bundled downloader runs; the peer cannot supply a program, argv or env. */
export class LocalAttachmentStream implements SocketLike {
  readyState = 0
  private child?: ChildProcess
  private readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>()

  static open(
    state: LocalRuntimeState,
    bundle: string,
    instanceId?: string,
  ): LocalAttachmentStream | null {
    const workspace =
      instanceId === undefined
        ? state.workspace
        : state.instances?.find((instance) => instance.instanceId === instanceId)?.workspace
    const program = join(bundle, 'attachment-job.mjs')

    return workspace && existsSync(program) ? new LocalAttachmentStream(workspace, program) : null
  }

  private readonly workspace: string
  private readonly program: string

  constructor(workspace: string, program: string) {
    this.workspace = workspace
    this.program = program
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
    if (input.length > 1_048_576) return this.close()
    let files: unknown

    try {
      const request: unknown = JSON.parse(input)

      if (!request || typeof request !== 'object' || !('files' in request)) return this.close()
      files = request.files
      if (
        !Array.isArray(files) ||
        files.length > 100 ||
        !files.every((value: unknown) => {
          if (!value || typeof value !== 'object') return false
          const file = value as Record<string, unknown>

          return (
            typeof file.name === 'string' &&
            typeof file.url === 'string' &&
            typeof file.size === 'number' &&
            Number.isSafeInteger(file.size) &&
            file.size >= 0 &&
            ['http:', 'https:'].includes(new URL(file.url).protocol)
          )
        })
      )
        return this.close()
    } catch {
      return this.close()
    }
    const child = spawn(
      process.execPath,
      [this.program, '--local-root', join(this.workspace, '.nuphos-attachments')],
      {
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SystemRoot: process.env.SystemRoot,
        },
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 120_000,
      },
    )

    this.child = child
    let output = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 64 * 1024) this.close()
    })
    child.on('error', () => this.close())
    child.stdin.on('error', () => this.close())
    child.on('close', (code) => {
      if (this.readyState !== 1) return
      if (code === 0) this.emit('message', { data: output })
      this.close()
    })
    child.stdin.end(JSON.stringify({ files }))
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

/** Desktop and CLI hosts share exactly the same fixed-program file operations. */
export function localFileConnectors(state: () => LocalRuntimeState, bundle: string) {
  return {
    connectAttachments: (instanceId?: string) =>
      LocalAttachmentStream.open(state(), bundle, instanceId),
    connectFile: (instanceId?: string) => LocalFileStream.open(state(), instanceId),
  }
}
