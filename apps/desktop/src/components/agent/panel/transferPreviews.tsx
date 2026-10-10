import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'

import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { previewKind } from './transferDownloads'

import type { FileTransferFile } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images and videos in a transfer group, whichever
// side sent it. Presigned URLs last minutes, so a preview that breaks after
// its links have aged re-resolves them. One image shows whole; several shrink
// to a row of square thumbnails, and the preview steps through all of them.
// `children` receives the names of the images shown as thumbnails (null while
// resolving), so the card lists every other file as a row.
export function TransferPreviews({
  teamId,
  groupId,
  onDownload,
  children,
}: {
  teamId: string
  groupId: string
  onDownload?: (file: FileTransferFile) => void
  children?: (previewedImages: ReadonlySet<string> | null) => ReactNode
}) {
  const [files, setFiles] = useState<FileTransferFile[] | null>(null)
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
  if (files === null) return <>{children?.(null)}</>
  // A link that fails right after resolving is broken, not expired: don't loop.
  const retry = () => {
    if (Date.now() - resolvedAt.current > 60_000) resolve()
  }
  const images = files.flatMap((f) =>
    previewKind(f) === 'image' && f.downloadUrl ? [{ ...f, url: f.downloadUrl }] : [],
  )

  return (
    <>
      {files.length > 0 && (
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
                onOpen={() => setPreview(images.findIndex((i) => i.id === f.id))}
                onError={retry}
              />
            ),
          )}
          <ImageLightbox
            images={images}
            index={preview}
            onIndexChange={setPreview}
            onDownload={onDownload && ((i) => onDownload(images[i]))}
          />
        </div>
      )}
      {children?.(new Set(images.map((f) => f.fileName)))}
    </>
  )
}
