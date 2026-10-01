import { ReactFlow, Background, Controls, MarkerType, Position } from '@xyflow/react'
import { useMemo } from 'react'

import type { Edge, Node } from '@xyflow/react'

import '@xyflow/react/dist/style.css'
import { useTheme } from '../../hooks/useTheme'

import { buildGraph } from './graph'

import type { RegistrySnapshot } from './types'

const COL = 300
const ROW = 46

// Dependency mind-map. Mirrors the architecture Canvas's ReactFlow usage:
// `colorMode` from the theme, hidden attribution, uniform pane background.
export function TokenGraph({
  registry,
  includeIsolated,
  onSelect,
}: {
  registry: RegistrySnapshot
  includeIsolated: boolean
  onSelect?: (name: string) => void
}) {
  const { resolved: colorMode } = useTheme()

  const { nodes, edges } = useMemo(() => {
    const g = buildGraph(registry, includeIsolated)

    const byDepth = new Map<number, string[]>()

    for (const n of g.nodes) {
      const arr = byDepth.get(n.depth) ?? []

      arr.push(n.name)
      byDepth.set(n.depth, arr)
    }
    const pos = new Map<string, { x: number; y: number }>()

    for (const [depth, list] of byDepth) {
      list.sort((a, b) => a.localeCompare(b))
      list.forEach((name, i) => pos.set(name, { x: depth * COL, y: i * ROW }))
    }

    const rfNodes: Node[] = g.nodes.map((n) => ({
      id: n.name,
      position: pos.get(n.name)!,
      // Higher-depth (semantic) tokens sit to the right and point left at the
      // literals they reference — so source handles face left, targets right.
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      data: {
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                width: 12,
                height: 12,
                flexShrink: 0,
                borderRadius: 3,
                border: '1px solid rgba(128,128,128,0.4)',
                background: `rgb(var(${n.name}))`,
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n.name.replace('--color-', '')}
            </span>
          </span>
        ),
      },
      style: {
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid rgb(var(--color-zGray-800))',
        background: 'rgb(var(--color-background-elevated))',
        color: 'rgb(var(--color-text-secondary))',
        width: COL - 48,
        textAlign: 'left' as const,
      },
    }))

    const rfEdges: Edge[] = g.edges.map((e) => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      style: { stroke: 'rgb(var(--color-zGray-700))' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: 'rgb(var(--color-zGray-600))',
      },
    }))

    return { nodes: rfNodes, edges: rfEdges }
  }, [registry, includeIsolated])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      colorMode={colorMode}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_e, n) => onSelect?.(n.id)}
      style={{ background: 'rgb(var(--color-background-base))' }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
