import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { useCallback, useInsertionEffect, useMemo, useRef, useState } from 'react'

import { insideSection } from '../schema'

import { buildFlowEdges, buildFlowNodes } from './graph'
import { boxOf, genId } from './helpers'

import type { DesignFrame, DesignLink, DesignObject, DesignPage, DesignSection } from '../schema'
import type { useDesignHistory } from './useDesignHistory'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { RefObject } from 'react'

type Args = {
  page: DesignPage | undefined
  patchPage: (fn: (p: DesignPage) => DesignPage) => void
  history: ReturnType<typeof useDesignHistory>
  busyRef: RefObject<boolean>
}

/**
 * ReactFlow owns the live node/edge state so dragging is smooth. The design is
 * the source of truth: nodes are rebuilt from the page whenever it changes for
 * a non-drag reason, and a drag commits its positions back when it stops.
 */
export function useCanvasGraph({ page, patchPage, history, busyRef }: Args) {
  // The history object is rebuilt every render; its functions are stable.
  const { record, begin, commit } = history
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const [dragging, setDragging] = useState(false)
  const rfNodesRef = useRef<Node[]>([])

  useInsertionEffect(() => {
    rfNodesRef.current = rfNodes
  })

  // ReactFlow owns selection. Derived through a string key so the set (and the
  // node rebuild that depends on it) only changes when the selection does.
  const selectedKey = rfNodes
    .filter((n) => n.selected)
    .map((n) => n.id)
    .sort((a, b) => a.localeCompare(b))
    .join(',')
  const selectedIds = useMemo<ReadonlySet<string>>(
    () => new Set(selectedKey ? selectedKey.split(',') : []),
    [selectedKey],
  )

  const onLabelChange = useCallback(
    (linkId: string, label: string) => {
      record()
      patchPage((p) => ({
        ...p,
        links: p.links.map((l) => (l.id === linkId ? { ...l, label } : l)),
      }))
    },
    [record, patchPage],
  )

  // Rebuilt during render (not in an effect) so ReactFlow never commits a frame
  // built from the previous page. Left stale while a drag is live: the drag
  // owns the positions until it stops and commits them into the design.
  const buildNodes = useCallback(
    () => (page ? buildFlowNodes(page, selectedIds) : []),
    [page, selectedIds],
  )
  const buildEdges = useCallback(
    () => (page ? buildFlowEdges(page, onLabelChange) : []),
    [page, onLabelChange],
  )
  const [nodeSource, setNodeSource] = useState<(() => Node[]) | null>(null)
  const [edgeSource, setEdgeSource] = useState<(() => Edge[]) | null>(null)

  if (nodeSource !== buildNodes && !dragging) {
    setNodeSource(() => buildNodes)
    setRfNodes(buildNodes())
  }
  if (edgeSource !== buildEdges) {
    setEdgeSource(() => buildEdges)
    setRfEdges(buildEdges())
  }

  const selectedObjects = useMemo(
    () => (page ? page.objects.filter((o) => selectedIds.has(o.id)) : []),
    [page, selectedIds],
  )
  const selectedFrames = useMemo(
    () => selectedObjects.filter((o): o is DesignFrame => o.type === 'frame'),
    [selectedObjects],
  )

  const selectOnly = useCallback((ids: string[]) => {
    const set = new Set(ids)

    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: set.has(n.id) })))
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((ns) => applyNodeChanges(changes, ns))
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)

      if (removed.length === 0) return
      record()
      patchPage((p) => ({
        ...p,
        objects: p.objects.filter((o) => !removed.includes(o.id)),
        links: p.links.filter((l) => !removed.includes(l.source) && !removed.includes(l.target)),
      }))
    },
    [record, patchPage],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((es) => applyEdgeChanges(changes, es))
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)

      if (removed.length === 0) return
      record()
      patchPage((p) => ({ ...p, links: p.links.filter((l) => !removed.includes(l.id)) }))
    },
    [record, patchPage],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source === conn.target) return
      record()
      patchPage((p) => {
        const frames = new Set(p.objects.filter((o) => o.type === 'frame').map((o) => o.id))

        if (!frames.has(conn.source) || !frames.has(conn.target)) return p
        const link: DesignLink = { id: genId(), source: conn.source, target: conn.target }

        return { ...p, links: [...p.links, link] }
      })
    },
    [record, patchPage],
  )

  const addObjects = useCallback(
    (objects: DesignObject[], links: DesignLink[] = []) => {
      record()
      patchPage((p) => ({
        ...p,
        objects: [...p.objects, ...objects],
        links: [...p.links, ...links],
      }))
      // Select the new objects once they exist as nodes.
      requestAnimationFrame(() => selectOnly(objects.map((o) => o.id)))
    },
    [record, patchPage, selectOnly],
  )

  const deleteSelection = useCallback(() => {
    const ids = [...selectedIds]

    if (ids.length) onNodesChange(ids.map((id) => ({ type: 'remove', id })))
  }, [selectedIds, onNodesChange])

  // --- drag: a section carries what sits inside it ---------------------------
  const sectionDrag = useRef<{
    origin: { x: number; y: number }
    members: Map<string, { x: number; y: number }>
  } | null>(null)

  const onNodeDragStart = useCallback(
    (_e: unknown, node: Node) => {
      busyRef.current = true
      setDragging(true)
      begin()
      const section = page?.objects.find((o) => o.id === node.id)

      sectionDrag.current = null
      if (!page || section?.type !== 'section') return
      const members = new Map<string, { x: number; y: number }>()

      for (const o of page.objects) {
        if (!selectedIds.has(o.id) && insideSection(o, section as DesignSection)) {
          const b = boxOf(o)

          members.set(o.id, { x: b.x, y: b.y })
        }
      }
      sectionDrag.current = { origin: { ...node.position }, members }
    },
    [begin, page, selectedIds, busyRef],
  )

  const onNodeDrag = useCallback((_e: unknown, node: Node) => {
    const drag = sectionDrag.current

    if (!drag || drag.members.size === 0) return
    const dx = node.position.x - drag.origin.x
    const dy = node.position.y - drag.origin.y

    setRfNodes((ns) =>
      ns.map((n) => {
        const origin = drag.members.get(n.id)

        return origin ? { ...n, position: { x: origin.x + dx, y: origin.y + dy } } : n
      }),
    )
  }, [])

  const onNodeDragStop = useCallback(() => {
    busyRef.current = false
    setDragging(false)
    sectionDrag.current = null
    const posById = new Map(rfNodesRef.current.map((n) => [n.id, n.position]))

    patchPage((p) => ({
      ...p,
      objects: p.objects.map((o) => {
        const pos = posById.get(o.id)

        if (!pos) return o
        // A shape's node sits at its box corner; a flipped line keeps its own origin.
        if (o.type === 'shape') {
          return {
            ...o,
            x: o.width < 0 ? pos.x - o.width : pos.x,
            y: o.height < 0 ? pos.y - o.height : pos.y,
          }
        }

        return { ...o, x: pos.x, y: pos.y }
      }),
    }))
    commit()
  }, [commit, patchPage, busyRef])

  return {
    rfNodes,
    rfEdges,
    selectedIds,
    selectedObjects,
    selectedFrames,
    selectOnly,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addObjects,
    deleteSelection,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
  }
}
