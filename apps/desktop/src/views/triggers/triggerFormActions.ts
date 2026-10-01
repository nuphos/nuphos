import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import {
  isTriggerAlreadyDeletedError,
  pendingTriggerFromDeleteResult,
} from '../../lib/agentTriggerDelete'

import { reportCleanupFailures } from './shared'

import type { FormState } from './useTriggerFormController'
import type { AgentTrigger, CreateAgentTriggerInput, UpdateAgentTriggerInput } from '../../api'

function retainTriggerDetails(current: AgentTrigger, updated: AgentTrigger): AgentTrigger {
  return {
    ...current,
    ...updated,
    webhookSecret: updated.webhookSecret ?? current.webhookSecret,
    providerWiring: updated.providerWiring ?? current.providerWiring,
    providerWiringFinalizedAt:
      updated.providerWiringFinalizedAt ?? current.providerWiringFinalizedAt,
    managedProviderResources: updated.managedProviderResources ?? current.managedProviderResources,
  }
}

export async function submitTriggerForm({
  mode,
  form,
  teamId,
  triggerId,
  loaded,
  setSaving,
  setLoaded,
  setForm,
  onSaved,
}: {
  mode: 'create' | 'edit'
  form: FormState
  teamId?: string
  triggerId?: string
  loaded: AgentTrigger | null
  setSaving: (saving: boolean) => void
  setLoaded: (trigger: AgentTrigger) => void
  setForm: (form: FormState) => void
  onSaved: (trigger: AgentTrigger) => void
}) {
  setSaving(true)
  try {
    if (mode === 'create') {
      const input: CreateAgentTriggerInput = {
        name: form.name.trim(),
        triggerType: form.triggerType,
        messageTemplate: form.messageTemplate.trim(),
        ...(form.triggerType === 'cron' ? { cronExpression: form.cronExpression.trim() } : {}),
        ...(teamId ? { teamId } : {}),
      }
      const created = await api.agentCreateTrigger(input)

      onSaved(created)
    } else if (triggerId && loaded) {
      const patch: UpdateAgentTriggerInput = {}

      if (form.name.trim() !== loaded.name) patch.name = form.name.trim()
      if (form.messageTemplate.trim() !== loaded.messageTemplate)
        patch.messageTemplate = form.messageTemplate.trim()
      if (
        loaded.triggerType === 'cron' &&
        form.cronExpression.trim() !== (loaded.cronExpression ?? '')
      )
        patch.cronExpression = form.cronExpression.trim()
      const updated = Object.keys(patch).length
        ? await api.agentUpdateTrigger(triggerId, patch, teamId)
        : loaded
      let details = retainTriggerDetails(loaded, updated)

      if (Object.keys(patch).length > 0) {
        try {
          details = await api.agentGetTrigger(updated.id, teamId)
        } catch {
          // The save already succeeded. Keep the previous detail-only fields
          // instead of hiding the webhook secret and provider receipt while a
          // transient follow-up GET is unavailable.
        }
      }
      setLoaded(details)
      setForm({
        name: details.name,
        triggerType: details.triggerType,
        cronExpression: details.cronExpression ?? '',
        messageTemplate: details.messageTemplate,
      })
      onSaved(updated)
    }
  } catch (err) {
    toast.apiError('Could not save trigger', err, {
      fallback: 'Check your connection and try again.',
    })
  } finally {
    setSaving(false)
  }
}

export async function confirmRemoveTrigger({
  triggerId,
  teamId,
  canDelete,
  setLoaded,
  onSaved,
  onDeleted,
}: {
  triggerId: string
  teamId?: string
  canDelete: boolean
  setLoaded: (trigger: AgentTrigger) => void
  onSaved: (trigger: AgentTrigger) => void
  onDeleted: (triggerId: string) => void
}) {
  try {
    if (!canDelete) {
      toast.error('Could not remove trigger', 'Administrator access is required.')

      return
    }
    const result = await api.agentDeleteTrigger(triggerId, teamId)
    const pendingTrigger = pendingTriggerFromDeleteResult(result)

    if (!pendingTrigger) {
      onDeleted(triggerId)

      return
    }
    setLoaded(pendingTrigger)
    onSaved(pendingTrigger)
  } catch (err) {
    if (isTriggerAlreadyDeletedError(err)) {
      onDeleted(triggerId)

      return
    }
    toast.apiError('Could not remove Watch', err, {
      fallback: 'Check your connection and try again.',
    })
    try {
      const refreshed = await api.agentGetTrigger(triggerId, teamId)

      reportCleanupFailures([refreshed])
      setLoaded(refreshed)
    } catch {
      // The original delete error is already visible in the toast.
    }
    throw err // Keep ConfirmDialog open so Retry remains available.
  }
}

export async function testFireTrigger({
  triggerId,
  teamId,
  canManage,
  setFiring,
}: {
  triggerId: string
  teamId?: string
  canManage: boolean
  setFiring: (firing: boolean) => void
}) {
  setFiring(true)
  try {
    if (!canManage) {
      toast.error('Could not test trigger', 'Editor or administrator access is required.')

      return
    }
    // No payload override — the middle argument is the webhook body, not the
    // team. Passing teamId here left the request unscoped and it failed with
    // nothing for the user to see.
    const result = await api.agentTestFireTrigger(triggerId, undefined, teamId)

    toast.success(
      result.delivery === 'slack'
        ? `Test fire sent to ${result.destinationLabel ?? 'Slack'}.`
        : 'Run started.',
      result.delivery === 'slack'
        ? 'The destination is working. No incident was opened and no investigation ran.'
        : 'It will appear in this trigger’s runs once the agent has started.',
    )
  } catch (err) {
    toast.apiError('Could not test trigger', err)
  } finally {
    setFiring(false)
  }
}
