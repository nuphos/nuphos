import { useEffect, useState } from 'react'

import { api } from '../../api'
import { toast } from '../ui/toast'

import { ImageLightbox } from './panel/messageInline'
import { MEDIA_BOX } from './panel/transferDownloads'

import type { FileTransferGroup } from '../../types'

const FRAME = `block rounded-lg border border-zGray-800 bg-zGray-900 ${MEDIA_BOX}`

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
  const name = alt?.trim() ? alt : (src.split(/[?#]/)[0].split('/').pop() ?? 'Image')

  return (
    <>
      <button
        type="button"
        className="max-w-full cursor-zoom-in align-middle"
        aria-label={`Preview ${name}`}
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
  const [error, setError] = useState(false)
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
      () => {
        if (active) setError(true)
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
    setError(false)
    setAttempt((n) => n + 1)
  }
  const file = group?.files.find((item) => item.status === 'ready' && item.downloadUrl)

  if (!teamId || error || (group && !file))
    return (
      <span role="status">
        Image unavailable or expired.{' '}
        <button type="button" onClick={retry}>
          Retry
        </button>
      </span>
    )
  if (!group || !file?.downloadUrl)
    return (
      <span role="status" aria-label={`Loading ${alt ?? 'image'}`} className={`my-2 ${FRAME}`} />
    )
  if (Date.parse(group.expiresAt) <= now)
    return <span role="status">Image expired — files are no longer available.</span>
  const download = () => {
    void api
      .fileTransferDownloadOne({ teamId, groupId, fileId: file.id, fileName: file.fileName })
      .catch(() => toast.error('Could not download image'))
  }

  return (
    <span className="my-2 block">
      <button
        type="button"
        onClick={() => setPreview(0)}
        aria-label={`Preview ${alt ?? file.fileName}`}
      >
        <img
          src={file.downloadUrl}
          alt={alt ?? file.fileName}
          className={`object-cover ${FRAME}`}
          onError={() => setError(true)}
        />
      </button>
      <span className="block text-xs text-tertiary">
        Available until {new Date(group.expiresAt).toLocaleString()}.{' '}
        <button type="button" onClick={download}>
          Download
        </button>
      </span>
      <ImageLightbox
        images={[{ url: file.downloadUrl, fileName: file.fileName }]}
        index={preview}
        onIndexChange={setPreview}
        onDownload={download}
      />
    </span>
  )
}
