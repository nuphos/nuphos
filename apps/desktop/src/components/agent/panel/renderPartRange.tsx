import { isValidElement } from 'react'

import { t } from '../../../i18n'

import { CollapsedWorkView } from './partChrome'
import { getToolLabel } from './toolPartUtils'
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

/** Filter before grouping so excluded calls cannot leave empty tool run headers. */
export function renderSelectedParts(
  parts: Part[],
  indices: number[],
  renderPart: RenderPart,
  now: number,
): ReactNode[] {
  return renderPartRange(
    indices.map((index) => parts[index]),
    0,
    indices.length,
    (part, index, options) => renderPart(part, indices[index], options),
    now,
  )
}

const supersededApprovalMessage =
  'Not run: a new message cancelled the pending approval. Ask again if you still want it.'

/** Keep the cancelled approval's outcome directly after the activity that contains it. */
export function withApprovalNotice(body: ReactNode[], parts: readonly Part[]): ReactNode[] {
  const part = parts.find(
    (candidate): candidate is ToolPart =>
      candidate.type === 'tool' && candidate.errorText === supersededApprovalMessage,
  )

  if (!part) return body
  const action = getToolLabel(part).trim()
  const after =
    body.findIndex((node) => {
      if (!isValidElement<{ parts?: ToolPart[]; toolCallIds?: string[] }>(node)) return false
      if (node.type === ToolRunView)
        return node.props.parts?.some((tool) => tool.toolCallId === part.toolCallId) === true

      return (
        node.type === CollapsedWorkView &&
        node.props.toolCallIds?.includes(part.toolCallId) === true
      )
    }) + 1
  const notice = (
    <p key="superseded-approval" role="status" className="text-[12.5px] leading-5 text-secondary">
      {action
        ? t(
            'Not run: a new message cancelled the approval for "{action}". Ask again if you still want it.',
            { action },
          )
        : t(
            'Not run: a new message cancelled the pending approval. Ask again if you still want it.',
          )}
    </p>
  )

  return [...body.slice(0, after), notice, ...body.slice(after)]
}
