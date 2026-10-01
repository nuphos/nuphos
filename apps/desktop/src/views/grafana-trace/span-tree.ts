import type { TempoSpan } from '../../grafana/client'

export type SpanTreeRow = {
  span: TempoSpan
  depth: number
  hasChildren: boolean
}

export function buildSpanTreeRows(spans: TempoSpan[]): SpanTreeRow[] {
  const byId = new Map(spans.map((span) => [span.spanId, span]))
  const children = new Map<string, TempoSpan[]>()
  const roots: TempoSpan[] = []

  for (const span of spans) {
    const parentId = span.parentSpanId

    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? []

      list.push(span)
      children.set(parentId, list)
    } else {
      roots.push(span)
    }
  }

  const sortByStart = (a: TempoSpan, b: TempoSpan) => a.startTimeUnixNano - b.startTimeUnixNano

  roots.sort(sortByStart)
  for (const list of children.values()) list.sort(sortByStart)

  const rows: SpanTreeRow[] = []
  const visit = (span: TempoSpan, depth: number) => {
    const kids = children.get(span.spanId) ?? []

    rows.push({ span, depth, hasChildren: kids.length > 0 })
    for (const child of kids) visit(child, depth + 1)
  }

  for (const root of roots) visit(root, 0)

  return rows
}
