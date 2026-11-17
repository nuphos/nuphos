import { randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { copyFile, link, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'

type Request = { url: string; size: number; path: string; overwrite: boolean }

function parse(raw: string): Request | null {
  try {
    const request = JSON.parse(raw) as Partial<Request>

    return typeof request.url === 'string' &&
      ['http:', 'https:'].includes(new URL(request.url).protocol) &&
      Number.isSafeInteger(request.size) &&
      typeof request.path === 'string'
      ? {
          url: request.url,
          size: request.size!,
          path: request.path,
          overwrite: request.overwrite === true,
        }
      : null
  } catch {
    return null
  }
}

/** Fails a body longer than the size the store recorded, as soon as it is. */
const capped = (size: number) => {
  let seen = 0

  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length
      done(seen > size ? new Error('too_long') : null, chunk)
    },
  })
}

// Where hard links are missing, such as exFAT drives and some network shares.
const NO_LINKS = new Set(['EPERM', 'ENOTSUP', 'EXDEV'])

const reason = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code

  return code === 'EEXIST'
    ? 'file_exists'
    : code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
      ? 'path_not_writable'
      : 'download_failed'
}

/** Saves one transfer file where its owner asked. Only this host fetches the signed URL. */
export class LocalDownloadStream implements SocketLike {
  readyState = 0
  private started = false
  private readonly abort = new AbortController()
  private readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>()

  private readonly link: typeof link

  constructor(linkFile = link) {
    this.link = linkFile
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
    if (this.readyState !== 1 || this.started || raw.length > 16384) return
    this.started = true
    const request = parse(raw)

    if (request) void this.run(request)
    else this.answer({ t: 'error', error: 'invalid_request' })
  }

  private async run({ url, size, path: input, overwrite }: Request): Promise<void> {
    const path = input.startsWith('~/') ? join(homedir(), input.slice(2)) : input

    if (!isAbsolute(path)) return this.answer({ t: 'error', error: 'absolute_path_required' })
    const folder = dirname(path)
    const existing = await stat(path).catch(() => null)

    if (!(await stat(folder).catch(() => null))?.isDirectory())
      return this.answer({ t: 'error', error: 'directory_not_found' })
    if (existing?.isDirectory()) return this.answer({ t: 'error', error: 'not_a_file' })
    if (existing && !overwrite) return this.answer({ t: 'error', error: 'file_exists' })
    // Written beside the target, then put in place whole, so a failed fetch leaves nothing.
    const temporary = join(folder, `.nuphos-download-${randomUUID()}`)

    try {
      const response = await fetch(url, { signal: this.abort.signal })

      if (!response.ok || !response.body) throw new Error('fetch_failed')
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        capped(size),
        createWriteStream(temporary, { flags: 'wx' }),
        { signal: this.abort.signal },
      )
      if ((await stat(temporary)).size !== size) throw new Error('too_short')
      // rename replaces the file when asked to; otherwise one that appeared meanwhile is kept.
      await (overwrite ? rename(temporary, path) : this.place(temporary, path))
      this.answer({ t: 'done', path })
    } catch (error) {
      this.answer({ t: 'error', error: reason(error) })
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  /** link refuses an existing file; without hard links, an exclusive copy does the same. */
  private async place(temporary: string, path: string): Promise<void> {
    try {
      await this.link(temporary, path)
    } catch (error) {
      if (!NO_LINKS.has((error as NodeJS.ErrnoException)?.code ?? '')) throw error
      try {
        await copyFile(temporary, path, constants.COPYFILE_EXCL)
      } catch (copyError) {
        // Only a copy this call created is removed; an existing file fails with EEXIST first.
        if ((copyError as NodeJS.ErrnoException)?.code !== 'EEXIST')
          await unlink(path).catch(() => undefined)
        throw copyError
      }
    }
  }

  private answer(message: unknown): void {
    if (this.readyState !== 1) return
    this.emit('message', { data: JSON.stringify(message) })
    this.close()
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.abort.abort()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
