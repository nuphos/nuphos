import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'

import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { previewKind } from './transferDownloads'

import type { FileTransferGroup } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images and videos in a transfer group, whichever
// side sent it. Presigned URLs last minutes, so a preview that breaks after
// its links have aged re-resolves them. One image shows whole; several shrink
// to a row of square thumbnails, and the preview steps through all of them.
export function TransferPreviews({
  teamId,
  groupId,
  fallback = null,
  onDownload,
}: {
  teamId: string
  groupId: string
  /** Shown when nothing can be previewed (expired, or someone else's files). */
  fallback?: ReactNode
  onDownload?: (file: FileTransferGroup['files'][number]) => void
}) {
  const [files, setFiles] = useState<FileTransferGroup['files'] | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const resolvedAt = useRef(0)
  const resolve = useCallback(() => {
    resolvedAt.current = Date.now()
    void api
      .fileTransferResolve({ teamId, groupId })
      .then((resolved) => setFiles(resolved.files.filter((f) => f.downloadUrl && previewKind(f))))
      .catch(() => setFiles([]))
  }, [teamId, groupId])

  useEffect(resolve, [resolve])
  if (files === null) return <></>
  if (files.length === 0) return <>{fallback}</>
  // A link that fails right after resolving is broken, not expired: don't loop.
  const retry = () => {
    if (Date.now() - resolvedAt.current > 60_000) resolve()
  }
  const images = files.filter((f) => previewKind(f) === 'image')

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {files.map((f) =>
        previewKind(f) === 'video' ? (
          <video
            key={f.id}
            src={f.downloadUrl}
            controls
            preload="metadata"
            onError={retry}
            title={f.fileName}
            className="max-h-72 max-w-full rounded-lg border border-zGray-800 bg-black"
          />
        ) : (
          <ImageAttachmentThumb
            key={f.id}
            size={images.length > 1 ? 'md' : 'lg'}
            url={f.downloadUrl}
            fileName={f.fileName}
            onOpen={() => setPreview(images.indexOf(f))}
            onError={retry}
          />
        ),
      )}
      <ImageLightbox
        images={images.map((f) => ({ url: f.downloadUrl ?? '', fileName: f.fileName }))}
        index={preview}
        onIndexChange={setPreview}
        onDownload={onDownload && ((i) => onDownload(images[i]))}
      />
    </div>
  )
}
