import { promises as fs } from 'node:fs'

import type { CreatedTransfer, LocalEntry, PostTransfer, TransferGroup } from './types.ts'

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

      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return out
}

// Per-file path: create intent → PUT each object → finalize.
export async function uploadEntriesIndividually(
  teamId: string,
  sessionId: string | undefined,
  entries: LocalEntry[],
  post: PostTransfer,
  label?: string,
  signal?: AbortSignal,
): Promise<TransferGroup> {
  signal?.throwIfAborted()
  const created = await post<CreatedTransfer>(teamId, sessionId, '', {
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
    signal?.throwIfAborted()
    const res = await fetch(item.uploadUrl, {
      signal,
      method: 'PUT',
      headers: e.contentType ? { 'Content-Type': e.contentType } : undefined,
      body: await fs.readFile(e.path),
    })

    if (!res.ok) throw new Error(`Upload failed for ${e.relPath}: HTTP ${String(res.status)}`)
  })

  signal?.throwIfAborted()
  const group = await post<TransferGroup>(teamId, sessionId, `/${created.groupId}/finalize`)

  return { ...group, archive: false }
}
