import { Dialog } from '@base-ui/react/dialog'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { FileSearch, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { renderMentionChip } from '../../../lib/atlasLinkMention'

import { fileNameFromPath } from './textUtils'

export function AtlasMentionInline({
  url,
  onOpen,
}: {
  url: string
  onOpen?: (href: string) => boolean
}) {
  const hostRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return
    const chip = renderMentionChip(url)

    if (onOpen) {
      chip.style.cursor = 'pointer'
      chip.setAttribute('role', 'link')
      chip.tabIndex = 0
      const open = () => onOpen(url)

      chip.addEventListener('click', open)
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open()
      })
    }
    host.appendChild(chip)

    return () => {
      if (chip.parentNode === host) host.removeChild(chip)
    }
  }, [url, onOpen])

  return <span ref={hostRef} />
}

// Shared square thumbnail for image attachments — used both in the
// composer (with a remove button) and in sent messages. Click opens a full-size
// preview (Base UI Dialog: backdrop/Esc dismiss for free).
export function ImageAttachmentThumb({
  url,
  fileName,
  onRemove,
  large,
  onError,
}: {
  url?: string
  fileName: string
  onRemove?: () => void
  /** Whole image at its own proportions, for screenshots worth reading inline. */
  large?: boolean
  onError?: () => void
}) {
  return (
    <Dialog.Root>
      {/* Outer wrapper is not clipped so the remove badge can straddle the corner. */}
      <div
        className={clsx('relative flex-shrink-0', large ? 'max-w-full' : 'h-12 w-12')}
        title={fileName}
      >
        <div
          className={clsx(
            'overflow-hidden rounded-lg border border-zGray-800 bg-zGray-900',
            large ? 'min-h-12 min-w-12' : 'h-full w-full',
          )}
        >
          {url ? (
            <Dialog.Trigger className="block h-full w-full cursor-zoom-in outline-none">
              <img
                src={url}
                alt={fileName}
                onError={onError}
                className={large ? 'block max-h-72 max-w-full' : 'h-full w-full object-cover'}
              />
            </Dialog.Trigger>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-tertiary">
              <FontAwesomeIcon icon={faImage} className="h-4 w-4" />
            </div>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-main bg-elevated text-secondary shadow-sm hover:text-main"
            title="Remove image"
            aria-label={`Remove image ${fileName}`}
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
      {url && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[2000] bg-black/80 opacity-100 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-[2001] max-h-[90vh] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <img
              src={url}
              alt={fileName}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
            <Dialog.Close
              className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-zGray-900 text-secondary shadow-lg hover:text-main"
              aria-label="Close preview"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}

export function LocalFileChip({ path }: { path: string }) {
  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-zGray-800 bg-zGray-900/70 px-2 py-1 text-[12.5px] text-secondary"
      title={path}
    >
      <FileSearch className="w-3 h-3 flex-shrink-0 text-tertiary" strokeWidth={2} />
      <span className="truncate">{fileNameFromPath(path)}</span>
    </div>
  )
}
