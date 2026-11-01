import { useViewport } from '@xyflow/react'

/** Keeps a header readable at any zoom: it is drawn at screen size, not canvas size. */
export function useScreenScale() {
  const { zoom } = useViewport()

  return 1 / zoom
}
