// Data model for AI-authored / human-authored system architecture diagrams.
//
// Locked product model (see design discussion):
//   - A Team has many Diagrams. A Diagram owns the canonical node set + their
//     positions (positions are shared across views).
//   - A Diagram has many Views. A View is a lens over the same nodes: it owns
//     the edges and per-node visual overrides (color / hidden) — different
//     views tell different stories (traffic, flow, sequence) on one node set.
//   - A node is one of two kinds: CONCRETE (has a `url` → represents a real
//     resource/page) or ABSTRACT (no url → a logical box, user, external system).
//     A concrete node's identity IS its url; there is no separate resource tag.
//     The url is an OPAQUE pointer — purely structural, never resolved/checked.

export type DiagramNode = {
  id: string
  label: string
  /** Freeform category for the renderer, NOT an enum. Defaults to 'abstract'. */
  kind?: string // 'cloud' | 'code' | 'abstract' | ...
  /** Absolute position (top-left). All nodes are flat — no parent nesting. */
  position: { x: number; y: number }
  /**
   * Present => this node is a GROUP: a labelled rectangle of this explicit size.
   * Membership ("is X in this group") is geometric, not stored. Absent =>
   * regular node (200x72).
   */
  size?: { width: number; height: number }
  /**
   * Present => this is a CONCRETE node bound to a real resource/page; absent =>
   * an ABSTRACT node. Aligns with the app's own page URL schema (e.g.
   * https://nuphos.ai/teams/<id>/infra/aws/.../resources/deployment/<name>) so a
   * double-click navigates straight to that resource inside the app; any other
   * URL opens in the external browser. The url also drives the node's kind/colour.
   */
  url?: string
}

export type DiagramEdge = {
  id: string
  source: string
  target: string
  label?: string
  /** Perpendicular offset of the middle orthogonal segment (drag handle). */
  offset?: number
}

export type NodeStyle = {
  hidden?: boolean
  /** View-local accent color. */
  color?: string
}

export type DiagramView = {
  id: string
  name: string
  /** Edges are per-view — each view draws its own relationships. */
  edges: DiagramEdge[]
  /** Per-node view-local overrides, keyed by node id. */
  nodeStyles?: Record<string, NodeStyle>
}

export type Diagram = {
  id: string
  teamId: string
  name: string
  /** Canonical node set + positions, shared by every view. */
  nodes: DiagramNode[]
  /** Lenses over the node set. Always at least one. */
  views: DiagramView[]
  createdAt: string
  updatedAt: string
}

/** Lightweight shape for the diagram list view. */
export type DiagramSummary = {
  id: string
  name: string
  nodeCount: number
  viewCount: number
  updatedAt: string
}
