import { Dialog } from '@base-ui/react/dialog'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, FileSearch, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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

const THUMB_SIZE = { sm: 'h-12 w-12', md: 'h-20 w-20' } as const

// Shared thumbnail for image attachments — used both in the composer (with a
// remove button) and in sent messages. Clicking calls `onOpen`; the caller owns
// the ImageLightbox so one preview can step through the whole group.
export function ImageAttachmentThumb({
  url,
  fileName,
  onRemove,
  onOpen,
  size = 'sm',
  onError,
}: {
  url?: string
  fileName: string
  onRemove?: () => void
  onOpen?: () => void
  /** `lg` shows the whole image at its own proportions, for a lone screenshot worth reading inline. */
  size?: keyof typeof THUMB_SIZE | 'lg'
  onError?: () => void
}) {
  const large = size === 'lg'

  return (
    // Outer wrapper is not clipped so the remove badge can straddle the corner.
    <div
      className={clsx('relative flex-shrink-0', large ? 'max-w-full' : THUMB_SIZE[size])}
      title={fileName}
    >
      <div
        className={clsx(
          'overflow-hidden rounded-lg border border-zGray-800 bg-zGray-900',
          large ? 'min-h-12 min-w-12' : 'h-full w-full',
        )}
      >
        {url ? (
          <button
            type="button"
            onClick={onOpen}
            className="block h-full w-full cursor-zoom-in outline-none"
          >
            <img
              src={url}
              alt={fileName}
              onError={onError}
              className={large ? 'block max-h-72 max-w-full' : 'h-full w-full object-cover'}
            />
          </button>
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
  )
}

export type LightboxImage = {
  url: string
  fileName: string
}

const STEP_KEYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
}
const NAV_BUTTON =
  'absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-zGray-900/80 text-secondary shadow-lg hover:text-main'

// Full-size preview of one group of images; arrow keys step through it (Base
// UI Dialog: backdrop/Esc dismiss and focus trap for free). Open it by setting
// `index`, close by setting null.
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onDownload,
}: {
  images: readonly LightboxImage[]
  index: number | null
  onIndexChange: (index: number | null) => void
  onDownload?: (index: number) => void
}) {
  // Keep the last image on screen while the popup fades out.
  const [shown, setShown] = useState(0)

  if (index !== null && index !== shown) setShown(index)
  const count = images.length
  const i = Math.min(shown, count - 1)
  const image = images.at(i)
  const step = (delta: number) => onIndexChange((i + delta + count) % count)

  return (
    <Dialog.Root
      open={index !== null && image !== undefined}
      onOpenChange={(open) => {
        if (!open) onIndexChange(null)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[2000] bg-black/80 opacity-100 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          aria-label={image?.fileName}
          onKeyDown={(e) => {
            const delta = STEP_KEYS[e.key]

            if (!delta || count < 2) return
            e.preventDefault()
            step(delta)
          }}
          // The popup fills the window so the arrows can sit at its edges;
          // a click on the empty area around the image dismisses like the backdrop.
          onClick={(e) => {
            if (e.target === e.currentTarget) onIndexChange(null)
          }}
          className="titlebar-no-drag fixed inset-0 z-[2001] flex items-center justify-center px-16 pb-12 pt-10 outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        >
          {image && (
            <>
              <img
                src={image.url}
                alt={image.fileName}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className={clsx(NAV_BUTTON, 'left-4')}
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className={clsx(NAV_BUTTON, 'right-4')}
                    aria-label="Next image"
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </>
              )}
              <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3 px-16 text-[12px] text-white/80">
                <span className="min-w-0 truncate">{image.fileName}</span>
                {count > 1 && (
                  <span className="flex-shrink-0 tabular-nums text-white/60">
                    {i + 1} / {count}
                  </span>
                )}
                {onDownload && (
                  <button
                    type="button"
                    onClick={() => onDownload(i)}
                    className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
                  >
                    <Download className="h-3 w-3" strokeWidth={2.2} />
                    Download
                  </button>
                )}
              </div>
            </>
          )}
          <Dialog.Close
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-zGray-900 text-secondary shadow-lg hover:text-main"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
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
