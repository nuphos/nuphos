import { ARTIFACT_DOCUMENT_TYPE } from '../components/agent/artifacts/artifactTypography'
import { FilePreviewFrame } from '../components/agent/artifacts/FilePreviewFrame'
import { MessageResponse } from '../components/agent/MessageResponse'
import { filePreviewKind, filePreviewTitle } from '../lib/filePreviews'

import type { ArtifactViewMode } from '../components/agent/artifacts/ArtifactToolbar'
import type { useRuntimeFiles } from '../hooks/useRuntimeFiles'
import type { runtimeFilePreview } from '../lib/runtimeFileLink'

type Preview = NonNullable<ReturnType<typeof runtimeFilePreview>>
type Media = NonNullable<ReturnType<typeof useRuntimeFiles>['media']>

/**
 * A workspace file read inline. HTML is drawn in the locked file frame (no
 * script, no network) and Markdown reads as a document, unless the source was
 * asked for; anything else is its text.
 */
export function RuntimeContentPreview({
  preview,
  fileName,
  teamId,
  view,
}: {
  preview: Preview
  fileName: string
  teamId: string
  view: ArtifactViewMode
}) {
  if ('image' in preview) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-state-selected p-6">
        <img
          src={preview.image}
          alt={fileName}
          className="max-h-full max-w-full rounded object-contain"
        />
      </div>
    )
  }
  const kind = view === 'preview' ? filePreviewKind(fileName) : null

  if (kind === 'html') {
    return (
      <div className="flex min-h-0 flex-1">
        <FilePreviewFrame
          html={preview.text}
          title={filePreviewTitle(fileName)}
          className="h-full w-full"
        />
      </div>
    )
  }
  if (kind === 'markdown') {
    return (
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <article className="mx-auto w-full max-w-[72ch] px-4 pb-12 pt-6">
          <MessageResponse className={ARTIFACT_DOCUMENT_TYPE} teamId={teamId}>
            {preview.text}
          </MessageResponse>
        </article>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
      <pre className="min-h-full p-4 font-mono text-[12px] leading-6 text-secondary">
        <code>{preview.text}</code>
      </pre>
    </div>
  )
}

/** Video, audio, a PDF or a large image, played from its transfer URL. */
export function RuntimeMediaPreview({ media, fileName }: { media: Media; fileName: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-state-selected p-6">
      <MediaElement media={media} fileName={fileName} />
    </div>
  )
}

function MediaElement({ media, fileName }: { media: Media; fileName: string }) {
  if (media.kind === 'video')
    return <video src={media.url} controls className="max-h-full max-w-full rounded" />
  if (media.kind === 'audio') return <audio src={media.url} controls className="w-full max-w-md" />
  if (media.kind === 'pdf')
    return <iframe src={media.url} title={fileName} className="h-full w-full rounded bg-white" />

  return (
    <img src={media.url} alt={fileName} className="max-h-full max-w-full rounded object-contain" />
  )
}
