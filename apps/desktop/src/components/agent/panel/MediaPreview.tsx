import clsx from 'clsx'
import { FileText, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'

import { MEDIA_BOX, MEDIA_FRAME, PDF_PREVIEW_BYTES_MAX } from './transferDownloads'

import type { ViewerKind } from './transferDownloads'
import type { FileTransferFile } from '../../../types'

/**
 * A file the agent sent, shown in place as what it is: an image, a video or a
 * PDF is a square at the chat's media size that the caller's lightbox opens
 * full size; audio plays in place with the browser's own controls. A file with
 * no viewer of its own keeps the image slot it had — offered rather than run.
 */
export function MediaPreview({
  file,
  kind,
  alt,
  onOpen,
  onError,
}: {
  file: FileTransferFile
  /** What it is, from `viewerKind`; null when nothing renders it in place. */
  kind: ViewerKind | null
  alt?: string
  /** Opens the file full size: the lightbox belongs to the caller. */
  onOpen: () => void
  /** It cannot be shown or played: the caller shows what it shows for a broken file. */
  onError: () => void
}) {
  const url = file.downloadUrl
  const name = alt ?? file.fileName

  if (!url) return null

  if (kind === 'video')
    return <VideoThumb url={url} name={name} onOpen={onOpen} onError={onError} />
  if (kind === 'audio')
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        aria-label={name}
        onError={onError}
        className="w-full max-w-md"
      />
    )
  if (kind === 'pdf')
    return (
      <button
        type="button"
        onClick={onOpen}
        title={name}
        aria-label={t('Preview {name}', { name })}
        className={clsx(
          MEDIA_FRAME,
          'flex cursor-zoom-in items-center justify-center text-status-danger',
        )}
      >
        <FileText className="h-6 w-6" />
      </button>
    )

  return (
    <button type="button" onClick={onOpen} aria-label={t('Preview {name}', { name })}>
      <img src={url} alt={name} onError={onError} className={`object-cover ${MEDIA_FRAME}`} />
    </button>
  )
}

/**
 * A video's square: the still frame with a play badge, opened full size by the
 * caller. Audio has no frame, so its square carries the file name instead.
 */
export function VideoThumb({
  url,
  name,
  audio,
  onOpen,
  onError,
}: {
  url: string
  name: string
  audio?: boolean
  onOpen: () => void
  onError?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={name}
      aria-label={t('Play {name}', { name })}
      className={clsx(
        MEDIA_BOX,
        'relative flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-line-control',
        audio ? 'bg-surface-sheet' : 'bg-black',
      )}
    >
      {audio ? (
        <span className="absolute inset-x-1.5 bottom-1 truncate text-[10px] leading-4 text-secondary">
          {name}
        </span>
      ) : (
        <video
          src={url}
          preload="metadata"
          muted
          onError={onError}
          className="h-full w-full object-cover"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" strokeWidth={2} />
        </span>
      </span>
    </button>
  )
}

/** Where a PDF's bytes live: the group's file record, not its presigned link. */
export type PdfSource = { teamId: string; groupId: string; fileId: string; size: number | null }

/**
 * A PDF in a frame of its own, over a blob of bytes the main process read.
 *
 * The read goes through `fileTransfer:readOne`, not a renderer fetch: the store
 * sends no CORS headers and serves the object as an attachment, so fetching its
 * link fails and framing it downloads it. The main process streams the body and
 * stops at the cap, which also covers a file whose record has no size.
 *
 * The frame carries no `sandbox` on purpose: Chromium will not open its PDF
 * viewer in a sandboxed frame at all — `sandbox=""` and
 * `sandbox="allow-same-origin"` both fail the load with ERR_BLOCKED_BY_CLIENT —
 * and the only sandbox that renders carries `allow-scripts`, not a thing to hand
 * a file the agent chose. The bytes are wrapped as `application/pdf` so the type
 * is certain whoever wrote them.
 */
export function PdfFrame({ source, name }: { source: PdfSource; name: string }) {
  const { teamId, groupId, fileId, size } = source
  // A size the record already rules out is failed from the start, never read.
  const tooBig = size !== null && size > PDF_PREVIEW_BYTES_MAX
  const [blob, setBlob] = useState<string | null>(null)
  const [failed, setFailed] = useState(tooBig)

  useEffect(() => {
    if (tooBig) return
    let active = true
    let made: string | undefined

    void api.fileTransferReadOne({ teamId, groupId, fileId, maxBytes: PDF_PREVIEW_BYTES_MAX }).then(
      (bytes) => {
        if (!active) return
        if (!bytes) {
          setFailed(true)

          return
        }
        // The type is stated here on purpose, rather than taken from the store:
        // whatever the store said, the frame is handed a PDF.
        made = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setBlob(made)
      },
      // An expired link, a body that never arrived, or a store that refused it.
      () => {
        if (active) setFailed(true)
      },
    )

    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [teamId, groupId, fileId, size, tooBig])

  if (failed)
    return (
      <span role="status" className="text-[13px] text-white/80">
        {t('Preview unavailable')}
      </span>
    )

  if (blob)
    return (
      <iframe src={blob} title={name} className="h-full w-full rounded-lg bg-white shadow-2xl" />
    )

  return <span role="status" aria-label={t('Loading {name}', { name })} />
}
