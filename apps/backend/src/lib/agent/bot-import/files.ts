import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { importRuntimeFile } from '@/lib/claude-code-preview/runtime-file'
import { createTransfer, finalizeTransfer, resolveDownloads } from '@/lib/file-transfer/service'

import type { BotBundleArchive } from './archive'
import type { ImportBatch, ImportItem } from './batch'
import type { ImportedBot } from './manifest'

export function importedFileReferences(
  text: string,
  files: ImportedBot['files'],
  sessionId: string,
) {
  let rendered = text

  for (const file of files)
    rendered = rendered.replaceAll(
      `{{file:${file.destination}}}`,
      `imported/${sessionId}/${file.destination}`,
    )
  if (rendered.includes('{{file:'))
    throw new Error('Instructions reference a file not included in the export')
  if (rendered.length > 8000) throw new Error('Imported instructions exceed the destination limit')

  return rendered
}

export async function importBotFiles(
  batch: ImportBatch,
  item: ImportItem,
  source: ImportedBot,
  archive: BotBundleArchive,
  save: (item: ImportItem) => Promise<void>,
) {
  const scope = {
    userId: batch.userId,
    teamId: new ObjectId(batch.teamId),
    sessionId: item.sessionId,
  }

  for (const file of source.files) {
    if (item.deliveredFiles?.includes(file.path)) continue
    await save(item)
    const bytes = archive.files.get(file.path)

    if (!bytes) throw new Error('Import file missing')
    let url: string | undefined

    if (bytes.length) {
      const group = await createTransfer(
        scope,
        'upload',
        [
          {
            fileName: file.destination.split('/').at(-1) ?? 'file',
            relPath: file.destination,
            size: bytes.length,
          },
        ],
        'Bot import',
      )
      const target = group.files[0]

      if (!target) throw new Error('Could not stage import file')
      const put = await fetch(target.uploadUrl, {
        method: 'PUT',
        body: new Blob([bytes.slice().buffer]),
        signal: AbortSignal.timeout(90_000),
      })

      if (!put.ok) throw new Error('Could not stage import file')
      await save(item)
      await finalizeTransfer(scope, group.groupId)
      const downloads = await resolveDownloads(scope, group.groupId)

      url = downloads.files[0]?.downloadUrl
      if (!url) throw new Error('Import file is not ready')
    }
    await importRuntimeFile({
      teamId: batch.teamId,
      userId: batch.userId,
      runtimeId: batch.runtimeId,
      sessionId: item.sessionId,
      destination: file.destination,
      url,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    item.deliveredFiles = [...(item.deliveredFiles ?? []), file.path]
    await save(item)
  }
}
