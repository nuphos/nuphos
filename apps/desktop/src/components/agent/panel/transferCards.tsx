import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { FileSearch } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { useReportVisibleError } from '../../VisibleErrorReporter'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { filesBesidePreviews, mediaKind, previewKind } from './transferDownloads'
import { TransferPreviews } from './transferPreviews'

import type { TransferUploadPart } from './parts'
import type { FileTransferGroup } from '../../../types'

// Files the agent produced for the user. Bytes live in the transfer store.
// Images show as thumbnails (saved from the preview) and videos play inline, with
// no frame around them; any other file is a row saved through a native dialog,
// and several rows can be saved together as a zip of the whole group.
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
  const hasPreviews = !expired && ready.some((f) => previewKind(f) !== null)

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

  function fileRows(files: FileTransferGroup['files']) {
    if (files.length === 0) return null
    // Images are saved from their preview; several listed files can go in one zip.
    const zippable = !expired && files.filter((f) => f.status === 'ready').length > 1

    return (
      <div className={clsx('flex flex-col gap-1', expired && 'opacity-50')}>
        {files.map((f) => (
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
        {zippable && (
          <Button
            variant="ghost"
            onClick={() => void downloadZip()}
            disabled={busy !== null}
            title="Saves every file in this group, images included"
            className="h-auto self-start rounded px-1.5 py-[3px] text-[10px] font-medium leading-tight"
          >
            {busy === '__zip__' ? 'Zipping…' : 'Download all as zip'}
          </Button>
        )}
      </div>
    )
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

  return (
    <div className="w-full max-w-[85%] self-start">
      {expired && (
        <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-tertiary">
          <FileSearch className="h-3 w-3" strokeWidth={2} />
          Expired — files are no longer available
        </p>
      )}
      {hasPreviews ? (
        <TransferPreviews
          teamId={teamId}
          groupId={group.groupId}
          onDownload={(f) => void downloadOne(f.id, f.fileName)}
        >
          {(previewed) => fileRows(filesBesidePreviews(group.files, previewed))}
        </TransferPreviews>
      ) : (
        fileRows(group.files)
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
// Images show as thumbnails above it; when nothing else is left to list, the
// card itself is dropped so a photo message reads as photos.
export function UploadedFilesCard({ part, teamId }: { part: TransferUploadPart; teamId?: string }) {
  const previewTeam =
    part.status !== 'uploading' &&
    part.status !== 'error' &&
    part.groupId &&
    !part.archive &&
    part.files.some((f) => mediaKind(f.fileName))
      ? teamId
      : undefined

  if (!previewTeam) return <UploadedFilesList part={part} rows={part.files} />

  return (
    <div className="flex w-full max-w-[min(85%,480px)] flex-col items-end self-end">
      <TransferPreviews teamId={previewTeam} groupId={part.groupId}>
        {(previewed) => {
          const rows = filesBesidePreviews(part.files, previewed)

          return rows.length > 0 && <UploadedFilesList part={part} rows={rows} />
        }}
      </TransferPreviews>
    </div>
  )
}

function UploadedFilesList({
  part,
  rows,
}: {
  part: TransferUploadPart
  rows: TransferUploadPart['files']
}) {
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
        {rows.map((f, i) => (
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
