import { resolveDownloads } from './download'
import { PREVIEW_TEXT_MAX_BYTES, PreviewTooLargeError, readCappedText } from './read-capped'

// One ready file's text, for an in-app preview. Bytes come main-process ⇄ S3
// like every other transfer, so the renderer never fetches a presigned URL.
export async function readText(args: {
  teamId: string
  sessionId?: string
  groupId: string
  fileId: string
  channelId?: string
}): Promise<{ text: string; fileName: string } | { tooLarge: true; fileName: string }> {
  const group = await resolveDownloads(args.teamId, args.sessionId, args.groupId, args.channelId)
  const file = group.files.find((f) => f.id === args.fileId)

  if (!file?.downloadUrl) throw new Error('File is not ready to preview')
  const tooLarge = { tooLarge: true as const, fileName: file.fileName }

  if (file.size !== null && file.size > PREVIEW_TEXT_MAX_BYTES) return tooLarge
  const res = await fetch(file.downloadUrl)

  if (!res.ok) throw new Error(`Preview failed: HTTP ${String(res.status)}`)
  try {
    return { text: await readCappedText(res, PREVIEW_TEXT_MAX_BYTES), fileName: file.fileName }
  } catch (err) {
    // Too large is an answer the card shows, not a failure.
    if (err instanceof PreviewTooLargeError) return tooLarge
    throw err
  }
}
