// Builds the token dependency graph: an edge A→B whenever token A's authored
// value references `var(--B)`. Depth = longest chain to a leaf literal, used to
// lay tokens out in columns (literals left, semantic right).

import type { RegistrySnapshot } from './types'

export type GraphNode = {
  name: string
  depth: number
}

export type GraphEdge = {
  from: string
  to: string
}

export type GraphData = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  maxDepth: number
}

export function buildGraph(registry: RegistrySnapshot, includeIsolated: boolean): GraphData {
  const names = registry.order.filter((n) => n.startsWith('--color'))
  const nameSet = new Set(names)

  const outRefs = new Map<string, string[]>()
  const edges: GraphEdge[] = []

  for (const name of names) {
    const def = registry.tokens.get(name)!
    const targets = def.refs.filter((r) => nameSet.has(r))

    outRefs.set(name, targets)
    for (const t of targets) edges.push({ from: name, to: t })
  }

  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (name: string): number => {
    const cached = memo.get(name)

    if (cached !== undefined) return cached
    if (visiting.has(name)) return 0 // cycle guard (none expected)
    visiting.add(name)
    let d = 0

    for (const t of outRefs.get(name) ?? []) d = Math.max(d, 1 + depthOf(t))
    visiting.delete(name)
    memo.set(name, d)

    return d
  }

  const referenced = new Set<string>()

  for (const e of edges) {
    referenced.add(e.from)
    referenced.add(e.to)
  }

  const nodes: GraphNode[] = []

  for (const name of names) {
    if (!referenced.has(name) && !includeIsolated) continue
    nodes.push({ name, depth: depthOf(name) })
  }

  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0)

  return { nodes, edges, maxDepth }
}
