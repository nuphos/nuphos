// Image attachments as vision. Read a user-attached image in the
// main process and return a data URL the renderer can hand to the model as a
// vision `file` part — no S3 upload, no sandbox round-trip. Oversized images are
// downscaled (and re-encoded to JPEG) so the inlined base64 stays small and
// within the model's image limits.

import { promises as fs } from 'node:fs'
import { basename } from 'node:path'

import { nativeImage } from 'electron'

// Anthropic's recommended long-edge cap; larger images are downscaled to this.
const MAX_DIM = 1568
// Inline the original bytes (preserving format) up to this size; above it we
// re-encode to a JPEG to keep the payload reasonable.
const MAX_INLINE_BYTES = 3 * 1024 * 1024
// Formats the model accepts directly, so we can inline the original bytes.
const INLINE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function mediaTypeFor(name: string): string {
  switch (name.toLowerCase().split('.').pop() ?? '') {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

// Registry mapping an opaque attachmentId → the local file path, so the agent
// can ask to transfer an already-attached image without ever
// seeing or nominating a local path itself. Populated when the renderer reads an
// image for vision; resolved when the `upload_attachment` client tool runs.
type RegisteredAttachment = { path: string; size: number; mtimeMs: number }
const attachmentPaths = new Map<string, RegisteredAttachment>()
let attachmentSeq = 0

export async function registerAttachment(path: string): Promise<string> {
  const st = await fs.stat(path)
  const id = `att_${String(++attachmentSeq)}_${Date.now().toString(36)}`

  attachmentPaths.set(id, { path, size: st.size, mtimeMs: st.mtimeMs })

  return id
}

// Resolve an attachmentId to its path, rejecting if the file changed since
// registration (size/mtime) so the upload can't transfer different bytes than
// the ones the model was shown (TOCTOU integrity).
export async function resolveAttachment(id: string): Promise<string | undefined> {
  const entry = attachmentPaths.get(id)

  if (!entry) return undefined
  try {
    const st = await fs.stat(entry.path)

    if (st.size !== entry.size || st.mtimeMs !== entry.mtimeMs) return undefined
  } catch {
    return undefined
  }

  return entry.path
}

export type ImageAttachment = { mediaType: string; url: string; fileName: string }

export async function readImageAttachment(path: string): Promise<ImageAttachment | null> {
  const fileName = basename(path)
  const buf = await fs.readFile(path)
  const mediaType = mediaTypeFor(fileName)

  const img = nativeImage.createFromBuffer(buf)
  const size = img.isEmpty() ? null : img.getSize()
  const oversized = !!size && Math.max(size.width, size.height) > MAX_DIM

  // Small, model-supported original → inline as-is (keeps PNG transparency, etc).
  // Require a successful decode (`size`) so undecodable bytes can't be passed off
  // as a valid image via the extension/size-only fast path.
  if (size && !oversized && buf.length <= MAX_INLINE_BYTES && INLINE_MEDIA_TYPES.has(mediaType)) {
    return { mediaType, url: `data:${mediaType};base64,${buf.toString('base64')}`, fileName }
  }

  // Otherwise we must re-encode — which needs a decodable image. If nativeImage
  // couldn't read it (e.g. an unusual format) bail and let the caller skip it.
  if (img.isEmpty()) return null

  const scaled = oversized
    ? size!.width >= size!.height
      ? img.resize({ width: MAX_DIM })
      : img.resize({ height: MAX_DIM })
    : img
  const jpeg = scaled.toJPEG(82)

  return {
    mediaType: 'image/jpeg',
    url: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    fileName,
  }
}
