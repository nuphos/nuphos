import { useEffect, useState } from 'react'

import { api } from '../api'
import { Button } from '../components/ui/button'
import { AppSelect } from '../components/ui/select'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'
import { loadXlsx, XLSX_MAX_BYTES } from '../lib/xlsxPreview'

import { SpreadsheetTable } from './SpreadsheetTable'

import type { SpreadsheetSource } from '../lib/filePreviews'
import type { XlsxSheet } from '../lib/xlsxXml'

export function SpreadsheetView({ source, name }: { source: SpreadsheetSource; name: string }) {
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const { teamId, groupId, fileId, channelId, size } = source

  useEffect(() => {
    const controller = new AbortController()

    async function read() {
      try {
        if (size !== null && size > XLSX_MAX_BYTES) throw new Error('XLSX size limit')
        const bytes = await api.fileTransferReadOne({
          teamId,
          groupId,
          fileId,
          ...(channelId ? { channelId } : {}),
          maxBytes: XLSX_MAX_BYTES,
        })

        if (controller.signal.aborted) return
        if (!bytes) throw new Error('XLSX unavailable')
        const workbook = await loadXlsx(bytes, controller.signal)

        if (!controller.signal.aborted) setSheets(workbook)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    }
    void read()

    return () => controller.abort()
  }, [teamId, groupId, fileId, channelId, size])

  const download = async () => {
    setSaving(true)
    try {
      await api.fileTransferDownloadOne({
        teamId,
        groupId,
        fileId,
        fileName: name,
        ...(channelId ? { channelId } : {}),
      })
    } catch (error) {
      toast.apiError(t('Download failed'), error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-control p-3">
        <span className="min-w-0 flex-1 truncate text-sm text-main" title={name}>
          {name}
        </span>
        <Button variant="secondary" size="sm" disabled={saving} onClick={() => void download()}>
          {t('Download')}
        </Button>
        {sheets && (
          <AppSelect
            ariaLabel={t('Worksheet')}
            size="sm"
            className="max-w-full"
            value={String(selected)}
            onValueChange={(value) => setSelected(Number(value))}
            options={sheets.map((sheet, i) => ({ value: String(i), label: sheet.name }))}
          />
        )}
      </div>
      {failed ? (
        <div role="status" className="p-4 text-sm text-secondary">
          {t('Preview unavailable')} · {t('Download file')}
        </div>
      ) : sheets ? (
        <SpreadsheetTable key={selected} sheet={sheets[selected]} />
      ) : (
        <div role="status" className="p-4 text-sm text-tertiary">
          {t('Loading…')}
        </div>
      )}
    </div>
  )
}
