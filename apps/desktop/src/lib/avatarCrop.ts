/** Where the image sits inside the square crop viewport, in viewport pixels. */
export type CropState = { zoom: number; x: number; y: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/** Display scale that makes the image's short side fill the viewport at zoom 1. */
function scaleOf(width: number, height: number, viewport: number, zoom: number): number {
  return (viewport / Math.min(width, height)) * zoom
}

function clampOffset(offset: number, displayed: number, viewport: number): number {
  return Math.min(0, Math.max(viewport - displayed, offset))
}

export function centeredCrop(width: number, height: number, viewport: number): CropState {
  const scale = scaleOf(width, height, viewport, MIN_ZOOM)

  return { zoom: MIN_ZOOM, x: (viewport - width * scale) / 2, y: (viewport - height * scale) / 2 }
}

/** Moves or zooms the image, keeping the viewport covered and zoom anchored at its centre. */
export function adjustCrop(
  crop: CropState,
  size: { width: number; height: number },
  viewport: number,
  change: { dx?: number; dy?: number; zoom?: number },
): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, change.zoom ?? crop.zoom))
  const before = scaleOf(size.width, size.height, viewport, crop.zoom)
  const after = scaleOf(size.width, size.height, viewport, zoom)
  const centre = viewport / 2
  const x = centre - ((centre - crop.x) / before) * after + (change.dx ?? 0)
  const y = centre - ((centre - crop.y) / before) * after + (change.dy ?? 0)

  return {
    zoom,
    x: clampOffset(x, size.width * after, viewport),
    y: clampOffset(y, size.height * after, viewport),
  }
}

/** The square of source pixels the viewport shows, for `drawImage`. */
export function cropSourceRect(
  crop: CropState,
  size: { width: number; height: number },
  viewport: number,
): { sx: number; sy: number; side: number } {
  const scale = scaleOf(size.width, size.height, viewport, crop.zoom)

  return {
    sx: Math.max(0, -crop.x / scale),
    sy: Math.max(0, -crop.y / scale),
    side: viewport / scale,
  }
}
