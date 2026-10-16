import clsx from 'clsx'
import { Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'

import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { MEDIA_BOX, previewKind } from './transferDownloads'

import type { FileTransferFile } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images and videos in a transfer group, whichever
// side sent it. Presigned URLs last minutes, so a preview that breaks after
// its links have aged re-resolves them. Every image and video gets the same
// square, drawn empty while the links resolve; the preview opens any of them
// full size and steps through all of them. `children` receives the names of
// the images and videos actually previewed (null while resolving), so a card
// can list every other file as a row.
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
            <ImageAttachmentThumb key={i} size="md" fileName="" />
          ))}
        </div>
        {children?.(null, null)}
      </>
    )
  // A link that fails right after resolving is broken, not expired: don't loop.
  const retry = () => {
    if (Date.now() - resolvedAt.current > 60_000) resolve()
  }
  const media = files.flatMap((f) =>
    f.downloadUrl ? [{ ...f, url: f.downloadUrl, video: previewKind(f) === 'video' }] : [],
  )

  return (
    <>
      {media.length > 0 && (
        <div className={rowClass}>
          {media.map((f, i) =>
            f.video ? (
              <button
                key={f.id}
                type="button"
                onClick={() => setPreview(i)}
                title={f.fileName}
                aria-label={`Play ${f.fileName}`}
                className={clsx(
                  MEDIA_BOX,
                  'relative flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-zGray-800 bg-black',
                )}
              >
                <video
                  src={f.url}
                  preload="metadata"
                  muted
                  onError={retry}
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
                    <Play className="ml-0.5 h-3.5 w-3.5 fill-current" strokeWidth={2} />
                  </span>
                </span>
              </button>
            ) : (
              <ImageAttachmentThumb
                key={f.id}
                size="md"
                url={f.url}
                fileName={f.fileName}
                onOpen={() => setPreview(i)}
                onError={retry}
              />
            ),
          )}
          <ImageLightbox
            images={media}
            index={preview}
            onIndexChange={setPreview}
            onDownload={onDownload && ((i) => onDownload(media[i]))}
          />
        </div>
      )}
      {children?.(
        new Set(media.flatMap((f) => (f.video ? [] : [f.fileName]))),
        new Set(media.flatMap((f) => (f.video ? [f.fileName] : []))),
      )}
    </>
  )
}
