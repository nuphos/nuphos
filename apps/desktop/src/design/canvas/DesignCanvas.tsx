import {
  Background,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useInsertionEffect, useMemo, useRef, useState } from 'react'

import '@xyflow/react/dist/style.css'

import { useTheme } from '../../hooks/useTheme'
import { FRAME_PRESETS } from '../schema'
import { useDesignSync } from '../useDesignSync'

import { DesignCanvasContext } from './context'
import { CanvasChrome } from './CanvasChrome'
import { CanvasOverlays } from './CanvasOverlays'
import { CreateOverlay } from './CreateOverlay'
import { edgeTypes, nodeTypes } from './flowTypes'
import { DEFAULT_INK, downloadHtml, firstFrame } from './helpers'
import { useCanvasGraph } from './useCanvasGraph'
import { useCanvasController } from './useCanvasController'
import { useCanvasPages } from './useCanvasPages'
import { useCanvasTools } from './useCanvasTools'
import { useDesignHistory } from './useDesignHistory'

import type { DesignCanvasActions } from './context'
import { isEditableTarget } from './tools'

import type { Tool } from './tools'
import type { Design, DesignFrame, DesignPage, DesignShapeKind, FramePreset } from '../schema'

type Props = {
  teamId: string
  initial: Design
  onRename?: (name: string) => void
  /** The name shown around the canvas; it is corrected whenever it differs from the design's. */
  shownName?: string | null
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function DesignCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

// eslint-disable-next-line max-lines-per-function -- one canvas, one place that wires its hooks together
function Canvas({ teamId, initial, onRename, shownName, onOpenAgentChat }: Props) {
  const [design, setDesign] = useState<Design>(initial)
  const [pageId, setPageId] = useState(initial.pages[0]?.id ?? '')
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0]
  const { resolved: colorMode } = useTheme()
  const flow = useReactFlow()

  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<DesignShapeKind>('rect')
  const [framePreset, setFramePreset] = useState<FramePreset>('desktop')
  const [inkColor, setInkColor] = useState(DEFAULT_INK)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [interactiveId, setInteractiveId] = useState<string | null>(null)
  const [playFrom, setPlayFrom] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pane: boolean } | null>(null)
  const [askAgentOpen, setAskAgentOpen] = useState(false)
  const [renamingPage, setRenamingPage] = useState<string | null>(null)
  const [deletingPage, setDeletingPage] = useState<string | null>(null)

  const designRef = useRef(design)
  const onRenameRef = useRef(onRename)
  const busyRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useInsertionEffect(() => {
    designRef.current = design
    onRenameRef.current = onRename
  })

  const history = useDesignHistory(designRef, setDesign)
  const saveState = useDesignSync({
    teamId,
    initial,
    design,
    setDesign,
    designRef,
    onRenameRef,
    shownName,
    busyRef,
  })
  const patchPage = useCallback(
    (fn: (p: DesignPage) => DesignPage) =>
      setDesign((d) => ({ ...d, pages: d.pages.map((p) => (p.id === pageId ? fn(p) : p)) })),
    [pageId],
  )
  const graph = useCanvasGraph({ page, patchPage, history, busyRef })
  const pages = useCanvasPages({ design, setDesign, history, pageId, setPageId })

  const { record } = history
  const updateObject = useCallback<DesignCanvasActions['updateObject']>(
    (id, patch, options) => {
      if (options?.record) record()
      patchPage((p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? patch(o) : o)) }))
    },
    [record, patchPage],
  )
  const tools = useCanvasTools({
    page,
    tool,
    shape,
    framePreset,
    inkColor,
    addObjects: graph.addObjects,
    onPlaced: (object) => {
      if (object.type === 'note' || object.type === 'text') setEditingId(object.id)
      setTool('select')
    },
  })

  const { fitAll, fitSelection, leaveModes, paste, duplicate } = useCanvasController({
    designId: design.id,
    page,
    pageId,
    graph,
    history,
    flow,
    containerRef,
    suspended: Boolean(playFrom || askAgentOpen || renamingPage || deletingPage),
    setTool,
    setEditingId,
    setInteractiveId,
  })

  const actions = useMemo<DesignCanvasActions>(
    () => ({
      editingId,
      interactiveId,
      updateObject,
      startEditing: setEditingId,
      setInteractive: setInteractiveId,
      setFramePreset: (id, preset) =>
        updateObject(
          id,
          (o) => ({
            ...o,
            width: FRAME_PRESETS[preset].width,
            height: FRAME_PRESETS[preset].height,
          }),
          { record: true },
        ),
      play: setPlayFrom,
      download: (id) => {
        const frame = designRef.current.pages
          .flatMap((p) => p.objects)
          .find((o): o is DesignFrame => o.id === id && o.type === 'frame')

        if (frame) downloadHtml(frame.title, frame.html)
      },
    }),
    [editingId, interactiveId, updateObject],
  )

  if (!page) return null

  return (
    <DesignCanvasContext.Provider value={actions}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="relative h-full w-full select-none bg-main outline-none"
        // Any press on the canvas brings the keyboard here, so the shortcuts
        // work even when the chat composer had the focus a moment ago.
        onPointerDownCapture={(e) => {
          if (!isEditableTarget(e.target)) containerRef.current?.focus({ preventScroll: true })
        }}
      >
        <CanvasChrome
          design={design}
          page={page}
          setDesign={setDesign}
          onRename={onRename}
          setPageId={setPageId}
          pages={pages}
          setRenamingPage={setRenamingPage}
          setDeletingPage={setDeletingPage}
          tool={tool}
          onTool={(next) => {
            setTool(next)
            leaveModes()
          }}
          shape={shape}
          setShape={setShape}
          framePreset={framePreset}
          setFramePreset={setFramePreset}
          inkColor={inkColor}
          setInkColor={setInkColor}
          history={history}
          saveState={saveState}
          flow={flow}
          fitAll={fitAll}
          fitSelection={fitSelection}
          hasSelection={graph.selectedObjects.length > 0}
          onPlay={() => {
            const start = graph.selectedFrames[0] ?? firstFrame(page)

            if (start) setPlayFrom(start.id)
          }}
        />
        <ReactFlow
          nodes={graph.rfNodes}
          edges={graph.rfEdges}
          colorMode={colorMode}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={graph.onNodesChange}
          onEdgesChange={graph.onEdgesChange}
          onConnect={graph.onConnect}
          onNodeDragStart={graph.onNodeDragStart}
          onNodeDrag={graph.onNodeDrag}
          onNodeDragStop={graph.onNodeDragStop}
          onPaneClick={() => {
            leaveModes()
            setMenu(null)
            graph.selectOnly([])
          }}
          onNodeClick={(_e, node) => {
            if (interactiveId && node.id !== interactiveId) leaveModes()
          }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault()
            if (!graph.selectedIds.has(node.id)) graph.selectOnly([node.id])
            setMenu({ x: e.clientX, y: e.clientY, pane: false })
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, pane: true })
          }}
          nodesDraggable={tool === 'select'}
          nodesConnectable={tool === 'select'}
          elementsSelectable={tool === 'select'}
          selectionOnDrag={tool === 'select'}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode={['Meta', 'Control']}
          zoomOnPinch
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={4}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={editingId || interactiveId ? [] : ['Backspace', 'Delete']}
          defaultEdgeOptions={{ type: 'designLink' }}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgb(var(--color-border))" gap={24} />
        </ReactFlow>
        {tool !== 'select' && tool !== 'hand' && (
          <CreateOverlay
            tool={tool}
            inkColor={inkColor}
            onPlace={tools.onPlace}
            onStroke={tools.onStroke}
            onBusy={(busy) => {
              busyRef.current = busy
            }}
          />
        )}
        <CanvasOverlays
          teamId={teamId}
          design={design}
          page={page}
          selectedFrames={graph.selectedFrames}
          menu={menu}
          onCloseMenu={() => setMenu(null)}
          onPaste={paste}
          onDuplicate={duplicate}
          onDelete={graph.deleteSelection}
          playFrom={playFrom}
          setPlayFrom={setPlayFrom}
          askAgentOpen={askAgentOpen}
          setAskAgentOpen={setAskAgentOpen}
          onOpenAgentChat={onOpenAgentChat}
          renamingPage={renamingPage}
          setRenamingPage={setRenamingPage}
          deletingPage={deletingPage}
          setDeletingPage={setDeletingPage}
          renamePage={pages.renamePage}
          deletePage={pages.deletePage}
        />
      </div>
    </DesignCanvasContext.Provider>
  )
}
