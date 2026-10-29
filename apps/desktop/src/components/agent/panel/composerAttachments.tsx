import { faFolder, faFile } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'

import { setAttachmentDragData } from './attachmentDrag'
import { isImageAttachmentPath } from './attachments'
import { ImageAttachmentThumb, ImageLightbox } from './messageInline'
import { fileNameFromPath } from './textUtils'

export function AttachmentChips({
  filePaths,
  folderPaths,
  imageThumbs,
  onRemove,
}: {
  filePaths: string[]
  folderPaths: Set<string>
  imageThumbs: Record<string, string>
  onRemove: (filePath: string) => void
}) {
  const [preview, setPreview] = useState<number | null>(null)
  const previewable = filePaths.filter((p) => isImageAttachmentPath(p) && imageThumbs[p])
  const images = filePaths.filter(isImageAttachmentPath)

  return (
    // Attachments sit on their own row above the input so they
    // lay out cleanly instead of crowding the bottom toolbar. Dragging one
    // (the thumbnail's image is draggable on its own) hands its path to
    // whichever chat it is dropped on.
    <div
      className="mb-2 flex flex-wrap items-center gap-2"
      onDragStart={(e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-attachment-path]')

        if (chip?.dataset.attachmentPath)
          setAttachmentDragData(e.dataTransfer, [chip.dataset.attachmentPath])
      }}
    >
      {filePaths.map((filePath) => {
        const isFolder = folderPaths.has(filePath)
        const isImage = isImageAttachmentPath(filePath)
        const removeAttachment = () => onRemove(filePath)

        if (isImage) {
          return (
            <div key={filePath} data-attachment-path={filePath} className="contents">
              <ImageAttachmentThumb
                url={imageThumbs[filePath]}
                fileName={fileNameFromPath(filePath)}
                badge={`#${String(images.indexOf(filePath) + 1)}`}
                onRemove={removeAttachment}
                onOpen={() => setPreview(previewable.indexOf(filePath))}
              />
            </div>
          )
        }
        const name = fileNameFromPath(filePath)
        const typeLabel = (
          isFolder ? t('Folder') : name.includes('.') ? name.split('.').pop()! : t('File')
        ).toUpperCase()

        return (
          <div
            key={filePath}
            data-attachment-path={filePath}
            draggable
            // Canvas-coloured, so the chip still reads against the
            // composer now that the composer itself is the light surface.
            className="surface-raised group relative flex h-12 max-w-[220px] items-center gap-2.5 rounded-lg bg-agentCanvas pl-2 pr-3"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zGray-800">
              <FontAwesomeIcon
                icon={isFolder ? faFolder : faFile}
                className={clsx('h-3.5 w-3.5', isFolder ? 'text-zBlue-accent' : 'text-tertiary')}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-[12.5px] leading-tight text-main"
                title={isFolder ? t('{path} (folder)', { path: filePath }) : filePath}
              >
                {name}
              </span>
              <span className="text-[10px] font-medium uppercase leading-tight text-tertiary">
                {typeLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={removeAttachment}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-main bg-elevated text-secondary shadow-sm hover:text-main"
              title={isFolder ? t('Remove folder') : t('Remove file')}
              aria-label={
                isFolder ? t('Remove folder {name}', { name }) : t('Remove file {name}', { name })
              }
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </div>
        )
      })}
      <ImageLightbox
        images={previewable.map((p) => ({ url: imageThumbs[p], fileName: fileNameFromPath(p) }))}
        index={preview}
        onIndexChange={setPreview}
      />
    </div>
  )
}
