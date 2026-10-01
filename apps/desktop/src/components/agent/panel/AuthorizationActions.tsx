import { ShieldCheck } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { AuthorizationActionContext } from './parts'

// Rule descriptions are short generalized phrases, never raw commands. Keep in
// sync with RULE_DESCRIPTION_MAX_LENGTH in the backend auto-mode store.
export const RULE_DESCRIPTION_MAX_LENGTH = 200

export function AuthorizationApprovalActions({
  toolCallId,
  reason,
  suggestedRule,
  source,
}: {
  toolCallId: string
  reason?: string
  suggestedRule?: string
  source?: 'openab'
}) {
  const ctx = useContext(AuthorizationActionContext)
  // "Always allow" expands an inline description field: a standing rule is a
  // short generalized phrase (matched semantically by the judge), never the raw
  // command. Prefill the judge's suggestion when it produced one.
  const [ruleDraft, setRuleDraft] = useState<string | null>(null)

  // Read-only sessions never expose approve/deny. Otherwise only the latest
  // unresolved authorization shows buttons; a superseded earlier block renders
  // nothing (the newer attempt's card owns the prompt).
  if (!ctx || ctx.readOnly || ctx.activeToolCallId !== toolCallId) return null
  const decide = ctx.decide
  const trimmedDraft = ruleDraft?.trim() ?? ''

  return (
    <div className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5">
      <div className="flex items-start gap-1.5 text-[12px] text-main">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" strokeWidth={2} />
        <span>Authorization required{reason ? ` — ${reason}` : ''}</span>
      </div>
      {source === 'openab' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => decide(toolCallId, 'once')}
            className="inline-flex h-8 items-center rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600"
          >
            Approve once
          </button>
          <button
            type="button"
            onClick={() => decide(toolCallId, 'deny')}
            className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400"
          >
            Deny
          </button>
        </div>
      ) : ruleDraft === null ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => decide(toolCallId, 'once')}
            className="inline-flex h-8 items-center rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600"
          >
            Approve once
          </button>
          <button
            type="button"
            onClick={() => decide(toolCallId, 'session')}
            className="inline-flex h-8 items-center rounded-md border border-zGray-700 px-3 text-[12px] font-medium text-secondary transition-colors hover:text-main"
          >
            Approve for session
          </button>
          <button
            type="button"
            onClick={() => setRuleDraft(suggestedRule ?? '')}
            className="inline-flex h-8 items-center rounded-md border border-zGray-700 px-3 text-[12px] font-medium text-secondary transition-colors hover:text-main"
            title="Create a standing rule so this class of operation auto-runs in future"
          >
            Always allow…
          </button>
          <button
            type="button"
            onClick={() => decide(toolCallId, 'deny')}
            className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400"
          >
            Deny
          </button>
        </div>
      ) : (
        <div className="mt-2.5">
          <label className="text-[11.5px] text-tertiary">
            Describe the class of operation to auto-allow (a short phrase, not the command):
          </label>
          <input
            type="text"
            autoFocus
            value={ruleDraft}
            maxLength={RULE_DESCRIPTION_MAX_LENGTH}
            onChange={(e) => setRuleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return // IME composition commit, not a submit
              if (e.key === 'Enter' && trimmedDraft) decide(toolCallId, 'always', trimmedDraft)
              if (e.key === 'Escape') setRuleDraft(null)
            }}
            placeholder="e.g. update Asana tasks in the team workspace"
            className="mt-1.5 h-8 w-full rounded-md border border-zGray-700 bg-zGray-950/40 px-2.5 text-[12px] text-main placeholder:text-tertiary focus:border-zViolet-500 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!trimmedDraft}
              onClick={() => decide(toolCallId, 'always', trimmedDraft)}
              className="inline-flex h-8 items-center rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create rule &amp; allow
            </button>
            <button
              type="button"
              onClick={() => setRuleDraft(null)}
              className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-main"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProposedRuleActions({
  ruleId,
  description,
}: {
  ruleId: string
  description: string
}) {
  const authCtx = useContext(AuthorizationActionContext)
  // Reconcile with the durable rule state on mount, so reopening the chat shows
  // the right thing (already-confirmed → active, dismissed/gone → nothing to do)
  // rather than always re-offering the buttons.
  const [status, setStatus] = useState<'loading' | 'proposed' | 'active' | 'gone' | 'busy'>(
    'loading',
  )

  useEffect(() => {
    let alive = true

    api
      .agentListAutoModeRules()
      .then(({ rules }) => {
        if (!alive) return
        const r = rules.find((x) => x.id === ruleId)

        setStatus(!r ? 'gone' : r.status === 'active' ? 'active' : 'proposed')
      })
      // Fail toward showing the buttons — a possibly-redundant confirm beats
      // hiding a real proposal on a transient error.
      .catch(() => {
        if (alive) setStatus('proposed')
      })

    return () => {
      alive = false
    }
  }, [ruleId])

  const confirm = async () => {
    setStatus('busy')
    try {
      await api.agentActivateAutoModeRule(ruleId)
      setStatus('active')
      // Transient feedback only — no persistent status hanging under the tool.
      toast.success(
        'Rule confirmed',
        'This class now auto-runs. Manage it in Settings → Auto-authorization.',
      )
    } catch (err) {
      setStatus('proposed')
      toast.apiError('Could not confirm the rule', err)
    }
  }
  const dismiss = async () => {
    setStatus('busy')
    try {
      await api.agentDeleteAutoModeRule(ruleId)
      setStatus('gone')
      toast.info('Rule dismissed')
    } catch (err) {
      setStatus('proposed')
      toast.apiError('Could not dismiss the rule', err)
    }
  }

  // Read-only sessions never expose the confirm/dismiss actions (audit surface).
  if (authCtx?.readOnly) return null
  // Nothing to render unless the rule is still awaiting the user's decision.
  // Once confirmed/dismissed (or on reopen of a chat where it was already
  // handled), the card simply disappears — feedback is a transient toast, not a
  // message left sitting under the tool call.
  if (status !== 'proposed' && status !== 'busy') return null

  return (
    <div className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5">
      <div className="flex items-start gap-1.5 text-[12px] text-main">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" strokeWidth={2} />
        <span>
          Proposed standing rule: <span className="not-italic text-secondary">{description}</span>
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={status === 'busy'}
          onClick={() => void confirm()}
          className="inline-flex h-8 items-center rounded-md bg-zViolet-500 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zViolet-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm rule
        </button>
        <button
          type="button"
          disabled={status === 'busy'}
          onClick={() => void dismiss()}
          className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
