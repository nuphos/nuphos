import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// A labeled, bordered screenshot for the right column of a WizardStep. Click to
// enlarge it in an in-app lightbox (screenshots shrink a lot in the narrow
// column, so the annotations stay legible on demand) — no browser round-trip.
export function WizardExampleImage({
  src,
  alt,
  label = 'Example',
  objectPosition = 'left top',
  layout = 'column',
  fit = 'natural',
  aspectRatio,
  className,
}: {
  src: string
  alt: string
  /** `null` drops the caption — for a shot inside a block that is already
   *  captioned as a whole. */
  label?: string | null
  /** CSS object-position for the cropped thumbnail — point it at the part of the
   *  screenshot that matters (default top-left, where most forms live). */
  objectPosition?: string
  /**
   * `column` crops to fill a fixed-width sidebar column beside the instructions.
   * `block` shows the whole screenshot at its own aspect ratio, for a narrow
   * single-column layout (the first-run dock) where cropping would hide the very
   * fields the step is about.
   */
  layout?: 'column' | 'block'
  /**
   * `natural` lets a `block` shot set its own height from its own proportions.
   * `cover` crops it to fill `aspectRatio` instead — for a row of shots, where
   * ragged heights read as a layout bug rather than as three different
   * screenshots. `column` always covers.
   */
  fit?: 'natural' | 'cover'
  /** The box the shot is drawn in. In `natural` fit it only reserves space
   *  before the image loads, so the step doesn't jump under the pointer; in
   *  `cover` it is the crop. CSS syntax, e.g. `'640 / 720'`. */
  aspectRatio?: string
  /** Extra classes for the outer wrapper — grid placement, mostly. */
  className?: string
}) {
  // Two-phase mount so the lightbox can animate on BOTH open and close, driven
  // by the transitions-dev `t-modal` transition (scale-up in, softer scale-down
  // out). 'enter' keeps the closed base style for one frame so 'open' has
  // something to transition from.
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<'enter' | 'open' | 'closing'>('enter')

  function openLightbox() {
    setPhase('enter')
    setMounted(true)
  }
  function closeLightbox() {
    // Read the close duration from the CSS var so JS unmount + CSS stay in sync.
    const closeMs =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur'),
      ) || 150

    setPhase('closing')
    window.setTimeout(() => setMounted(false), closeMs)
  }

  useEffect(() => {
    if (!mounted) return
    const raf = phase === 'enter' ? requestAnimationFrame(() => setPhase('open')) : 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase + stopPropagation so Escape closes ONLY the lightbox and
      // never reaches the parent Modal's own document-level Escape handler.
      e.stopPropagation()
      e.preventDefault()
      closeLightbox()
    }

    window.addEventListener('keydown', onKey, true)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [mounted, phase])

  const block = layout === 'block'
  const cover = !block || fit === 'cover'

  return (
    <div className={clsx('flex flex-col', !block && 'h-full', className)}>
      {label !== null && (
        <div className="mb-1 text-[11px] uppercase tracking-wider text-tertiary">{label}</div>
      )}
      <button
        type="button"
        onClick={openLightbox}
        title="Click to enlarge"
        className={clsx(
          'relative cursor-zoom-in overflow-hidden rounded-md border border-zGray-800 transition-colors hover:border-zGray-600',
          block ? 'w-full' : 'min-h-[220px] flex-1',
        )}
        style={block ? { aspectRatio } : undefined}
      >
        {cover ? (
          /* Cropped to fill the box, anchored at objectPosition (default
             top-left, where these screenshots keep their subject). */
          <img
            src={src}
            alt={alt}
            style={{ objectPosition }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // Whole screenshot, scaled to the column. It stays small here — the
          // lightbox is where it gets read.
          <img src={src} alt={alt} className="block h-auto w-full" />
        )}
      </button>
      {mounted &&
        // Portal to body + z above the Modal backdrop (z-50) so it covers the
        // whole window. Click anywhere or press Escape to dismiss.
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={closeLightbox}
            className={clsx(
              'titlebar-no-drag fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/80 p-10 transition-opacity duration-150 ease-out motion-reduce:transition-none',
              phase === 'open' ? 'opacity-100' : 'opacity-0',
            )}
          >
            <img
              src={src}
              alt={alt}
              className={clsx(
                't-modal max-h-full max-w-full rounded-lg object-contain shadow-2xl',
                phase === 'open' && 'is-open',
                phase === 'closing' && 'is-closing',
              )}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
