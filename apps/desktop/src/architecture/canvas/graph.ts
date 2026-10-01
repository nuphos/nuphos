import { kindFromUrl, subtitleFromUrl } from './helpers'

import type { Diagram, DiagramView } from '../schema'
import type { Edge, Node } from '@xyflow/react'
import type { Dispatch, SetStateAction } from 'react'

type BuildNodesArgs = {
  nodes: Diagram['nodes']
  view: DiagramView | undefined
  selectedNodeId: string | null
  editing: boolean
  record: () => void
  setDiagram: Dispatch<SetStateAction<Diagram>>
}

export function buildFlowNodes({
  nodes,
  view,
  selectedNodeId,
  editing,
  record,
  setDiagram,
}: BuildNodesArgs): Node[] {
  if (!view) return []
  const visible = nodes.filter((n) => !view.nodeStyles?.[n.id]?.hidden)
  // A node with `size` is a GROUP: a labelled rectangle at its absolute
  // position. Everything is flat/absolute — a node looks "inside" a group
  // simply because its position falls within the group's rect.
  const build = (n: (typeof visible)[number]): Node =>
    n.size
      ? {
          id: n.id,
          type: 'archGroup',
          position: n.position,
          selected: n.id === selectedNodeId,
          // Browse/3D: pointer-events none so clicks pass through the body to the
          // edges/nodes inside (only the header stays grabbable). Edit: the whole
          // body is interactive so the group can be selected, dragged, and resized
          // — inner nodes sit above (zIndex 1) so they're still clickable.
          style: {
            width: n.size.width,
            height: n.size.height,
            pointerEvents: editing ? 'auto' : 'none',
          },
          zIndex: 0,
          data: {
            label: n.label,
            resourceLabel: subtitleFromUrl(n.url),
            editing,
            onResizeEnd: editing
              ? (size: { width: number; height: number }, position: { x: number; y: number }) => {
                  record()
                  setDiagram((dg) => ({
                    ...dg,
                    nodes: dg.nodes.map((nd) => (nd.id === n.id ? { ...nd, size, position } : nd)),
                  }))
                }
              : undefined,
          },
        }
      : {
          id: n.id,
          type: 'arch',
          position: n.position,
          selected: n.id === selectedNodeId,
          zIndex: 1,
          data: {
            label: n.label,
            kind: kindFromUrl(n.url) ?? n.kind,
            resourceLabel: subtitleFromUrl(n.url),
            color: view.nodeStyles?.[n.id]?.color,
            hasUrl: !!n.url,
          },
        }

  // Groups first (and zIndex 0) so they render behind the nodes inside them.
  return [...visible.filter((n) => n.size).map(build), ...visible.filter((n) => !n.size).map(build)]
}

type BuildEdgesArgs = {
  view: DiagramView | undefined
  editing: boolean
  record: () => void
  setDiagram: Dispatch<SetStateAction<Diagram>>
}

export function buildFlowEdges({ view, editing, record, setDiagram }: BuildEdgesArgs): Edge[] {
  return (view?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    data: {
      offset: e.offset,
      // Only editable in 2D edit mode — in Browse / 3D the edge has no drag
      // handle, so it can't mutate `offset` and trigger an autosave.
      onOffsetChange: editing
        ? (offset: number) => {
            record()
            setDiagram((d) => ({
              ...d,
              views: d.views.map((v) =>
                v.id === (view?.id ?? '')
                  ? {
                      ...v,
                      edges: v.edges.map((ed) => (ed.id === e.id ? { ...ed, offset } : ed)),
                    }
                  : v,
              ),
            }))
          }
        : undefined,
    },
  }))
}
