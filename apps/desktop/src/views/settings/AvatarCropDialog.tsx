import { Dialog } from '@base-ui/react/dialog'
import { Loader2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/button'
import { adjustCrop, centeredCrop, cropSourceRect, MAX_ZOOM, MIN_ZOOM } from '../../lib/avatarCrop'

import type { CropState } from '../../lib/avatarCrop'
import type { PointerEvent as ReactPointerEvent } from 'react'

const VIEWPORT = 240
const OUTPUT = 512

type Loaded = { url: string; width: number; height: number; image: HTMLImageElement }

/** Square crop for a picked photo; `onSave` receives the cropped 512px WebP. */
export function AvatarCropDialog({
  file,
  onSave,
  onClose,
}: {
  file: File
  onSave: (image: Uint8Array) => Promise<void>
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [crop, setCrop] = useState<CropState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      setLoaded({ url, width: image.naturalWidth, height: image.naturalHeight, image })
      setCrop(centeredCrop(image.naturalWidth, image.naturalHeight, VIEWPORT))
    }
    image.onerror = () => setError('This image could not be read. Try a PNG, JPEG or WebP.')
    image.src = url

    return () => URL.revokeObjectURL(url)
  }, [file])

  function update(change: { dx?: number; dy?: number; zoom?: number }) {
    if (!loaded || !crop) return
    setCrop(adjustCrop(crop, loaded, VIEWPORT, change))
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag.current) return
    update({ dx: event.clientX - drag.current.x, dy: event.clientY - drag.current.y })
    drag.current = { x: event.clientX, y: event.clientY }
  }

  function endDrag() {
    drag.current = null
  }

  async function save() {
    if (!loaded || !crop || saving) return
    setSaving(true)
    setError(null)
    try {
      const canvas = document.createElement('canvas')

      canvas.width = OUTPUT
      canvas.height = OUTPUT
      const { sx, sy, side } = cropSourceRect(crop, loaded, VIEWPORT)

      canvas.getContext('2d')?.drawImage(loaded.image, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.92),
      )

      if (!blob) throw new Error('Could not prepare the photo')
      await onSave(new Uint8Array(await blob.arrayBuffer()))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the photo')
      setSaving(false)
    }
  }

  const scale = loaded && crop ? (VIEWPORT / Math.min(loaded.width, loaded.height)) * crop.zoom : 1

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[340px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <div className="flex items-center justify-between border-b border-zGray-800 px-5 py-4">
            <Dialog.Title className="text-[14px] font-semibold text-main">Crop photo</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              disabled={saving}
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800 hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div
              className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-lg bg-zGray-950 active:cursor-grabbing"
              style={{ width: VIEWPORT, height: VIEWPORT }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { x: event.clientX, y: event.clientY }
              }}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={(event) => crop && update({ zoom: crop.zoom - event.deltaY / 400 })}
            >
              {loaded && crop && (
                <img
                  src={loaded.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                  style={{
                    width: loaded.width * scale,
                    height: loaded.height * scale,
                    transform: `translate(${String(crop.x)}px, ${String(crop.y)}px)`,
                  }}
                />
              )}
              {!loaded && !error && (
                <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-tertiary" />
              )}
              <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
            </div>
            <label className="flex items-center gap-2 text-tertiary">
              <ZoomOut className="h-3.5 w-3.5 shrink-0" />
              <input
                type="range"
                aria-label="Zoom"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={crop?.zoom ?? MIN_ZOOM}
                disabled={!crop || saving}
                onChange={(event) => update({ zoom: Number(event.target.value) })}
                className="w-full accent-zViolet-500"
              />
              <ZoomIn className="h-3.5 w-3.5 shrink-0" />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={!crop || saving}
              >
                {saving ? 'Saving…' : 'Save photo'}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
