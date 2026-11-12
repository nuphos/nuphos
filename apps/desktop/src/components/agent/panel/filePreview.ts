import { api } from '../../../api'
import { openInApp } from '../../../app/workspace/openInApp'
import { t } from '../../../i18n'
import { filePreviewId, putFilePreview } from '../../../lib/filePreviews'
import { artifactPagePath } from '../../../lib/sessionArtifacts'
import { toast } from '../../ui/toast'

type PreviewSource = {
  teamId: string
  groupId: string
  fileId: string
  channelId?: string
}
type ReadResult = Awaited<ReturnType<typeof api.fileTransferReadText>>

// Reads already started, so a click finds the text waiting: a file is read
// once per window, ahead of the click when it is small and scrolled into view,
// or hovered or focused.
const MAX_READS = 24
const reads = new Map<string, Promise<ReadResult>>()

function readFile({ teamId, groupId, fileId, channelId }: PreviewSource): Promise<ReadResult> {
  const key = filePreviewId(groupId, fileId)
  const known = reads.get(key)

  if (known) return known
  const read = api.fileTransferReadText({
    teamId,
    groupId,
    fileId,
    ...(channelId ? { channelId } : {}),
  })

  reads.set(key, read)
  // A failed read is tried again on the next ask rather than remembered.
  read.catch(() => reads.delete(key))
  if (reads.size > MAX_READS) reads.delete(reads.keys().next().value!)

  return read
}

/** Starts reading a file its row expects to be opened, so the preview opens at once. */
export function prefetchFilePreview(source: PreviewSource): void {
  void readFile(source).catch(() => {})
}

/**
 * Read a pushed HTML or Markdown file and open it in the dock's artifact tab.
 * HTML is drawn in the locked file frame (FilePreviewFrame): no script, no
 * network, whoever sent the file. Markdown renders as a document, with no raw
 * HTML. The click
 * that asked for it focused its pane, so the tab opens in that pane's dock.
 */
export async function openFilePreview(args: {
  teamId: string
  groupId: string
  fileId: string
  fileName: string
  channelId?: string
}): Promise<void> {
  const { teamId, groupId, fileId, fileName } = args

  try {
    const read = await readFile(args)

    if ('tooLarge' in read) {
      toast.error(t('Too large to preview'), t('Files over 5 MB can be downloaded instead.'))

      return
    }
    const id = filePreviewId(groupId, fileId)

    putFilePreview(id, fileName, read.text)
    openInApp(artifactPagePath(teamId, id))
  } catch (err) {
    toast.apiError(t('Preview failed'), err)
  }
}
