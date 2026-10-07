import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { FileSearch } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api'
import { useReportVisibleError } from '../../VisibleErrorReporter'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { ImageAttachmentThumb } from './messageInline'
import { previewKind } from './transferDownloads'

import type { TransferUploadPart } from './parts'
import type { FileTransferGroup } from '../../../types'

// Files the agent produced for the user. Bytes live in the transfer store.
// Images (click to enlarge) and videos play inline; every file can still be saved
// via a native dialog (single file) or streamed into a local zip.
export function DownloadFilesCard({ group, teamId }: { group: FileTransferGroup; teamId: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  // Expiry is metadata on the card, but an idle conversation has no renders
  // after the turn settles — so schedule a single re-render at the expiry
  // instant, otherwise the card would keep offering downloads past expiresAt
  // until some unrelated render happens (the backend would then 410).
  const [now, setNow] = useState(() => Date.now())
  const expiresAtMs = new Date(group.expiresAt).getTime()
  const expired = now > expiresAtMs

  useEffect(() => {
    if (expired) return
    const ms = Math.max(0, expiresAtMs - Date.now()) + 250
    const timer = setTimeout(() => setNow(Date.now()), ms)

    return () => clearTimeout(timer)
  }, [expiresAtMs, expired])
  const ready = group.files.filter((f) => f.status === 'ready')
  const failedCount = group.files.filter((f) => f.status === 'failed').length

  useReportVisibleError(
    failedCount > 0 ? `${String(failedCount)} generated file transfer(s) failed.` : null,
    'agent_download_file_failed',
  )
  // Team-scoped resolve (no sessionId) — the group is team+user scoped.
  const base = { teamId, groupId: group.groupId }
  const previews = expired ? [] : ready.filter((f) => previewKind(f) !== null)

  function savedToast(title: string, description: string, path: string) {
    // "Open in folder" lives only on the (transient) toast — right after the
    // save the file definitely exists. A persistent button could point at a
    // file the user later deleted.
    toast.success(title, description, {
      action: {
        label: 'Open in folder',
        onClick: () => {
          void Promise.resolve(api.fileTransferRevealInFolder(path)).catch(() =>
            toast.error('Could not open folder'),
          )
        },
      },
    })
  }

  async function downloadOne(fileId: string, fileName: string) {
    setBusy(fileId)
    try {
      const r = await api.fileTransferDownloadOne({ ...base, fileId, fileName })

      if (r.saved && r.path) savedToast('Saved', fileName, r.path)
    } catch (err) {
      toast.apiError('Download failed', err)
    } finally {
      setBusy(null)
    }
  }

  async function downloadZip() {
    setBusy('__zip__')
    try {
      const r = await api.fileTransferDownloadAllZip({ ...base, zipName: group.label || 'files' })

      if (r.saved && r.path)
        savedToast('Saved zip', `${String(r.count ?? ready.length)} file(s)`, r.path)
    } catch (err) {
      toast.apiError('Download failed', err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-full max-w-[85%] self-start rounded-xl border border-zGray-800 bg-zGray-900/60 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-tertiary">
          <FileSearch className="h-3 w-3" strokeWidth={2} />
          {expired
            ? 'Expired — files are no longer available'
            : `${String(ready.length)} file${ready.length === 1 ? '' : 's'} ready to download`}
        </span>
        {!expired && ready.length > 1 && (
          <Button
            variant="primary"
            onClick={() => void downloadZip()}
            disabled={busy !== null}
            className="h-auto rounded px-1.5 py-[4px] text-[10px] font-medium leading-tight"
          >
            {busy === '__zip__' ? 'Zipping…' : 'Download all as zip'}
          </Button>
        )}
      </div>
      {previews.length > 0 && (
        <DownloadPreviews teamId={teamId} groupId={group.groupId} files={previews} />
      )}
      <div className={clsx('flex flex-col gap-1', expired && 'opacity-50')}>
        {group.files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={clsx(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                expired
                  ? 'bg-tertiary'
                  : f.status === 'ready'
                    ? 'bg-success'
                    : f.status === 'failed'
                      ? 'bg-error'
                      : 'bg-tertiary',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-secondary" title={f.relPath}>
              {f.fileName}
            </span>
            <span className="flex-shrink-0 text-tertiary">{formatTransferBytes(f.size)}</span>
            {!expired && f.status === 'ready' && (
              <Button
                variant="ghost"
                onClick={() => void downloadOne(f.id, f.fileName)}
                disabled={busy !== null}
                className="h-auto flex-shrink-0 rounded px-1.5 py-[3px] text-[10px] font-medium leading-tight"
              >
                {busy === f.id ? '…' : 'Download'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Inline previews for the images and videos in a download group, from
// presigned URLs. Those last minutes, so a broken preview re-resolves them once.
function DownloadPreviews({
  teamId,
  groupId,
  files,
}: {
  teamId: string
  groupId: string
  files: FileTransferGroup['files']
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [retried, setRetried] = useState(false)
  const resolve = useCallback(() => {
    void api
      .fileTransferResolve({ teamId, groupId })
      .then((resolved) =>
        setUrls(
          Object.fromEntries(
            resolved.files.flatMap((f) => (f.downloadUrl ? [[f.id, f.downloadUrl]] : [])),
          ),
        ),
      )
      .catch(() => {
        // The download rows still work; a missing preview is not fatal.
      })
  }, [teamId, groupId])

  useEffect(resolve, [resolve])
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
          urls[f.id] && (
            <video
              key={f.id}
              src={urls[f.id]}
              controls
              preload="metadata"
              onError={retry}
              title={f.fileName}
              className="max-h-72 max-w-full rounded-lg border border-zGray-800 bg-black"
            />
          )
        ) : (
          <ImageAttachmentThumb
            key={f.id}
            large
            url={urls[f.id]}
            fileName={f.fileName}
            onError={retry}
          />
        ),
      )}
    </div>
  )
}

function formatTransferBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// User-uploaded files. Bytes already live in the transfer store;
// the agent pulls them into its sandbox. Read-only card (no actions here).
export function UploadedFilesCard({ part }: { part: TransferUploadPart }) {
  const total = part.files.length
  const ready = part.files.filter((f) => f.status === 'ready').length
  const uploading = part.status === 'uploading'
  const errored = part.status === 'error'

  useReportVisibleError(errored ? 'Agent attachment upload failed.' : null, 'agent_upload_failed')
  const entries = part.archiveEntryCount
  const archiveSuffix =
    entries == null ? '' : ` · ${String(entries)} file${entries === 1 ? '' : 's'}`
  const readySuffix = ready < total ? ` · ${String(ready)}/${String(total)} ready` : ''

  return (
    <div className="w-full max-w-[min(85%,480px)] self-end rounded-xl border border-zGray-800 bg-zGray-900/60 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-tertiary">
        {uploading ? (
          <FontAwesomeIcon icon={faSpinner} spin className="h-3 w-3" />
        ) : (
          <FileSearch className="h-3 w-3" strokeWidth={2} />
        )}
        <span>
          {uploading
            ? `Uploading ${String(total)} file${total === 1 ? '' : 's'}…`
            : errored
              ? 'Upload failed'
              : part.archive
                ? `Uploaded folder${archiveSuffix}`
                : `Uploaded ${String(total)} file${total === 1 ? '' : 's'}${readySuffix}`}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {part.files.map((f, i) => (
          <div key={`${f.fileName}:${String(i)}`} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={clsx(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                f.status === 'ready'
                  ? 'bg-success'
                  : f.status === 'failed'
                    ? 'bg-error'
                    : uploading
                      ? 'animate-pulse bg-tertiary'
                      : 'bg-tertiary',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-secondary">{f.fileName}</span>
            <span className="flex-shrink-0 text-tertiary">
              {uploading ? '' : formatTransferBytes(f.size)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
