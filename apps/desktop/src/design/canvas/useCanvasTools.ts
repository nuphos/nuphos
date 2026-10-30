import { useCallback } from 'react'

import { FRAME_PRESETS } from '../schema'

import { DEFAULT_NOTE, genId } from './helpers'
import { STARTER_HTML } from './tools'

import type { Placement } from './CreateOverlay'
import type { Tool } from './tools'
import type { DesignLink, DesignObject, DesignPage, DesignShapeKind, FramePreset } from '../schema'

type Args = {
  page: DesignPage | undefined
  tool: Tool
  shape: DesignShapeKind
  framePreset: FramePreset
  inkColor: string
  addObjects: (objects: DesignObject[], links?: DesignLink[]) => void
  onPlaced: (object: DesignObject) => void
}

const DEFAULT_SIZE = {
  section: { width: 1000, height: 700 },
  note: { width: 220, height: 220 },
  text: { width: 280, height: 0 },
  rect: { width: 180, height: 120 },
  line: { width: 200, height: 0 },
}

function sized(placement: Placement, fallback: { width: number; height: number }, min: number) {
  return placement.dragged
    ? { width: Math.max(placement.width, min), height: Math.max(placement.height, min) }
    : fallback
}

/** What a creation tool makes of a click or a drag on the canvas. */
export function useCanvasTools({
  page,
  tool,
  shape,
  framePreset,
  inkColor,
  addObjects,
  onPlaced,
}: Args) {
  const onPlace = useCallback(
    (placement: Placement) => {
      const id = genId()
      const { x, y } = placement
      let object: DesignObject

      if (tool === 'frame') {
        const count = page?.objects.filter((o) => o.type === 'frame').length ?? 0
        const title = `Screen ${String(count + 1)}`

        object = {
          id,
          type: 'frame',
          title,
          x,
          y,
          ...sized(placement, FRAME_PRESETS[framePreset], 120),
          html: STARTER_HTML(title),
        }
      } else if (tool === 'section') {
        object = {
          id,
          type: 'section',
          title: 'Section',
          x,
          y,
          ...sized(placement, DEFAULT_SIZE.section, 120),
        }
      } else if (tool === 'note') {
        object = {
          id,
          type: 'note',
          text: '',
          x,
          y,
          ...sized(placement, DEFAULT_SIZE.note, 80),
          color: DEFAULT_NOTE,
        }
      } else if (tool === 'text') {
        object = {
          id,
          type: 'text',
          text: '',
          x,
          y,
          width: sized(placement, DEFAULT_SIZE.text, 40).width,
          fontSize: 18,
        }
      } else {
        // A line runs from where the drag began to where it ended; a box is just a box.
        const directional = shape === 'line' || shape === 'arrow'
        const { start, end } = placement

        object = directional
          ? {
              id,
              type: 'shape',
              shape,
              x: placement.dragged ? start.x : x,
              y: placement.dragged ? start.y : y,
              width: placement.dragged ? end.x - start.x : DEFAULT_SIZE.line.width,
              height: placement.dragged ? end.y - start.y : DEFAULT_SIZE.line.height,
              color: inkColor,
            }
          : {
              id,
              type: 'shape',
              shape,
              x,
              y,
              ...sized(placement, DEFAULT_SIZE.rect, 8),
              color: inkColor,
            }
      }
      addObjects([object])
      onPlaced(object)
    },
    [tool, framePreset, shape, inkColor, addObjects, page, onPlaced],
  )

  const onStroke = useCallback(
    (points: { x: number; y: number }[]) => {
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)

      addObjects([
        {
          id: genId(),
          type: 'ink',
          x: minX,
          y: minY,
          width: Math.max(...xs) - minX,
          height: Math.max(...ys) - minY,
          points: points.map((p) => [p.x - minX, p.y - minY]),
          color: inkColor,
          strokeWidth: 3,
        },
      ])
    },
    [addObjects, inkColor],
  )

  return { onPlace, onStroke }
}
