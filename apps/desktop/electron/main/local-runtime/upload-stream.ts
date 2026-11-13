import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { collectEntries } from '../../fileTransfer/local-entries.ts'
import { uploadEntriesIndividually } from '../../fileTransfer/upload-entries.ts'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { PostTransfer } from '../../fileTransfer/types.ts'

/** The uploader's create/finalize calls travel on this authenticated stream.
 * Signed URLs never leave the trusted uploader/backend pair. No local login
 * is borrowed: the backend owns the requesting conversation's transfer scope. */
export class LocalUploadStream implements SocketLike {
  readyState = 0
  private started = false
  private readonly abort = new AbortController()
  private readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>()
  private reply?: (value: unknown) => void

  private readonly upload: typeof uploadEntriesIndividually

  constructor(upload = uploadEntriesIndividually) {
    this.upload = upload
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()

    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(raw: string): void {
    if (this.readyState !== 1 || raw.length > 16384) return
    try {
      const message = JSON.parse(raw)

      if (this.reply) {
        const reply = this.reply

        this.reply = undefined
        reply(message)
      } else if (!this.started && typeof message.path === 'string') {
        this.started = true
        void this.run(message.path)
      }
    } catch {
      this.fail('invalid_request')
    }
  }

  private readonly post: PostTransfer = <T>(
    _team: string,
    _session: string | undefined,
    suffix: string,
    body?: unknown,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      if (this.readyState !== 1) return reject(new Error('Upload closed'))
      this.reply = (value) => {
        const response = value as { result?: unknown; error?: string }

        if (response.error) reject(new Error('Transfer rejected'))
        else resolve(response.result as T)
      }
      this.emit('message', { data: JSON.stringify({ t: 'post', suffix, body }) })
    })

  private async run(input: string): Promise<void> {
    try {
      const path = input.startsWith('~/') ? join(homedir(), input.slice(2)) : input

      if (!isAbsolute(path)) return this.fail('absolute_path_required')
      if (!(await stat(path)).isFile()) return this.fail('not_a_file')
      await this.upload(
        '',
        undefined,
        await collectEntries([path]),
        this.post,
        undefined,
        this.abort.signal,
      )
      if (this.readyState !== 1) return
      this.emit('message', { data: JSON.stringify({ t: 'done' }) })
      this.close()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code

      this.fail(
        code === 'ENOENT'
          ? 'file_not_found'
          : code === 'EACCES'
            ? 'file_unreadable'
            : 'upload_failed',
      )
    }
  }

  private fail(error: string): void {
    if (this.readyState !== 1) return
    this.emit('message', { data: JSON.stringify({ t: 'error', error }) })
    this.close()
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.abort.abort()
    this.reply?.({ error: 'closed' })
    this.reply = undefined
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
