import clsx from 'clsx'
import { Check, ChevronDown, ChevronLeft, Loader2, MessageSquare, RotateCcw, X } from 'lucide-react'

import { useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText } from '../../../lib/platform'
import { Button } from '../../ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { useDecisionKeys } from '../panel/useDecisionKeys'

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
  const live = decision === 'pending' && showApproveBar && !changesOpen
  const cardRef = useRef<HTMLDivElement | null>(null)
  const act = useDecisionKeys(cardRef, live, (key) => {
    if (key.kind !== 'approve') return false
    void approve()

    return true
  })
  // Cross-fade the footer when the decision changes, but not on mount, so a
  // card scrolled into history doesn't replay it.
  const [shown, setShown] = useState({ decision, swapped: false })

  if (decision !== shown.decision) setShown({ decision, swapped: true })

  return (
    <div
      ref={cardRef}
      data-decision-card={live ? '' : undefined}
      className={clsx(
        'flex flex-shrink-0 flex-col gap-2.5 px-4',
        floating
          ? 'rounded-lg border border-zGray-800/60 bg-zGray-900 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
          : 'border-t border-zGray-800/70 bg-zGray-950/95 py-3',
        decision === 'approved' && 'bg-emerald-500/5',
        decision === 'chatting' && 'bg-zGray-800/40',
      )}
    >
      <div
        key={decision}
        className="t-nav-stack__layer flex flex-col gap-2.5"
        data-anim={shown.swapped ? 'enter' : undefined}
      >
        {decision === 'pending' && showApproveBar ? (
          <>
            {/* Reason box — revealed (accordion expand) only when "Request
                changes" is chosen from the Approve menu. */}
            <div className="t-acc" data-open={changesOpen}>
              <div className="t-acc-panel" inert={!changesOpen}>
                <div className="t-acc-panel-inner">
                  <div className="pb-2.5">
                    <textarea
                      ref={changeRequestRef}
                      value={changeRequest}
                      onChange={(e) => setChangeRequest(e.target.value)}
                      placeholder={t('Tell the agent what to change…')}
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
                      className="w-full resize-none rounded-lg border border-zGray-800 bg-surface px-3 py-2 text-[13px] leading-snug text-main placeholder:text-tertiary focus:border-zViolet-accent/40 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
            {/* One primary button: Approve (split, with the caret menu) by
                default; it becomes Send while composing a change request. */}
            <div className="flex items-center justify-end gap-2">
              {approvalProgress && (
                <span className="mr-auto text-[11.5px] text-tertiary">
                  {approvalProgress.requesterApproved
                    ? t('Requester approved · team {done}/{required}', {
                        done: approvalProgress.otherApprovals,
                        required: approvalProgress.minimumOtherApprovals,
                      })
                    : t('Requester pending · team {done}/{required}', {
                        done: approvalProgress.otherApprovals,
                        required: approvalProgress.minimumOtherApprovals,
                      })}
                </span>
              )}
              {changesOpen ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setChangesOpen(false)
                      setChangeRequest('')
                    }}
                    className="flex-shrink-0 gap-1.5"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
                    {t('Back')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={requestChanges}
                    disabled={!hasChangeRequest}
                    className="flex-shrink-0 gap-1.5 px-4 active:scale-95"
                  >
                    <MessageSquare className="h-3 w-3" strokeWidth={2.4} />
                    {t('Send')}
                  </Button>
                </>
              ) : (
                <div className="inline-flex overflow-hidden rounded-md">
                  <Button
                    variant="primary"
                    size="sm"
                    title={t('Approve ({shortcut})', { shortcut: comboText('mod+enter') })}
                    onClick={() => act(() => void approve())}
                    className={clsx(
                      'flex-shrink-0 gap-1.5 pl-3 pr-2.5 active:scale-95',
                      onReject && 'rounded-r-none',
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.4} />
                    {t('Approve')}
                  </Button>
                  {onReject && (
                    <Menu>
                      <MenuTrigger
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center border-l border-white/20 bg-zViolet-500 text-white transition hover:bg-zViolet-400 data-[popup-open]:bg-zViolet-400"
                        aria-label={t('More plan actions')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </MenuTrigger>
                      <MenuContent side="top" align="end">
                        <MenuItem
                          icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />}
                          onClick={() => setChangesOpen(true)}
                        >
                          {t('Request changes')}
                        </MenuItem>
                        <MenuItem
                          destructive
                          icon={<X className="h-3.5 w-3.5" strokeWidth={2.2} />}
                          onClick={reject}
                        >
                          {t('Reject')}
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
            {t('Recording approval…')}
          </span>
        ) : decision === 'pending' ? (
          <div className="flex items-center justify-end gap-2">
            {retryError && (
              <span className="mr-auto max-w-[60%] truncate text-[12px] text-error">
                {retryError}
              </span>
            )}
            {showRetry && (
              <Button
                size="sm"
                className="flex-shrink-0"
                type="button"
                onClick={onRetry}
                disabled={retrying}
              >
                {retrying ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                ) : (
                  <RotateCcw className="h-3 w-3" strokeWidth={2.2} />
                )}
                {t('Retry')}
              </Button>
            )}
          </div>
        ) : decision === 'approved' ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-400">
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            {t('Plan approved — ready to proceed.')}
          </span>
        ) : decision === 'approval-recorded' ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-zViolet-accent">
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            {t('Approval recorded — waiting for {n} more required approval(s).', {
              n: Math.max(
                0,
                Number(
                  Boolean(
                    approvalProgress?.requesterApprovalRequired &&
                    !approvalProgress.requesterApproved,
                  ),
                ) +
                  (approvalProgress?.minimumOtherApprovals ?? 0) -
                  (approvalProgress?.otherApprovals ?? 0),
              ),
            })}
          </span>
        ) : decision === 'changes-requested' ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            {t('Changes requested — agent revising.')}
          </span>
        ) : decision === 'rejected' ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            {t('Plan rejected.')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tertiary">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            {t('Plan paused — type a message to redirect.')}
          </span>
        )}
      </div>
    </div>
  )
}
