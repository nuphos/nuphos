import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

import { ZipArchive } from 'archiver'

import type { LocalEntry } from './types'

// fetch().body is a web ReadableStream; Node's pipeline/archiver want a Node
// Readable. (cast: undici's web stream type vs the global lib.dom one.)
export function toNodeStream(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
}

// Normalize a backend/agent-provided relPath to a safe relative zip entry name:
// drop Windows drive letters, leading slashes, and any `.`/`..` segments so the
// produced archive can't become a zip-slip payload when the user extracts it.
export function safeZipEntryName(rel: string, fallback: string): string {
  const raw = (rel || fallback).replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '')
  const parts = raw.split('/').filter((seg) => seg && seg !== '.' && seg !== '..')

  return parts.join('/') || fallback.replace(/[\\/]+/g, '_') || 'file'
}

// Zip the collected entries into a temp file, preserving relPath structure and
// UTF-8 filename flags (cross-platform). Used for the folder / multi-file path.
export async function zipEntriesToFile(entries: LocalEntry[], dest: string): Promise<void> {
  const output = createWriteStream(dest)
  const archive = new ZipArchive({ zlib: { level: 6 } })
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    archive.on('error', reject)
    output.on('error', reject)
  })

  archive.pipe(output)
  for (const e of entries) {
    archive.file(e.path, { name: e.relPath })
  }
  await archive.finalize()
  await done
}
