import { segmentParts } from './toolRuns'
import { ToolRunView } from './ToolRunView'

import type { Part, ToolPart } from './parts'
import type { ToolRunItem } from './ToolRunView'
import type { ReactNode } from 'react'

export type RenderPartOptions = {
  /** A tool call that is the only one in its run opens straight to its details. */
  initiallyOpen?: boolean
}
type RenderPart = (part: Part, index: number, options?: RenderPartOptions) => ReactNode

function renderToolRun(
  parts: Part[],
  indices: number[],
  renderPart: RenderPart,
  now: number,
): ReactNode {
  const toolParts = indices
    .map((index) => parts[index])
    .filter((part): part is ToolPart => part.type === 'tool')
  const first = toolParts[0]

  // Finished historical calls start closed even when they are the only call
  // in a run. Auto-opening them eagerly builds and formats their full output;
  // one log-heavy call can be over a megabyte. Live calls still open so their
  // progress remains visible.
  const single =
    toolParts.length === 1 && first.state !== 'output-available' && first.state !== 'output-error'
  const items: ToolRunItem[] = indices.map((index) => ({
    index,
    node: renderPart(parts[index], index, { initiallyOpen: single }),
  }))

  return (
    <ToolRunView key={`toolrun:${first.toolCallId}`} parts={toolParts} now={now} items={items} />
  )
}

export function renderPartRange(
  parts: Part[],
  from: number,
  to: number,
  renderPart: RenderPart,
  now: number,
): ReactNode[] {
  return segmentParts(parts, from, to).map((segment) =>
    segment.kind === 'part'
      ? renderPart(parts[segment.index], segment.index)
      : renderToolRun(parts, segment.indices, renderPart, now),
  )
}
