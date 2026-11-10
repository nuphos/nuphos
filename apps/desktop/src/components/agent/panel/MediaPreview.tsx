import { useEffect, useState } from 'react'

import { useStableCallback } from '../../../hooks/useStableCallback'
import { t } from '../../../i18n'

import { MEDIA_FRAME } from './transferDownloads'

import type { ViewerKind } from './transferDownloads'
import type { FileTransferFile } from '../../../types'

// The most of a PDF a preview reads into memory. Media streams from its URL and
// is never read whole; a PDF has to be, so a bigger one is left to Download.
export const PDF_PREVIEW_BYTES_MAX = 25 * 1024 * 1024

/**
 * A file the agent sent, shown in place as what it is: an image (opened full
 * size by the caller's lightbox), a video or an audio file with the browser's
 * own controls, or a PDF in a frame of its own. A file with no viewer of its
 * own keeps the image slot it had — offered rather than run.
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
  /** An image opens full size: the lightbox belongs to the caller. */
  onOpen: () => void
  /** It cannot be shown or played: the caller shows what it shows for a broken file. */
  onError: () => void
}) {
  const url = file.downloadUrl
  const name = alt ?? file.fileName

  if (!url) return null

  if (kind === 'video')
    return (
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={name}
        onError={onError}
        className="max-h-[480px] w-full rounded-lg border border-line-control bg-black"
      />
    )
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
  if (kind === 'pdf') return <PdfPreview file={file} url={url} name={name} onError={onError} />

  return (
    <button type="button" onClick={onOpen} aria-label={t('Preview {name}', { name })}>
      <img src={url} alt={name} onError={onError} className={`object-cover ${MEDIA_FRAME}`} />
    </button>
  )
}

/**
 * A PDF in a frame of its own, over a blob of the file: what the frame holds is
 * that file and nothing else. Sandboxed with no scripts and no origin of its
 * own, so a PDF cannot run anything or reach the app; a file the size cap rules
 * out is left to the caller's fallback.
 */
function PdfPreview({
  file,
  url,
  name,
  onError,
}: {
  file: FileTransferFile
  url: string
  name: string
  onError: () => void
}) {
  const [blob, setBlob] = useState<string | null>(null)
  const fail = useStableCallback(onError)

  useEffect(() => {
    let active = true
    let made: string | undefined
    const load = async () => {
      // A size the record already rules out is never fetched at all.
      if (file.size !== null && file.size > PDF_PREVIEW_BYTES_MAX) return null
      const response = await fetch(url)

      // An expired link answers with an error document, not the file.
      if (!response.ok) return null
      const bytes = await response.arrayBuffer()

      // The record's size can be stale, so the bytes decide too.
      return bytes.byteLength > PDF_PREVIEW_BYTES_MAX ? null : bytes
    }

    void load().then(
      (bytes) => {
        if (!active) return
        if (!bytes) {
          fail()
          return
        }
        made = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setBlob(made)
      },
      // A presigned link that expired or failed, or a body that never arrived.
      fail,
    )

    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [url, file.size, fail])

  // No scripts, no same-origin: never allow-scripts on a file the agent chose.
  return blob ? (
    <iframe
      src={blob}
      title={name}
      sandbox=""
      className="h-[480px] w-full rounded-lg border border-line-control bg-white"
    />
  ) : (
    <span role="status" aria-label={t('Loading {name}', { name })} className={MEDIA_FRAME} />
  )
}
