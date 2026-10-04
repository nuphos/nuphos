import clsx from 'clsx'
import { ChevronRight, ShieldCheck, Terminal } from 'lucide-react'
import { useState } from 'react'

import { useReportVisibleError } from '../../VisibleErrorReporter'

import { AuthorizationApprovalActions, ProposedRuleActions } from './AuthorizationActions'
import { CodeSection, CommandTerminalView } from './CommandTerminalView'
import { disclosureControlClass, LoadingText, ToolElapsedBadge } from './partChrome'
import { describeAutoAuthorization } from './parts'
import { proposedRuleFrom } from './proposedRule'
import { getToolLabel, isCommandTool } from './toolPartUtils'

import type { ToolPart } from './parts'

export function ToolPartView({
  part,
  now,
  initiallyOpen = false,
}: {
  part: ToolPart
  now: number
  /** Start with the details shown — a run of one call opens straight to them. */
  initiallyOpen?: boolean
}) {
  // An approval request opens itself; a finished command collapses again.
  const [open, setOpen] = useState(initiallyOpen || part.state === 'approval-requested')
  const done = part.state === 'output-available' || part.state === 'output-error'
  const errored = part.state === 'output-error'
  const label = getToolLabel(part)
  const commandTool = isCommandTool(part)
  const hasLiveOutput = Boolean(part.liveOutput?.stdout || part.liveOutput?.stderr)

  useReportVisibleError(
    !commandTool && errored ? (part.errorText ?? `${label} failed`) : null,
    'agent_tool_error_card',
  )
  const [openedFor, setOpenedFor] = useState({
    commandTool,
    done,
    state: part.state,
    id: part.toolCallId,
    hasLiveOutput,
  })

  if (
    openedFor.commandTool !== commandTool ||
    openedFor.done !== done ||
    openedFor.state !== part.state ||
    openedFor.id !== part.toolCallId ||
    openedFor.hasLiveOutput !== hasLiveOutput
  ) {
    setOpenedFor({ commandTool, done, state: part.state, id: part.toolCallId, hasLiveOutput })
    if (part.state === 'approval-requested') setOpen(true)
    else if (commandTool && done) setOpen(false)
    else if (commandTool && hasLiveOutput && !openedFor.hasLiveOutput) setOpen(true)
  }

  return (
    <div className="text-[12.5px]" data-tool-call-id={part.toolCallId}>
      <button
        onPointerDown={(event) => {
          if (event.button !== 0) return
          setOpen((v) => !v)
        }}
        onClick={(event) => {
          if (event.detail !== 0) return
          setOpen((v) => !v)
        }}
        className={clsx(
          disclosureControlClass,
          'group inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-tertiary transition-colors hover:text-secondary',
        )}
      >
        {!done ? (
          <>
            {commandTool && <Terminal className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />}
            <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
            <ToolElapsedBadge part={part} now={now} />
          </>
        ) : (
          <>
            {commandTool && <Terminal className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />}
            <span className="min-w-0 truncate text-left">{label}</span>
            <ToolElapsedBadge part={part} now={now} />
          </>
        )}
        <ChevronRight
          className={clsx(
            'w-3.5 h-3.5 flex-shrink-0 transition-all',
            open ? 'rotate-90 opacity-60' : 'opacity-0 group-hover:opacity-60',
          )}
          strokeWidth={1.8}
        />
      </button>
      {/* Do not merely CSS-hide this subtree. CodeSection formats arbitrary
          output eagerly, and historical log results can be several MB. */}
      {open && (
        <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-200 ease-out">
          <div className="overflow-hidden">
            <div className="pt-2.5 space-y-1.5">
              {part.authorization?.decision === 'allow' && part.authorization.triggeredBy && (
                <div className="flex items-start gap-1.5 rounded-md border border-zGray-800/70 bg-zGray-950/40 px-2.5 py-1.5 text-[11.5px] leading-4 italic text-tertiary">
                  <span className="flex h-4 flex-shrink-0 items-center">
                    <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span>{describeAutoAuthorization(part.authorization.triggeredBy)}</span>
                </div>
              )}
              {(part.approval?.approved !== undefined || part.authorization?.resolved) && (
                <div className="flex items-start gap-1.5 rounded-md border border-zGray-800/70 bg-zGray-950/40 px-2.5 py-1.5 text-[11.5px] leading-4 italic text-tertiary">
                  <span className="flex h-4 flex-shrink-0 items-center">
                    <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span>
                    {(part.approval?.approved ?? part.authorization?.resolved === 'approved')
                      ? 'You approved this command.'
                      : 'You declined this command.'}
                  </span>
                </div>
              )}
              {commandTool ? (
                <CommandTerminalView part={part} />
              ) : (
                <>
                  {part.input !== undefined && <CodeSection label="Input" value={part.input} />}
                  {part.output !== undefined && <CodeSection label="Output" value={part.output} />}
                  {part.errorText && <CodeSection label="Error" value={part.errorText} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {part.state === 'approval-requested' && (
        <AuthorizationApprovalActions
          toolCallId={part.toolCallId}
          reason={part.authorization?.reason}
          suggestedRule={part.authorization?.suggestedRule}
          source={part.approval?.source}
        />
      )}
      {(() => {
        const proposed = proposedRuleFrom(part)

        return proposed ? (
          <ProposedRuleActions ruleId={proposed.ruleId} description={proposed.description} />
        ) : null
      })()}
    </div>
  )
}
