import { createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'

import { ZipArchive } from 'archiver'

import { resolveChannelAttachment } from '../agent/channels'
import { getFileTransfer } from '../atlas'

import { readBoundedFile } from './read'
import { safeZipEntryName, toNodeStream } from './zip'

import type { FileBytesArgs } from './read'
import type { TransferGroup } from './types'

let downloadTmpSeq = 0

// Resolve a group's presigned download URLs. A chat's files resolve through the
// chat, so every member can open what anyone posted there.
export async function resolveDownloads(
  teamId: string,
  sessionId: string | undefined,
  groupId: string,
  channelId?: string,
): Promise<TransferGroup> {
  if (channelId)
    return (await resolveChannelAttachment(channelId, teamId, groupId)) as unknown as TransferGroup

  return getFileTransfer<TransferGroup>(teamId, sessionId, `/${groupId}/download`)
}

export async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)

  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${String(res.status)}`)
  // Stream to a sibling temp file and rename into place only on success, so an
  // interrupted fetch never leaves a truncated file at the user's chosen path.
  const tmp = `${destPath}.part-${String(Date.now())}-${String(downloadTmpSeq++)}`

  try {
    await pipeline(toNodeStream(res.body), createWriteStream(tmp))
    await fs.rename(tmp, destPath)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

// Download a single ready file to a chosen path.
export async function downloadOne(args: {
  teamId: string
  sessionId?: string
  groupId: string
  fileId: string
  destPath: string
  channelId?: string
}): Promise<void> {
  const group = await resolveDownloads(args.teamId, args.sessionId, args.groupId, args.channelId)
  const file = group.files.find((f) => f.id === args.fileId)

  if (!file?.downloadUrl) throw new Error('File is not ready to download')
  await downloadTo(file.downloadUrl, args.destPath)
}

// Read one ready file's bytes for an in-app preview. All S3 traffic stays in
// the main process; the read is capped so a large file is never read whole.
export function readOne(args: FileBytesArgs): Promise<Uint8Array | null> {
  return readBoundedFile(args, resolveDownloads)
}

// Download every ready file and stream them into a single cross-platform zip
// (UTF-8 filenames, relPath structure preserved, no macOS resource-fork junk).
export async function downloadAllAsZip(args: {
  teamId: string
  sessionId?: string
  groupId: string
  destZipPath: string
  channelId?: string
}): Promise<{ count: number; skipped: number }> {
  const group = await resolveDownloads(args.teamId, args.sessionId, args.groupId, args.channelId)
  const ready = group.files.filter((f) => f.status === 'ready' && f.downloadUrl)
  const skipped = group.files.length - ready.length

  // Build into a sibling temp file; rename into place only after the whole
  // archive finalizes, so a mid-stream failure never leaves a partial .zip the
  // caller would treat as a complete download.
  const tmpZip = `${args.destZipPath}.part-${String(Date.now())}-${String(downloadTmpSeq++)}`

  try {
    const output = createWriteStream(tmpZip)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve())
      archive.on('error', reject)
      output.on('error', reject)
    })

    archive.pipe(output)

    // Stream each presigned GET straight into the archive entry — bounded
    // memory, and `archiver` writes UTF-8 filename flags by default.
    const seen = new Set<string>()
    let failed = 0

    for (const f of ready) {
      const res = await fetch(f.downloadUrl!)

      if (!res.ok || !res.body) {
        failed++
        continue
      }
      let name = safeZipEntryName(f.relPath, f.fileName)

      // Dedupe collisions: report.txt → report (1).txt
      if (seen.has(name)) {
        const dot = name.lastIndexOf('.')
        const stem = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ''
        let n = 1

        while (seen.has(`${stem} (${String(n)})${ext}`)) n++
        name = `${stem} (${String(n)})${ext}`
      }
      seen.add(name)
      archive.append(toNodeStream(res.body), { name })
    }

    await archive.finalize()
    await done
    // A ready file that failed to download means the archive is incomplete —
    // surface it rather than presenting a partial zip as a successful download.
    if (failed > 0) {
      throw new Error(`${String(failed)} of ${String(ready.length)} file(s) failed to download`)
    }
    await fs.rename(tmpZip, args.destZipPath)

    return { count: seen.size, skipped }
  } catch (err) {
    await fs.unlink(tmpZip).catch(() => {})
    throw err
  }
}
