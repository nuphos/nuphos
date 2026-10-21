export function imageFitScale(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
) {
  if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) return 1

  return Math.min(1, viewWidth / width, viewHeight / height)
}

export function imageZoomScale(scale: number, fit: number) {
  return Math.max(fit, Math.min(8, scale))
}

export function zoomScrollOffset(
  oldSize: number,
  newSize: number,
  viewport: number,
  scroll: number,
  pointer: number,
) {
  if (oldSize <= 0) return 0
  const point = (scroll + pointer - Math.max(0, (viewport - oldSize) / 2)) / oldSize
  const next = point * newSize + Math.max(0, (viewport - newSize) / 2) - pointer

  return Math.max(0, Math.min(Math.max(0, newSize - viewport), next))
}
