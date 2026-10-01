import { ReactFlow, Background, Controls, ConnectionMode, MarkerType } from '@xyflow/react'
import { useCallback, useInsertionEffect, useRef, useState } from 'react'

import '@xyflow/react/dist/style.css'

import { useTheme } from '../hooks/useTheme'

import { Canvas3D } from './canvas/Canvas3D'
import { buildFlowEdges, buildFlowNodes } from './canvas/graph'
import { snap } from './canvas/helpers'
import { Inspector } from './canvas/Inspector'
import { Toolbar, ViewTabs } from './canvas/Toolbar'
import { useDiagramSync } from './canvas/useDiagramSync'
import { useHistory } from './canvas/useHistory'
import { useIso3d } from './canvas/useIso3d'
import { useMutations } from './canvas/useMutations'
import { edgeTypes, nodeTypes } from './flowTypes'

import type { Snapshot } from './canvas/helpers'
import type { Diagram, DiagramView } from './schema'
import type { Edge, Node } from '@xyflow/react'

type Props = {
  teamId: string
  initial: Diagram
  // Notify the parent when the diagram is renamed, so the global breadcrumb
  // (which owns back-navigation) keeps its label in sync. Navigation itself is
  // handled by the breadcrumb — this view has no back button.
  onRename?: (name: string) => void
  // Open a node's `url`. The handler owns the policy: nuphos.ai pages open
  // in-app, everything else opens in the external browser.
  onOpenUrl?: (url: string) => void
}

export function DiagramCanvas({ teamId, initial, onRename, onOpenUrl }: Props) {
  const [diagram, setDiagram] = useState<Diagram>(initial)
  const [viewId, setViewId] = useState<string>(initial.views[0]?.id ?? '')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const { resolved: colorMode } = useTheme()
  const [threeD, setThreeD] = useState(true)
  // Browse vs edit. Editing (drag/select/inspector) is only available in 2D; in
  // browse mode (and always in 3D) a single click on a node jumps to its url.
  const [mode, setMode] = useState<'browse' | 'edit'>('browse')
  const { iso3d, setIso3d, iso3dRef, iso3dApi, isoPan } = useIso3d(threeD)

  const diagramRef = useRef(diagram)
  // Parents pass `onRename` as a fresh inline closure each render. Keep it in a
  // ref so the effects below can call the latest one WITHOUT listing it as a
  // dependency — otherwise the rename effect re-fires on every render, and since
  // it triggers a parent state update that re-renders us, that's an infinite
  // loop (React error #185) the moment the diagram opens.
  const onRenameRef = useRef(onRename)

  // Commit-phase assignment — writing a ref during render is unsafe under
  // concurrent rendering, and the effects below only read it after commit.
  useInsertionEffect(() => {
    diagramRef.current = diagram
    onRenameRef.current = onRename
  })
  const dragSnap = useRef<Snapshot | null>(null)
  // True while a node is being dragged — suppresses rebuilding ReactFlow's node
  // state from `diagram` so the live drag (owned by ReactFlow) isn't clobbered.
  // State rather than a ref because the rebuild below reads it during render.
  const [dragging, setDragging] = useState(false)

  const { past, future, setPast, setFuture, record, undo, redo } = useHistory(
    diagramRef,
    setDiagram,
  )
  const saveState = useDiagramSync({
    teamId,
    initial,
    diagram,
    setDiagram,
    diagramRef,
    onRenameRef,
    dragSnap,
  })

  const editing = !threeD && mode === 'edit'
  const view: DiagramView | undefined =
    diagram.views.find((v) => v.id === viewId) ?? diagram.views[0]
  const selectedNode = editing ? (diagram.nodes.find((n) => n.id === selectedNodeId) ?? null) : null

  // Open a node's `url`. onOpenUrl owns the routing policy (nuphos.ai → in-app,
  // else → external browser); a nuphos.ai link must NEVER bounce through the
  // browser, so this no longer falls back to appOpenExternal itself.
  const openNodeUrl = useCallback(
    (nodeId: string) => {
      const url = diagramRef.current.nodes.find((n) => n.id === nodeId)?.url?.trim()

      if (url) onOpenUrl?.(url)
    },
    [onOpenUrl],
  )

  // --- ReactFlow graph for the current view --------------------------------
  const buildNodes = useCallback(
    (): Node[] =>
      buildFlowNodes({ nodes: diagram.nodes, view, selectedNodeId, editing, record, setDiagram }),
    [diagram.nodes, view, selectedNodeId, editing, record],
  )

  const buildEdges = useCallback(
    (): Edge[] => buildFlowEdges({ view, editing, record, setDiagram }),
    [view, record, editing],
  )

  // ReactFlow owns the live node/edge state so dragging is smooth and not
  // re-derived every frame (that caused flicker). Rebuild from `diagram` only
  // when it changes for non-drag reasons (add/remove, view switch, undo, agent).
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const rfNodesRef = useRef<Node[]>([])

  useInsertionEffect(() => {
    rfNodesRef.current = rfNodes
  })

  // Rebuilt during render rather than from an effect, so ReactFlow never
  // commits a frame still built from the previous diagram. While a drag is
  // live the node source is deliberately left stale — the rebuild happens once
  // the drag stops and commits its positions back into `diagram`.
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

  const {
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    addView,
    inspectorDirty,
    updateNode,
    setNodeColor,
    deleteNode,
  } = useMutations({
    record,
    setDiagram,
    viewId: view?.id,
    selectedNodeId,
    setSelectedNodeId,
    setViewId,
    setRfNodes,
    setRfEdges,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar
        diagram={diagram}
        editing={editing}
        threeD={threeD}
        mode={mode}
        saveState={saveState}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onNameChange={(name) => {
          setDiagram((d) => ({ ...d, name }))
          onRename?.(name)
        }}
        onUndo={undo}
        onRedo={redo}
        onAddNode={addNode}
        onSetMode={(m) => {
          setMode(m)
          if (m === 'browse') setSelectedNodeId(null)
        }}
        onSetThreeD={setThreeD}
      />

      <ViewTabs
        views={diagram.views}
        activeViewId={view?.id}
        editing={editing}
        onSelectView={setViewId}
        onAddView={addView}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {threeD ? (
          // 3D = the exact same 2D scene, tilted into an isometric angle. Same
          // node/edge/group components, just read-only and CSS-rotated.
          <Canvas3D
            rfNodes={rfNodes}
            rfEdges={rfEdges}
            colorMode={colorMode}
            iso3d={iso3d}
            setIso3d={setIso3d}
            iso3dRef={iso3dRef}
            iso3dApiRef={iso3dApi}
            isoPanRef={isoPan}
            openNodeUrl={openNodeUrl}
          />
        ) : (
          <>
            <div style={{ flex: 1, minWidth: 0, background: 'rgb(var(--color-background-base))' }}>
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                colorMode={colorMode}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStart={() => {
                  setDragging(true)
                  dragSnap.current = snap(diagramRef.current)
                }}
                onNodeDragStop={() => {
                  setDragging(false)
                  // Commit the final positions from ReactFlow's state into `diagram`.
                  const posById = new Map(rfNodesRef.current.map((n) => [n.id, n.position]))

                  if (dragSnap.current) {
                    const s = dragSnap.current

                    setPast((p) => [...p, s].slice(-50))
                    setFuture([])
                    dragSnap.current = null
                  }
                  setDiagram((d) => ({
                    ...d,
                    nodes: d.nodes.map((n) => {
                      const p = posById.get(n.id)

                      return p ? { ...n, position: { x: p.x, y: p.y } } : n
                    }),
                  }))
                }}
                nodesDraggable={editing}
                nodesConnectable={editing}
                elementsSelectable={editing}
                onNodeClick={(_e, n) => (editing ? setSelectedNodeId(n.id) : openNodeUrl(n.id))}
                onNodeDoubleClick={(_e, n) => openNodeUrl(n.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                defaultEdgeOptions={{
                  type: 'floating',
                  style: { stroke: 'rgb(var(--color-zGray-500))' },
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    width: 14,
                    height: 14,
                    color: 'rgb(var(--color-zGray-500))',
                  },
                }}
                connectionMode={ConnectionMode.Loose}
                snapToGrid
                snapGrid={[16, 16]}
                panOnScroll
                zoomOnScroll={false}
                zoomOnPinch
                deleteKeyCode={editing ? ['Backspace', 'Delete'] : []}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="rgb(var(--color-border))" gap={18} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            {selectedNode ? (
              <Inspector
                node={selectedNode}
                view={view}
                inspectorDirtyRef={inspectorDirty}
                updateNode={updateNode}
                setNodeColor={setNodeColor}
                deleteNode={deleteNode}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
