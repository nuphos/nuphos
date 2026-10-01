import { faCheck, faRotateRight, faTrashCan } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { toast } from '../../components/ui/toast'

import { SectionHeader } from './shared'
import { inputClasses } from './styles'

import type { AutoModeRule } from '../../api'
import type { FormEvent } from 'react'

// Keep in sync with RULE_DESCRIPTION_MAX_LENGTH in the backend auto-mode store.
const RULE_DESCRIPTION_MAX_LENGTH = 200

export function AutoModeSection() {
  const [rules, setRules] = useState<AutoModeRule[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  function fetchRules() {
    return api
      .agentListAutoModeRules()
      .then((res) => {
        setRules(res.rules)
        setEnabled(res.enabled)
      })
      .catch((err: unknown) => {
        setError(parseAtlasError(err).message)
      })
      .finally(() => {
        setLoading(false)
      })
  }
  // Reloads triggered by an action put the spinner back up and drop the stale
  // error; the initial state already covers the mount below.
  async function load() {
    setLoading(true)
    setError(null)
    await fetchRules()
  }
  useEffect(() => {
    void fetchRules()
  }, [])

  async function addRule(e: FormEvent) {
    e.preventDefault()
    const description = draft.trim()

    if (!description) return
    setBusy('add')
    try {
      await api.agentCreateAutoModeRule(description)
      setDraft('')
      await load()
      toast.success('Rule added')
    } catch (err) {
      toast.apiError('Could not add rule', err)
    } finally {
      setBusy(null)
    }
  }
  async function activate(ruleId: string) {
    setBusy(ruleId)
    try {
      await api.agentActivateAutoModeRule(ruleId)
      await load()
    } catch (err) {
      toast.apiError('Could not confirm rule', err)
    } finally {
      setBusy(null)
    }
  }
  async function remove(ruleId: string) {
    setBusy(ruleId)
    try {
      await api.agentDeleteAutoModeRule(ruleId)
      await load()
    } catch (err) {
      toast.apiError('Could not remove rule', err)
    } finally {
      setBusy(null)
    }
  }

  const proposed = rules.filter((r) => r.status === 'proposed')
  const active = rules.filter((r) => r.status === 'active')

  return (
    <div>
      <SectionHeader
        title="Auto-authorization"
        description="Standing rules that let the agent run matching operations without asking. Irreversible operations (deletes, production, etc.) always require per-command approval."
      />

      {!enabled && (
        <div className="mb-4 rounded-md border border-zGray-800/70 bg-surface px-4 py-3 text-[12.5px] text-tertiary">
          Auto-authorization is currently disabled on this backend. Rules are saved but only take
          effect once it is enabled.
        </div>
      )}

      <form onSubmit={(e) => void addRule(e)} className="mb-4 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={RULE_DESCRIPTION_MAX_LENGTH}
          placeholder="e.g. restart deployments in the staging namespace"
          className={clsx(inputClasses, 'min-w-0 flex-1')}
        />
        <button
          type="submit"
          disabled={busy === 'add' || !draft.trim()}
          className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-zViolet-500 px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-zViolet-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add rule
        </button>
      </form>

      {proposed.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-amber-500/40 bg-surface">
          <div className="border-b border-amber-500/30 px-4 py-3 text-[13px] font-medium text-main">
            Proposed by the agent &mdash; confirm to activate
          </div>
          <div className="divide-y divide-zGray-800/60">
            {proposed.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-[12.5px] text-main">{rule.description}</div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy === rule.id}
                    onClick={() => void activate(rule.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-zViolet-500 px-2.5 text-[12px] font-medium text-white hover:bg-zViolet-600 disabled:opacity-50"
                  >
                    <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={busy === rule.id}
                    onClick={() => void remove(rule.id)}
                    className="inline-flex h-8 items-center rounded-md border border-zGray-800 px-2.5 text-[12px] text-secondary hover:text-main disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zGray-800/70 bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-zGray-800/60 px-4 py-3">
          <div className="text-[13px] font-medium text-main">Active rules</div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zGray-800 px-2.5 text-[12.5px] font-medium text-secondary transition-colors hover:border-zGray-700 hover:text-main disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FontAwesomeIcon
              icon={faRotateRight}
              className={clsx('h-3 w-3', loading && 'animate-spin')}
            />
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">Loading rules&hellip;</div>
        ) : error ? (
          <div className="px-4 py-6 text-[13px] text-error">{error}</div>
        ) : active.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-tertiary">
            No active rules yet. Add one above, or approve a blocked command &ldquo;always&rdquo; in
            chat.
          </div>
        ) : (
          <div className="divide-y divide-zGray-800/60">
            {active.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-[12.5px] text-main">{rule.description}</div>
                <button
                  type="button"
                  disabled={busy === rule.id}
                  onClick={() => void remove(rule.id)}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-zGray-800 text-tertiary transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                  title="Remove rule"
                >
                  <FontAwesomeIcon icon={faTrashCan} className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
