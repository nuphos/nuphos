import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { useCallback, useRef } from 'react'

import { genId, scatter } from './helpers'

import type { Diagram, DiagramView } from '../schema'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { Dispatch, SetStateAction } from 'react'

type Args = {
  record: () => void
  setDiagram: Dispatch<SetStateAction<Diagram>>
  viewId: string | undefined
  selectedNodeId: string | null
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setViewId: Dispatch<SetStateAction<string>>
  setRfNodes: Dispatch<SetStateAction<Node[]>>
  setRfEdges: Dispatch<SetStateAction<Edge[]>>
}

export function useMutations({
  record,
  setDiagram,
  viewId,
  selectedNodeId,
  setSelectedNodeId,
  setViewId,
  setRfNodes,
  setRfEdges,
}: Args) {
  const patchView = useCallback(
    (fn: (v: DiagramView) => DiagramView) => {
      setDiagram((d) => ({
        ...d,
        views: d.views.map((v) => (v.id === (viewId ?? '') ? fn(v) : v)),
      }))
    },
    [viewId, setDiagram],
  )

  // Live changes (drag, select, measure) go to ReactFlow's own state — keeps
  // dragging smooth. Position is committed back to `diagram` on drag stop.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((ns) => applyNodeChanges(changes, ns))
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)

      if (!removed.length) return
      record()
      setDiagram((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => !removed.includes(n.id)),
        views: d.views.map((v) => ({
          ...v,
          edges: v.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)),
        })),
      }))
      if (selectedNodeId && removed.includes(selectedNodeId)) setSelectedNodeId(null)
    },
    [record, selectedNodeId, setDiagram, setRfNodes, setSelectedNodeId],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((es) => applyEdgeChanges(changes, es))
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)

      if (!removed.length) return
      record()
      patchView((v) => ({ ...v, edges: v.edges.filter((e) => !removed.includes(e.id)) }))
    },
    [record, patchView, setRfEdges],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      record()
      patchView((v) => ({
        ...v,
        edges: [...v.edges, { id: genId(), source: conn.source!, target: conn.target! }],
      }))
    },
    [record, patchView],
  )

  const addNode = useCallback(() => {
    record()
    const id = genId()

    setDiagram((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id,
          label: 'New node',
          kind: 'abstract',
          position: { x: 80 + scatter(160), y: 80 + scatter(120) },
        },
      ],
    }))
    setSelectedNodeId(id)
  }, [record, setDiagram, setSelectedNodeId])

  const addView = useCallback(() => {
    record()
    const id = genId()

    setDiagram((d) => ({
      ...d,
      views: [...d.views, { id, name: `View ${String(d.views.length + 1)}`, edges: [] }],
    }))
    setViewId(id)
  }, [record, setDiagram, setViewId])

  // One undo entry per inspector edit "interaction": reset on field focus (see
  // the inputs' onFocus), then the first mutation of that session records a
  // snapshot. Avoids a history entry per keystroke while keeping edits undoable.
  const inspectorDirty = useRef(false)
  const updateNode = useCallback(
    (id: string, fn: (n: Diagram['nodes'][number]) => Diagram['nodes'][number]) => {
      if (!inspectorDirty.current) {
        record()
        inspectorDirty.current = true
      }
      setDiagram((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? fn(n) : n)) }))
    },
    [record, setDiagram],
  )

  const setNodeColor = useCallback(
    (id: string, color: string) => {
      record()
      patchView((v) => {
        const styles = { ...(v.nodeStyles ?? {}) }

        styles[id] = { ...styles[id], color: color || undefined }

        return { ...v, nodeStyles: styles }
      })
    },
    [patchView, record],
  )

  const deleteNode = useCallback(
    (id: string) => {
      record()
      setDiagram((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => n.id !== id),
        views: d.views.map((v) => ({
          ...v,
          edges: v.edges.filter((e) => e.source !== id && e.target !== id),
        })),
      }))
      setSelectedNodeId(null)
    },
    [record, setDiagram, setSelectedNodeId],
  )

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    addView,
    inspectorDirty,
    updateNode,
    setNodeColor,
    deleteNode,
  }
}
