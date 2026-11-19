import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'

import { VideoThumb } from './MediaPreview'
import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { previewKind } from './transferDownloads'

import type { FileTransferFile } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images, videos and audio in a transfer group (or several,
// drawn as one row with one pager), whichever side sent it. Presigned URLs last minutes, so a preview that breaks after
// its links have aged re-resolves them. Every one gets the same square, drawn
// empty while the links resolve; the preview opens any of them full size (or
// plays it) and steps through all of them. `children` receives the names of
// the files actually previewed (null while resolving), so a card can list
// every other file as a row.
export function TransferPreviews({
  teamId,
  groupId,
  expected,
  onDownload,
  alignEnd = false,
  channelId,
  children,
}: {
  teamId: string
  groupId: string | readonly string[]
  /** How many previews the group should have, drawn as empty boxes until resolved. */
  expected: number
  /** Right-align the thumbnails, for files the user sent. */
  alignEnd?: boolean
  onDownload?: (file: FileTransferFile & { groupId: string }) => void
  /** A chat's files load through the chat, so every member sees them. */
  channelId?: string
  children?: (previewed: ReadonlySet<string> | null) => ReactNode
}) {
  const [files, setFiles] = useState<(FileTransferFile & { groupId: string })[] | null>(null)
  // A stable key for the effect: an array prop is a new value on every render.
  const groups = typeof groupId === 'string' ? groupId : groupId.join(',')
  const [preview, setPreview] = useState<number | null>(null)
  const resolvedAt = useRef(0)
  const resolve = useCallback(() => {
    resolvedAt.current = Date.now()
    void Promise.all(
      groups.split(',').map((id) =>
        api
          .fileTransferResolve({ teamId, groupId: id, ...(channelId ? { channelId } : {}) })
          .then((resolved) => resolved.files.map((f) => ({ ...f, groupId: id })))
          // An expired group has nothing to show; the others still do.
          .catch(() => []),
      ),
    ).then((resolved) => setFiles(resolved.flat().filter((f) => f.downloadUrl && previewKind(f))))
  }, [teamId, groups, channelId])

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
        {children?.(null)}
      </>
    )
  // A link that fails right after resolving is broken, not expired: don't loop.
  const retry = () => {
    if (Date.now() - resolvedAt.current > 60_000) resolve()
  }
  const media = files.flatMap((f) => {
    const kind = previewKind(f)

    return f.downloadUrl
      ? [{ ...f, url: f.downloadUrl, video: kind === 'video', audio: kind === 'audio' }]
      : []
  })

  return (
    <>
      {media.length > 0 && (
        <div className={rowClass}>
          {media.map((f, i) =>
            f.video || f.audio ? (
              <VideoThumb
                key={f.id}
                url={f.url}
                name={f.fileName}
                audio={f.audio}
                onOpen={() => setPreview(i)}
                onError={retry}
              />
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
      {children?.(new Set(media.map((f) => f.fileName)))}
    </>
  )
}
