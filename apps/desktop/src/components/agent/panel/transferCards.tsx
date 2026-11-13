import { FolderDown, TimerOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import { filesBesidePreviews, formatTransferBytes, previewKind } from './transferDownloads'
import { FileRow } from './transferFileRow'
import { TransferPreviews } from './transferPreviews'

import type { FileTransferGroup } from '../../../types'

// Rows shown until expanded; a card scrolling inside the transcript would trap the wheel.
const COLLAPSED_ROWS = 5

// Files the agent produced, kept in the transfer store. Images, videos and audio are
// squares the lightbox opens and plays; any other file is a row saved through a native
// dialog (HTML and Markdown also open beside the chat), several at once as a zip.
export function DownloadFilesCard({
  group,
  teamId,
  channelId,
  previews = true,
}: {
  group: FileTransferGroup
  teamId: string
  /** Posted in a chat: every member opens and saves it through the chat. */
  channelId?: string
  /** False when the media are previewed elsewhere (DownloadGroups): rows only. */
  previews?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
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
  const base = { teamId, groupId: group.groupId, ...(channelId ? { channelId } : {}) }
  const hasPreviews = previews && !expired && ready.some((f) => previewKind(f) !== null)
  // Previewed elsewhere, the media are not listed again; an expired group lists all.
  const listed =
    previews || expired ? group.files : group.files.filter((f) => previewKind(f) === null)

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
    const collapsible = files.length > COLLAPSED_ROWS
    const shown = collapsible && !showAll ? files.slice(0, COLLAPSED_ROWS) : files

    return (
      <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-line-control bg-surface">
        {(multiple || expired) && (
          <div className="flex h-10 items-center justify-between gap-2 border-b border-line-control pl-3.5 pr-2 text-[12px] text-tertiary">
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
        {shown.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            expired={expired}
            compact={multiple}
            busy={busy}
            onDownload={() => void downloadOne(f.id, f.fileName)}
            preview={base}
          />
        ))}
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="w-full rounded-none border-t border-line-control text-tertiary"
          >
            {showAll ? t('Show less') : t('Show all {n} files', { n: String(files.length) })}
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

  if (!hasPreviews && listed.length === 0) return null

  return (
    <div className="w-full max-w-[85%] self-start">
      {hasPreviews ? (
        <TransferPreviews
          teamId={teamId}
          groupId={group.groupId}
          channelId={channelId}
          expected={ready.filter((f) => previewKind(f)).length}
          onDownload={(f) => void downloadOne(f.id, f.fileName)}
        >
          {(previewed) => fileRows(filesBesidePreviews(group.files, previewed))}
        </TransferPreviews>
      ) : (
        fileRows(listed)
      )}
    </div>
  )
}
