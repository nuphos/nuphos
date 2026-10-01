import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { isTriggerAlreadyDeletedError } from '../../lib/agentTriggerDelete'

import { reportCleanupFailures, stripTrailingSlashes } from './shared'
import { confirmRemoveTrigger, submitTriggerForm, testFireTrigger } from './triggerFormActions'

import type { AgentTrigger, AgentTriggerType } from '../../api'

export type FormState = {
  name: string
  triggerType: AgentTriggerType
  cronExpression: string
  messageTemplate: string
}

export function useTriggerFormController({
  mode,
  triggerId,
  teamId,
  canManage,
  canDelete,
  atlasApiUrl,
  onSaved,
  onDeleted,
}: {
  mode: 'create' | 'edit'
  triggerId?: string
  teamId?: string
  canManage: boolean
  canDelete: boolean
  atlasApiUrl?: string
  onSaved: (trigger: AgentTrigger) => void
  onDeleted: (triggerId: string) => void
}) {
  const [loaded, setLoaded] = useState<AgentTrigger | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({
    name: '',
    triggerType: 'cron',
    cronExpression: '0 9 * * 1-5',
    messageTemplate: '',
  })
  const [saving, setSaving] = useState(false)
  const [revealSecret, setRevealSecret] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [firing, setFiring] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Load existing trigger when editing — we need the webhookSecret which is
  // only returned on the single-trigger GET, not on the list response.
  useEffect(() => {
    if (mode !== 'edit' || !triggerId) return
    let cancelled = false

    void (async () => {
      try {
        const t = await api.agentGetTrigger(triggerId, teamId)

        if (cancelled) return
        reportCleanupFailures([t])
        setLoaded(t)
        setForm({
          name: t.name,
          triggerType: t.triggerType,
          cronExpression: t.cronExpression ?? '',
          messageTemplate: t.messageTemplate,
        })
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mode, triggerId, teamId])

  // Provider cleanup runs in the backend queue, so the screen that started the
  // removal has to be the one that watches it finish: the list's poll is gated
  // on the list view, and the effect above only fetches on mount. Without this,
  // someone who stays here after pressing Remove sits on "Removing…" forever
  // while the trigger is already gone.
  const cleanupPending = loaded?.cleanupStatus === 'deleting'
  // The parent passes fresh closures every render, so they are read through a
  // ref: in the dependency array they would restart the poll on each render.
  const callbacks = useRef({ onSaved, onDeleted })

  useEffect(() => {
    callbacks.current = { onSaved, onDeleted }
  })
  useEffect(() => {
    if (!cleanupPending || !triggerId) return
    let cancelled = false
    let timer: number | undefined
    let failures = 0
    const poll = async () => {
      let shouldContinue = true

      try {
        const refreshed = await api.agentGetTrigger(triggerId, teamId)

        if (cancelled) return
        failures = 0
        shouldContinue = refreshed.cleanupStatus === 'deleting'
        reportCleanupFailures([refreshed])
        setLoaded(refreshed)
        // Cleanup settled as a failure: hand the row to the list so it stops
        // showing this Watch as still being removed.
        if (!shouldContinue) callbacks.current.onSaved(refreshed)
      } catch (err) {
        if (cancelled) return
        // Cleanup succeeded — the trigger is deleted, so reading it now fails.
        if (isTriggerAlreadyDeletedError(err)) {
          shouldContinue = false
          callbacks.current.onDeleted(triggerId)

          return
        }
        // Stay quiet and back off instead of raising a toast per attempt: a
        // dropped connection here is transient, and the banner already says
        // removal is in progress.
        failures += 1
      } finally {
        if (!cancelled && shouldContinue) {
          timer = window.setTimeout(
            () => {
              void poll()
            },
            Math.min(2_000 * 2 ** failures, 30_000),
          )
        }
      }
    }

    timer = window.setTimeout(() => {
      void poll()
    }, 2_000)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [cleanupPending, triggerId, teamId])

  const webhookUrl = useMemo(() => {
    if (loaded?.triggerType !== 'webhook') return null
    // Bail when the backend URL hasn't resolved yet (or failed). Otherwise
    // the gate `{webhookUrl && …}` would render the panel with a broken
    // relative `/webhooks/<id>` that users could copy.
    if (!atlasApiUrl) return null
    const base = stripTrailingSlashes(atlasApiUrl)

    return `${base}/webhooks/${loaded.id}`
  }, [loaded, atlasApiUrl])

  const copy = useCallback(async (kind: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // ignore — clipboard requires user gesture / permissions
    }
  }, [])

  const submit = useCallback(
    () =>
      submitTriggerForm({
        mode,
        form,
        teamId,
        triggerId,
        loaded,
        setSaving,
        setLoaded,
        setForm,
        onSaved,
      }),
    [form, mode, triggerId, loaded, teamId, onSaved],
  )

  const confirmRemove = useCallback(async () => {
    if (!triggerId) return
    await confirmRemoveTrigger({ triggerId, teamId, canDelete, setLoaded, onSaved, onDeleted })
  }, [triggerId, teamId, canDelete, onDeleted, onSaved])

  const testFire = useCallback(async () => {
    if (!triggerId) return
    await testFireTrigger({ triggerId, teamId, canManage, setFiring })
  }, [triggerId, teamId, canManage])

  return {
    loaded,
    setLoaded,
    loadError,
    form,
    setForm,
    saving,
    revealSecret,
    setRevealSecret,
    copied,
    firing,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    webhookUrl,
    copy,
    submit,
    confirmRemove,
    testFire,
  }
}
