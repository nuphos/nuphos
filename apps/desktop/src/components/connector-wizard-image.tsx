import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { t } from '../i18n'
import { cssDurationMs } from '../lib/motion'

// A labeled, bordered screenshot for the right column of a WizardStep. Click to
// enlarge it in an in-app lightbox (screenshots shrink a lot in the narrow
// column, so the annotations stay legible on demand) — no browser round-trip.
export function WizardExampleImage({
  src,
  alt,
  objectPosition = 'left top',
}: {
  src: string
  alt: string
  /** CSS object-position for the cropped thumbnail — point it at the part of the
   *  screenshot that matters (default top-left, where most forms live). */
  objectPosition?: string
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
    const closeMs = cssDurationMs('--modal-close-dur', 150)

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

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-tertiary">{t('Example')}</div>
      <button
        type="button"
        onClick={openLightbox}
        title={t('Click to enlarge')}
        className="relative min-h-[220px] flex-1 cursor-zoom-in overflow-hidden rounded-md border border-zGray-800 transition-colors hover:border-zGray-600"
      >
        {/* Cropped to fill the box, anchored at objectPosition (default
            top-left, where these screenshots keep their subject). */}
        <img
          src={src}
          alt={alt}
          style={{ objectPosition }}
          className="absolute inset-0 h-full w-full object-cover"
        />
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
