import clsx from 'clsx'
import { CircleAlert, File, Folder, FolderDown, Loader2, TimerOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import {
  filesBesidePreviews,
  formatTransferBytes,
  mediaKind,
  previewKind,
} from './transferDownloads'
import { FileRow } from './transferFileRow'
import { TransferPreviews } from './transferPreviews'

import type { TransferUploadPart } from './parts'
import type { FileTransferGroup } from '../../../types'
import type { LucideIcon } from 'lucide-react'

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
        label: t('Open in folder'),
        onClick: () => {
          void Promise.resolve(api.fileTransferRevealInFolder(path)).catch(() =>
            toast.error(t('Could not open folder')),
          )
        },
      },
    })
  }

  function fileRows(files: FileTransferGroup['files']) {
    if (files.length === 0) return null
    // Images are saved from their preview; several listed files can go in one zip.
    const zippable = !expired && files.filter((f) => f.status === 'ready').length > 1
    const multiple = files.length > 1
    const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0)

    return (
      <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-zGray-800 bg-surface">
        {(multiple || expired) && (
          <div className="flex h-10 items-center justify-between gap-2 border-b border-zGray-800 pl-3.5 pr-2 text-[12px] text-tertiary">
            {expired ? (
              <span className="flex items-center gap-1.5">
                <TimerOff className="h-3.5 w-3.5" strokeWidth={2} />
                {t('Expired — files are no longer available')}
              </span>
            ) : (
              <span>
                {t('{n} files', { n: String(files.length) })} · {formatTransferBytes(total)}
              </span>
            )}
            {zippable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void downloadZip()}
                disabled={busy !== null}
                title={t('Saves every file in this group, images included')}
                className="gap-1.5"
              >
                <FolderDown className="h-3.5 w-3.5" />
                {busy === '__zip__' ? t('Zipping…') : t('Download all as zip')}
              </Button>
            )}
          </div>
        )}
        {files.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            expired={expired}
            compact={multiple}
            busy={busy}
            onDownload={() => void downloadOne(f.id, f.fileName)}
          />
        ))}
      </div>
    )
  }

  async function downloadZip() {
    setBusy('__zip__')
    try {
      const r = await api.fileTransferDownloadAllZip({ ...base, zipName: group.label || 'files' })

      if (r.saved && r.path)
        savedToast(t('Saved zip'), t('{n} file(s)', { n: String(r.count ?? ready.length) }), r.path)
    } catch (err) {
      toast.apiError(t('Download failed'), err)
    } finally {
      setBusy(null)
    }
  }

  async function downloadOne(fileId: string, fileName: string) {
    setBusy(fileId)
    try {
      const r = await api.fileTransferDownloadOne({ ...base, fileId, fileName })

      if (r.saved && r.path) savedToast(t('Saved'), fileName, r.path)
    } catch (err) {
      toast.apiError(t('Download failed'), err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-full max-w-[85%] self-start">
      {hasPreviews ? (
        <TransferPreviews
          teamId={teamId}
          groupId={group.groupId}
          expected={ready.filter((f) => previewKind(f)).length}
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

// User-uploaded files. Bytes already live in the transfer store;
// the agent pulls them into its sandbox. Read-only card (no actions here).
// Images and videos preview above it; the card lists only the rest (a previewed
// video has no Download row to keep here), and is dropped when nothing is left.
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
    <div className="flex max-w-[480px] flex-col items-end self-end">
      <TransferPreviews
        teamId={previewTeam}
        groupId={part.groupId}
        expected={part.files.filter((f) => mediaKind(f.fileName)).length}
        alignEnd
      >
        {(images, videos) => {
          const rows = filesBesidePreviews(part.files, images).filter((f) =>
            videos ? !videos.has(f.fileName) : mediaKind(f.fileName) !== 'video',
          )

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
  const uploading = part.status === 'uploading'
  const errored = part.status === 'error'

  useReportVisibleError(errored ? 'Agent attachment upload failed.' : null, 'agent_upload_failed')
  const entries = part.archiveEntryCount

  return (
    <div className="flex max-w-[480px] flex-wrap justify-end gap-1.5 self-end">
      {rows.map((f, i) => {
        const failed = errored || f.status === 'failed'
        const Icon = uploadIcon(uploading, failed, part.archive)

        return (
          <span
            key={`${f.fileName}:${String(i)}`}
            className={clsx(
              'flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-surface px-3 text-[13px]',
              failed ? 'border-error/30 text-error' : 'border-zGray-800 text-main',
            )}
          >
            <Icon
              className={clsx(
                'h-3.5 w-3.5 flex-shrink-0',
                uploading && 'animate-spin',
                !failed && 'text-tertiary',
              )}
            />
            <span className="truncate">{f.fileName}</span>
            {failed ? (
              <span className="flex-shrink-0 text-[12px]">{t('Upload failed')}</span>
            ) : (
              part.archive &&
              entries != null && (
                <span className="flex-shrink-0 text-[12px] text-tertiary">
                  · {entries === 1 ? t('1 file') : t('{n} files', { n: String(entries) })}
                </span>
              )
            )}
          </span>
        )
      })}
    </div>
  )
}

function uploadIcon(uploading: boolean, failed: boolean, archive?: boolean): LucideIcon {
  if (uploading) return Loader2
  if (failed) return CircleAlert

  return archive ? Folder : File
}
