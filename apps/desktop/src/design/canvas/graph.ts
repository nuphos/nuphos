import { MarkerType } from '@xyflow/react'

import { boxOf } from './helpers'
import { NODE_TYPE_OF } from './flowTypes'

import type { DesignLink, DesignObject, DesignPage } from '../schema'
import type { Edge, Node } from '@xyflow/react'

// Sections lie under everything; ink and shapes over frames so an annotation
// drawn across a screen stays visible.
const Z_INDEX: Record<DesignObject['type'], number> = {
  section: 0,
  frame: 1,
  note: 2,
  text: 2,
  shape: 3,
  ink: 3,
}

// An untouched object keeps its node, so ReactFlow (and the iframe inside a
// frame node) is not re-rendered for a change elsewhere on the page.
const cache = new WeakMap<DesignObject, { selected: boolean; node: Node }>()

export function toFlowNode(o: DesignObject, selectedIds: ReadonlySet<string>): Node {
  const selected = selectedIds.has(o.id)
  const hit = cache.get(o)

  if (hit && hit.selected === selected) return hit.node
  const node = buildNode(o, selected)

  cache.set(o, { selected, node })

  return node
}

function buildNode(o: DesignObject, selected: boolean): Node {
  const box = boxOf(o)

  return {
    id: o.id,
    type: NODE_TYPE_OF[o.type],
    position: { x: box.x, y: box.y },
    selected,
    zIndex: Z_INDEX[o.type],
    style: {
      width: box.width,
      height: box.height,
      // A section's body lets clicks through to what sits inside it; only its
      // header (pointer-events: auto) selects and moves it.
      ...(o.type === 'section' ? { pointerEvents: 'none' as const } : {}),
    },
    draggable: true,
    data: { object: o },
  }
}

export function buildFlowNodes(page: DesignPage, selectedIds: ReadonlySet<string>): Node[] {
  return page.objects.map((o) => toFlowNode(o, selectedIds))
}

export function buildFlowEdges(
  page: DesignPage,
  onLabelChange: (linkId: string, label: string) => void,
): Edge[] {
  return page.links.map((l) => toFlowEdge(l, onLabelChange))
}

export function toFlowEdge(
  l: DesignLink,
  onLabelChange: (linkId: string, label: string) => void,
): Edge {
  return {
    id: l.id,
    source: l.source,
    target: l.target,
    type: 'designLink',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: 'rgb(var(--color-zViolet-accent))',
    },
    data: { label: l.label ?? '', onLabelChange: (label: string) => onLabelChange(l.id, label) },
  }
}
