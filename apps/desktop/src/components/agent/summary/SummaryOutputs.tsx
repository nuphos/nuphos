import { File, Image as ImageIcon } from 'lucide-react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { toast } from '../../ui/toast'

import { splitFileName } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'

import type { OutputFile } from './chatSummaryModel'

/** Files the agent handed over; a click saves one, as the card in the transcript does. */
export function OutputsSection({
  files,
  teamId,
  sessionId,
}: {
  files: OutputFile[]
  teamId: string
  sessionId: string
}) {
  async function download(file: OutputFile) {
    const { groupId, fileId, fileName } = file

    try {
      const saved = await api.fileTransferDownloadOne({
        teamId,
        sessionId,
        groupId,
        fileId,
        fileName,
      })

      if (saved.saved) toast.success(t('Saved'), fileName)
    } catch (error) {
      toast.apiError(t('Download failed'), error)
    }
  }

  return (
    <SummarySection title={t('Outputs')}>
      {files.map((file) => {
        const [name, extension] = splitFileName(file.fileName)

        return (
          <SummaryRow
            key={file.fileId}
            icon={file.image ? <ImageIcon className="size-3.5" /> : <File className="size-3.5" />}
            label={name}
            labelEnd={extension}
            title={t('Download {name}', { name: file.fileName })}
            onClick={() => void download(file)}
          />
        )
      })}
    </SummarySection>
  )
}
