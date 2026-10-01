import clsx from 'clsx'
import { Check, ChevronDown, ChevronLeft, Loader2, MessageSquare, RotateCcw, X } from 'lucide-react'

import { Button } from '../../ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'

import type { PlanDecisionState } from './usePlanDecision'
import type { PlanApprovalProgress } from '../../../api'

type PlanActionBarProps = {
  state: PlanDecisionState
  floating: boolean
  showApproveBar: boolean
  showRetry: boolean
  approvalProgress?: PlanApprovalProgress
  onReject?: (reason: string, mode: 'revise' | 'delete') => void
  onRetry?: () => void
  retrying: boolean
  retryError?: string | null
}

export function PlanActionBar({
  state,
  floating,
  showApproveBar,
  showRetry,
  approvalProgress,
  onReject,
  onRetry,
  retrying,
  retryError,
}: PlanActionBarProps) {
  const {
    decision,
    changeRequest,
    setChangeRequest,
    changesOpen,
    setChangesOpen,
    changeRequestRef,
    imeComposingRef,
    approve,
    requestChanges,
    reject,
  } = state
  const hasChangeRequest = changeRequest.trim().length > 0

  return (
    <div
      className={clsx(
        'flex flex-shrink-0 flex-col gap-2.5 px-4',
        floating
          ? 'rounded-lg border border-zGray-800/60 bg-zGray-900 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
          : 'border-t border-zGray-800/70 bg-zGray-950/95 py-3',
        decision === 'approved' && 'bg-emerald-500/5',
        decision === 'chatting' && 'bg-zGray-800/40',
      )}
    >
      {decision === 'pending' && showApproveBar ? (
        <>
          {/* Reason box — revealed (animated) only when "Request changes" is
                chosen from the Approve menu. The grid-rows tween handles height;
                an opacity/translate fade on the inner (GPU-composited) keeps it
                smooth and elegant. */}
          <div
            className="t-collapse"
            data-open={changesOpen}
            style={{ ['--resize-dur' as string]: '220ms' }}
          >
            <div className="t-collapse-inner">
              <div
                className={clsx(
                  'pb-2.5 transition-[opacity,transform] duration-200 ease-out',
                  changesOpen
                    ? 'opacity-100 translate-y-0'
                    : 'pointer-events-none -translate-y-1 opacity-0',
                )}
              >
                <textarea
                  ref={changeRequestRef}
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  placeholder="Tell the agent what to change…"
                  rows={2}
                  onCompositionStart={() => {
                    imeComposingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    imeComposingRef.current = false
                  }}
                  onKeyDown={(e) => {
                    const native = e.nativeEvent as { isComposing?: boolean; keyCode?: number }

                    if (e.key === 'Escape') {
                      e.preventDefault()
                      // Collapse and drop the draft so a later Reject doesn't
                      // forward stale text.
                      setChangesOpen(false)
                      setChangeRequest('')

                      return
                    }
                    // Enter submits — but never while an IME is composing
                    // (Pinyin candidate selection). preventDefault even when
                    // empty so a bare Enter doesn't insert a stray newline.
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !imeComposingRef.current &&
                      !native.isComposing &&
                      native.keyCode !== 229
                    ) {
                      e.preventDefault()
                      if (hasChangeRequest) requestChanges()
                    }
                  }}
                  className="w-full resize-none rounded-lg border border-zGray-800 bg-field px-3 py-2 text-[13px] leading-snug text-main placeholder:text-tertiary focus:border-zViolet-accent/40 focus:outline-none"
                />
              </div>
            </div>
          </div>
          {/* One primary button: Approve (split, with the caret menu) by
                default; it becomes Send while composing a change request. */}
          <div className="flex items-center justify-end gap-2">
            {approvalProgress && (
              <span className="mr-auto text-[11.5px] text-tertiary">
                Requester {approvalProgress.requesterApproved ? 'approved' : 'pending'} · team{' '}
                {approvalProgress.otherApprovals}/{approvalProgress.minimumOtherApprovals}
              </span>
            )}
            {changesOpen ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChangesOpen(false)
                    setChangeRequest('')
                  }}
                  className="h-7 flex-shrink-0 gap-1.5 px-2.5 text-[12.5px]"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={requestChanges}
                  disabled={!hasChangeRequest}
                  className="h-7 flex-shrink-0 gap-1.5 px-4 text-[12.5px] active:scale-95"
                >
                  <MessageSquare className="h-3 w-3" strokeWidth={2.4} />
                  Send
                </Button>
              </>
            ) : (
              <div className="inline-flex overflow-hidden rounded-md">
                <Button
                  variant="primary"
                  onClick={() => void approve()}
                  className={clsx(
                    'h-7 flex-shrink-0 gap-1.5 pl-3 pr-2.5 text-[12.5px] active:scale-95',
                    onReject ? 'rounded-none' : 'rounded-md',
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={2.4} />
                  Approve
                </Button>
                {onReject && (
                  <Menu>
                    <MenuTrigger
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center border-l border-white/20 bg-zViolet-500 text-white transition hover:bg-zViolet-400 data-[popup-open]:bg-zViolet-400"
                      aria-label="More plan actions"
                    >
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </MenuTrigger>
                    <MenuContent side="top" align="end">
                      <MenuItem
                        icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />}
                        onClick={() => setChangesOpen(true)}
                      >
                        Request changes
                      </MenuItem>
                      <MenuItem
                        destructive
                        icon={<X className="h-3.5 w-3.5" strokeWidth={2.2} />}
                        onClick={reject}
                      >
                        Reject
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            )}
          </div>
        </>
      ) : decision === 'approving' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          Recording approval…
        </span>
      ) : decision === 'pending' ? (
        <div className="flex items-center justify-end gap-2">
          {retryError && (
            <span className="mr-auto max-w-[60%] truncate text-[12px] text-error">
              {retryError}
            </span>
          )}
          {showRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-zViolet-500 px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
              ) : (
                <RotateCcw className="h-3 w-3" strokeWidth={2.2} />
              )}
              Retry
            </button>
          )}
        </div>
      ) : decision === 'approved' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-400">
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          Plan approved — ready to proceed.
        </span>
      ) : decision === 'approval-recorded' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-zViolet-accent">
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          Approval recorded — waiting for{' '}
          {Math.max(
            0,
            Number(
              Boolean(
                approvalProgress?.requesterApprovalRequired && !approvalProgress.requesterApproved,
              ),
            ) +
              (approvalProgress?.minimumOtherApprovals ?? 0) -
              (approvalProgress?.otherApprovals ?? 0),
          )}{' '}
          more required approval(s).
        </span>
      ) : decision === 'changes-requested' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
          Changes requested — agent revising.
        </span>
      ) : decision === 'rejected' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          Plan rejected.
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
          Plan paused — type a message to redirect.
        </span>
      )}
    </div>
  )
}
