import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'

import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { MEDIA_BOX, previewKind } from './transferDownloads'

import type { FileTransferFile } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images and videos in a transfer group, whichever
// side sent it. Presigned URLs last minutes, so a preview that breaks after
// its links have aged re-resolves them. Every image and video gets the same
// box, drawn empty while the links resolve, and the preview steps through all
// the images. `children` receives the names of the images and videos actually
// previewed (null while resolving), so a card can list every other file as a row.
export function TransferPreviews({
  teamId,
  groupId,
  expected,
  onDownload,
  alignEnd = false,
  children,
}: {
  teamId: string
  groupId: string
  /** How many previews the group should have, drawn as empty boxes until resolved. */
  expected: number
  /** Right-align the thumbnails, for files the user sent. */
  alignEnd?: boolean
  onDownload?: (file: FileTransferFile) => void
  children?: (
    previewedImages: ReadonlySet<string> | null,
    previewedVideos: ReadonlySet<string> | null,
  ) => ReactNode
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
  const rowClass = clsx('mb-2 flex flex-wrap gap-2', alignEnd && 'justify-end')

  if (files === null)
    return (
      <>
        <div className={rowClass}>
          {Array.from({ length: expected }, (_, i) => (
            <ImageAttachmentThumb key={i} size="lg" fileName="" />
          ))}
        </div>
        {children?.(null, null)}
      </>
    )
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
        <div className={rowClass}>
          {files.map((f) =>
            previewKind(f) === 'video' ? (
              <video
                key={f.id}
                src={f.downloadUrl}
                controls
                preload="metadata"
                onError={retry}
                title={f.fileName}
                className={clsx(MEDIA_BOX, 'rounded-lg border border-zGray-800 bg-black')}
              />
            ) : (
              <ImageAttachmentThumb
                key={f.id}
                size="lg"
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
      {children?.(
        new Set(images.map((f) => f.fileName)),
        new Set(files.flatMap((f) => (previewKind(f) === 'video' ? [f.fileName] : []))),
      )}
    </>
  )
}
