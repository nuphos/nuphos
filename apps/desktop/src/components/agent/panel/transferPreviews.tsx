import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api'

import { ImageAttachmentThumb } from './messageInline'
import { previewKind } from './transferDownloads'

import type { FileTransferGroup } from '../../../types'
import type { ReactNode } from 'react'

// Inline previews for the images and videos in a transfer group, whichever
// side sent it. Presigned URLs last minutes, so a broken preview re-resolves
// them once.
export function TransferPreviews({
  teamId,
  groupId,
  fallback = null,
}: {
  teamId: string
  groupId: string
  /** Shown when nothing can be previewed (expired, or someone else's files). */
  fallback?: ReactNode
}) {
  const [files, setFiles] = useState<FileTransferGroup['files'] | null>(null)
  const [retried, setRetried] = useState(false)
  const resolve = useCallback(() => {
    void api
      .fileTransferResolve({ teamId, groupId })
      .then((resolved) => setFiles(resolved.files.filter((f) => f.downloadUrl && previewKind(f))))
      .catch(() => setFiles([]))
  }, [teamId, groupId])

  useEffect(resolve, [resolve])
  if (files === null) return <></>
  if (files.length === 0) return <>{fallback}</>
  const retry = retried
    ? undefined
    : () => {
        setRetried(true)
        resolve()
      }

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
            large
            url={f.downloadUrl}
            fileName={f.fileName}
            onError={retry}
          />
        ),
      )}
    </div>
  )
}
