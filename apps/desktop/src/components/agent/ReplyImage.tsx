import { useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { t } from '../../i18n'
import { toast } from '../ui/toast'

import { MediaPreview } from './panel/MediaPreview'
import { ImageLightbox } from './panel/messageInline'
import { MEDIA_FRAME, viewerKind } from './panel/transferDownloads'

import type { PdfSource } from './panel/MediaPreview'
import type { LightboxImage } from './panel/messageInline'
import type { FileTransferGroup } from '../../types'

/** What the lightbox shows this reply full size: a PDF is framed from its record, anything else is its own link. */
function lightboxItem(
  file: FileTransferGroup['files'][number],
  url: string,
  kind: ReturnType<typeof viewerKind>,
  source: Omit<PdfSource, 'fileId' | 'size'>,
): LightboxImage {
  if (kind === 'pdf')
    return { fileName: file.fileName, pdf: { ...source, fileId: file.id, size: file.size } }

  return { url, fileName: file.fileName, video: kind === 'video' }
}

/**
 * Any other markdown or HTML image (GitHub bodies and comments included):
 * clicking it opens the shared lightbox, even when the image sits inside a link.
 */
export function MarkdownImage({
  src,
  alt,
  width,
  height,
}: {
  src?: string
  alt?: string
  width?: number | string
  height?: number | string
}) {
  const [preview, setPreview] = useState<number | null>(null)

  if (!src) return null
  const name = alt?.trim() ? alt : (src.split(/[?#]/)[0].split('/').pop() ?? t('Image'))

  return (
    <>
      <button
        type="button"
        className="max-w-full cursor-zoom-in align-middle"
        aria-label={t('Preview {name}', { name })}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setPreview(0)
        }}
      >
        <img src={src} alt={alt} width={width} height={height} className="max-w-full rounded-lg" />
      </button>
      <ImageLightbox
        images={[{ url: src, fileName: name }]}
        index={preview}
        onIndexChange={setPreview}
      />
    </>
  )
}

/** A reply file that could not be shown, for a reason a retry may fix. */
function Unavailable({
  previewable,
  onRetry,
  onDownload,
}: {
  previewable: boolean
  onRetry: () => void
  onDownload: () => void
}) {
  return (
    <span role="status">
      {previewable ? t('Preview unavailable') : t('Image unavailable or expired.')}{' '}
      <button type="button" onClick={onRetry}>
        {t('Retry')}
      </button>
      {previewable && (
        <button type="button" className="ml-1" onClick={onDownload}>
          {t('Download')}
        </button>
      )}
    </span>
  )
}

/** Past its lifetime a group is refused, then deleted: no retry brings it back. */
const GONE = new Set(['transfer_expired', 'transfer_not_found'])
const failureOf = (failure: unknown) =>
  GONE.has(parseAtlasError(failure).code ?? '') ? 'gone' : 'error'

/** Resolve a persisted group reference with the viewer's own credentials. */
export function ReplyImage({
  groupId,
  teamId,
  alt,
}: {
  groupId: string
  teamId?: string
  alt?: string
}) {
  const [group, setGroup] = useState<FileTransferGroup | null>(null)
  const [failure, setFailure] = useState<'gone' | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    let active = true

    if (!teamId) return
    void api.fileTransferResolve({ teamId, groupId }).then(
      (result) => {
        if (active) setGroup(result)
      },
      (reason: unknown) => {
        if (active) setFailure(failureOf(reason))
      },
    )

    return () => {
      active = false
    }
  }, [teamId, groupId, attempt])

  useEffect(() => {
    if (!group) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Date.parse(group.expiresAt) - Date.now()) + 250,
    )

    return () => clearTimeout(timer)
  }, [group])

  const retry = () => {
    setGroup(null)
    setFailure(null)
    setAttempt((n) => n + 1)
  }
  const file = group?.files.find((item) => item.status === 'ready' && item.downloadUrl)
  const url = file?.downloadUrl
  // Which viewer takes it; a file nothing renders in place keeps the image slot.
  const kind = file ? viewerKind(file.fileName, file.contentType) : null
  const download = () => {
    if (!teamId || !file) return
    void api
      .fileTransferDownloadOne({ teamId, groupId, fileId: file.id, fileName: file.fileName })
      .catch(() => toast.error(t('Could not download image')))
  }

  const expired = <span role="status">{t('File expired — no longer available.')}</span>

  if (failure === 'gone') return expired
  if (!teamId || failure || (group && !file))
    return <Unavailable previewable={kind !== null} onRetry={retry} onDownload={download} />
  if (!group || !file || !url)
    return (
      <span
        role="status"
        aria-label={t('Loading {name}', { name: alt ?? t('image') })}
        className={`my-2 ${MEDIA_FRAME}`}
      />
    )
  if (Date.parse(group.expiresAt) <= now) return expired

  return (
    <span className="my-2 block">
      <MediaPreview
        file={file}
        kind={kind}
        alt={alt}
        onOpen={() => setPreview(0)}
        onError={() => setFailure('error')}
      />
      <span className="block text-xs text-tertiary">
        {t('Available until {time}.', { time: new Date(group.expiresAt).toLocaleString() })}{' '}
        <button type="button" onClick={download}>
          {t('Download')}
        </button>
      </span>
      <ImageLightbox
        images={[lightboxItem(file, url, kind, { teamId, groupId })]}
        index={preview}
        onIndexChange={setPreview}
        onDownload={download}
      />
    </span>
  )
}
