import { extname } from 'node:path'

import { createTransfer, finalizeTransfer } from '@/lib/file-transfer/service'

import type { PromptImage } from '../agent/image-parts'
import type { TransferScope } from '@/lib/file-transfer/service'

/** Keep image bytes off ACP's bounded control channel. The runtime downloads them. */
export async function uploadPromptImages(
  scope: TransferScope,
  images: PromptImage[],
): Promise<string | null> {
  if (!images.length) return null
  const files = images.map((image, index) => ({
    fileName: imageFileName(image, index),
    // Distinct store paths even when several pasted screenshots have the same name.
    relPath: `${String(index)}/image`,
    size: Buffer.byteLength(image.data, 'base64'),
    contentType: image.mimeType,
  }))
  const group = await createTransfer(scope, 'upload', files, 'Chat images')

  for (const [index, file] of group.files.entries()) {
    const response = await fetch(file.uploadUrl, {
      method: 'PUT',
      body: Buffer.from(images[index]!.data, 'base64'),
      headers: { 'Content-Type': images[index]!.mimeType },
      signal: AbortSignal.timeout(60_000),
      redirect: 'error',
    })

    if (!response.ok) throw new Error('Could not upload an attached image. Retry this message.')
  }
  const finalized = await finalizeTransfer(scope, group.groupId)

  if (finalized.status !== 'ready') throw new Error('An attached image did not finish uploading')

  return group.groupId
}

function imageFileName(image: PromptImage, index: number): string {
  const extension =
    image.mimeType === 'image/jpeg' ? 'jpg' : (image.mimeType.split('/')[1] ?? 'png')
  const name = image.name || `image-${String(index + 1)}`
  const current = extname(name)

  if (
    current.toLowerCase() === `.${extension}` ||
    (extension === 'jpg' && current.toLowerCase() === '.jpeg')
  )
    return name

  return `${current ? name.slice(0, -current.length) : name}.${extension}`
}
