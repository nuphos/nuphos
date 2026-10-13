import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { postFileTransfer } from '../atlas'

import { collectEntries, deriveArchiveName } from './local-entries'
import { zipEntriesToFile } from './zip'

import type { CreatedTransfer, LocalEntry, TransferGroup } from './types'

const UPLOAD_CONCURRENCY = 4

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const i = next++

      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return out
}

let uploadTmpSeq = 0

// The backend's per-transfer file cap (config.fileTransfer.maxFiles).
const MAX_FILES_PER_TRANSFER = 20

// Upload local files/directories as a transfer group:
//  - picked files upload as-is, one object each, so the agent reads them
//    directly and the chat can preview images and videos;
//  - a folder, more files than one transfer allows, or picks that share a
//    file name are packed into ONE .zip object that the agent extracts after
//    pull (structure kept, no OS junk, mirrors the download archive).
// Bytes go Electron-main → S3 directly; the backend only signs URLs.
export async function uploadFiles(args: {
  teamId: string
  sessionId?: string
  filePaths: string[]
  label?: string
}): Promise<TransferGroup> {
  const { teamId, sessionId, filePaths, label } = args
  const entries = await collectEntries(filePaths)

  if (entries.length === 0) throw new Error('No files to upload')
  const stats = await Promise.all(filePaths.map((p) => fs.stat(p)))

  // Created items are matched back by relPath, so same-named picks from
  // different folders go in the archive.
  const distinctNames = new Set(entries.map((e) => e.relPath)).size === entries.length

  if (stats.every((s) => s.isFile()) && entries.length <= MAX_FILES_PER_TRANSFER && distinctNames) {
    return uploadEntriesIndividually(teamId, sessionId, entries, label)
  }
  const singleDir = filePaths.length === 1 && stats[0].isDirectory()

  return uploadEntriesAsArchive(
    teamId,
    sessionId,
    entries,
    deriveArchiveName(filePaths, singleDir, label),
    label,
  )
}

// Per-file path: create intent → PUT each object → finalize.
async function uploadEntriesIndividually(
  teamId: string,
  sessionId: string | undefined,
  entries: LocalEntry[],
  label?: string,
): Promise<TransferGroup> {
  const created = await postFileTransfer<CreatedTransfer>(teamId, sessionId, '', {
    direction: 'upload',
    ...(label ? { label } : {}),
    files: entries.map((e) => ({
      fileName: e.fileName,
      relPath: e.relPath,
      size: e.size,
      contentType: e.contentType,
    })),
  })

  // Match created items back to local paths by relPath.
  const byRel = new Map(entries.map((e) => [e.relPath, e]))

  await mapWithLimit(created.files, UPLOAD_CONCURRENCY, async (item) => {
    const e = byRel.get(item.relPath)

    if (!e) return
    const res = await fetch(item.uploadUrl, {
      method: 'PUT',
      headers: e.contentType ? { 'Content-Type': e.contentType } : undefined,
      body: await fs.readFile(e.path),
    })

    if (!res.ok) throw new Error(`Upload failed for ${e.relPath}: HTTP ${String(res.status)}`)
  })

  const group = await postFileTransfer<TransferGroup>(
    teamId,
    sessionId,
    `/${created.groupId}/finalize`,
  )

  return { ...group, archive: false }
}

// Archive path: zip everything to one temp object → create intent → PUT → finalize.
async function uploadEntriesAsArchive(
  teamId: string,
  sessionId: string | undefined,
  entries: LocalEntry[],
  archiveName: string,
  label?: string,
): Promise<TransferGroup> {
  const tmpZip = join(tmpdir(), `nuphos-upload-${String(Date.now())}-${String(uploadTmpSeq++)}.zip`)

  try {
    await zipEntriesToFile(entries, tmpZip)
    const size = (await fs.stat(tmpZip)).size
    const created = await postFileTransfer<CreatedTransfer>(teamId, sessionId, '', {
      direction: 'upload',
      ...(label ? { label } : {}),
      files: [
        { fileName: archiveName, relPath: archiveName, size, contentType: 'application/zip' },
      ],
    })
    const item = created.files[0]

    if (!item) throw new Error('Upload was not accepted by the server')
    const res = await fetch(item.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip' },
      body: await fs.readFile(tmpZip),
    })

    if (!res.ok) throw new Error(`Upload failed for ${archiveName}: HTTP ${String(res.status)}`)
    const group = await postFileTransfer<TransferGroup>(
      teamId,
      sessionId,
      `/${created.groupId}/finalize`,
    )

    return { ...group, archive: true, archiveEntryCount: entries.length }
  } finally {
    await fs.unlink(tmpZip).catch(() => {})
  }
}
