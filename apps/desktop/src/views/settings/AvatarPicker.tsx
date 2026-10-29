import clsx from 'clsx'
import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/ui/button'

import { AvatarCropDialog } from './AvatarCropDialog'

import type { DragEvent } from 'react'

const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
// The crop dialog downsizes before upload, so this only guards against huge files.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

function validatePhoto(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP image.'
  if (file.size > MAX_SOURCE_BYTES) return 'Choose an image under 25 MB.'

  return null
}

/**
 * An uploaded avatar (a profile photo or a team icon): click or drop an image
 * to crop and upload it, or remove it.
 */
export function AvatarPicker({
  src,
  name,
  kind = 'photo',
  onUpload,
  onRemove,
}: {
  /** The current image, already checked by the caller; empty shows initials. */
  src: string | undefined
  name: string
  /** A profile photo is round; a team icon is a rounded square. */
  kind?: 'photo' | 'icon'
  onUpload: (image: Uint8Array) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const shape = kind === 'icon' ? 'rounded-lg' : 'rounded-full'

  function pickPhoto(file: File | undefined) {
    if (!file) return
    const problem = validatePhoto(file)

    setPhotoError(problem)
    if (!problem) setPhoto(file)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    pickPhoto(event.dataTransfer.files[0])
  }

  async function removePhoto() {
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      await onRemove()
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : `Could not remove ${kind}`)
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={`Change ${kind}`}
          disabled={photoBusy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx(
            'group relative outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500',
            shape,
            dragging && 'ring-2 ring-zViolet-500 ring-offset-2 ring-offset-zGray-900',
          )}
        >
          <Avatar src={src} name={name} size={64} className={clsx(shape, '!shadow-none')} />
          <span
            className={clsx(
              shape,
              'absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/70 text-[10px] backdrop-blur-[2px] font-medium leading-tight text-white transition-opacity',
              dragging
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            {dragging ? `Drop ${kind}` : `Change ${kind}`}
          </span>
        </button>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={photoBusy}
              onClick={() => fileInput.current?.click()}
            >
              {`Upload ${kind}`}
            </Button>
            {src && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={photoBusy}
                onClick={() => void removePhoto()}
              >
                {photoBusy ? 'Removing…' : `Remove ${kind}`}
              </Button>
            )}
          </div>
          <p className="text-[12px] text-tertiary">
            PNG, JPEG or WebP. Drop an image on the {kind}.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          className="hidden"
          onChange={(event) => {
            pickPhoto(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      {photoError && (
        <p role="alert" className="text-sm text-red-400">
          {photoError}
        </p>
      )}
      {photo && (
        <AvatarCropDialog
          kind={kind}
          file={photo}
          onSave={onUpload}
          onClose={() => setPhoto(null)}
        />
      )}
    </>
  )
}
