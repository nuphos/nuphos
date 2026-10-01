import { ReactFlow, MarkerType } from '@xyflow/react'

import { edgeTypes, nodeTypes } from '../flowTypes'

import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Iso3d = { tx: number; ty: number; k: number }

type Props = {
  rfNodes: Node[]
  rfEdges: Edge[]
  colorMode: 'light' | 'dark'
  iso3d: Iso3d
  setIso3d: Dispatch<SetStateAction<Iso3d>>
  iso3dRef: RefObject<HTMLDivElement | null>
  iso3dApiRef: RefObject<ReactFlowInstance | null>
  isoPanRef: RefObject<{ x: number; y: number; tx: number; ty: number } | null>
  openNodeUrl: (nodeId: string) => void
}

export function Canvas3D({
  rfNodes,
  rfEdges,
  colorMode,
  iso3d,
  setIso3d,
  iso3dRef,
  iso3dApiRef,
  isoPanRef,
  openNodeUrl,
}: Props) {
  return (
    <div
      ref={iso3dRef}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        background: 'rgb(var(--color-background-base))',
        cursor: 'grab',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        isoPanRef.current = { x: e.clientX, y: e.clientY, tx: iso3d.tx, ty: iso3d.ty }
      }}
      onPointerMove={(e) => {
        if (!isoPanRef.current || e.buttons !== 1) return
        const p = isoPanRef.current

        setIso3d((s) => ({
          ...s,
          tx: p.tx + (e.clientX - p.x),
          ty: p.ty + (e.clientY - p.y),
        }))
      }}
      onPointerUp={() => {
        isoPanRef.current = null
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `translate(${String(iso3d.tx)}px, ${String(iso3d.ty)}px) scale(${String(iso3d.k)}) rotateX(45deg) rotateZ(30deg)`,
          transformOrigin: 'center center',
        }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          colorMode={colorMode}
          // Paint the pane the SAME colour as the container. The rotated
          // ReactFlow rectangle can't cover the whole container, so any
          // mismatch (or ReactFlow's own dark pane) shows as a diagonal
          // seam. Matching the container colour + dropping the dotted
          // Background (which only fills the rectangle) makes the backdrop
          // a single uniform colour.
          style={{ background: 'rgb(var(--color-background-base))' }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(_e, n) => openNodeUrl(n.id)}
          panOnScroll={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          onInit={(inst) => {
            iso3dApiRef.current = inst
          }}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  )
}
