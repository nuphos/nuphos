import { useState } from 'react'

import { ImageAttachmentThumb, ImageLightbox } from './messageInline'

import type { TransferUploadPart } from './parts'

/** The composer's images, kept on the optimistic post while its upload runs. */
export function UploadingPreviews({ files }: { files: TransferUploadPart['files'] }) {
  const [preview, setPreview] = useState<number | null>(null)
  const images = files.flatMap((file) =>
    file.previewUrl ? [{ url: file.previewUrl, fileName: file.fileName }] : [],
  )

  if (images.length === 0) return null

  return (
    <div className="flex max-w-[480px] flex-wrap justify-end gap-2 self-end" aria-busy="true">
      {images.map((file, index) => (
        <ImageAttachmentThumb key={index} size="md" {...file} onOpen={() => setPreview(index)} />
      ))}
      <ImageLightbox images={images} index={preview} onIndexChange={setPreview} />
    </div>
  )
}
