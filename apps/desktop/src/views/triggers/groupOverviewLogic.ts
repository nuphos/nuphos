import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n/index.ts'
import { isTriggerAlreadyDeletedError } from '../../lib/agentTriggerDelete'

import { executionPrincipalLabel } from './shared'

import type { AgentTrigger, AgentTriggerGroup } from '../../api'
import type { TeamMember } from '../../types'

export type GroupIngressDetails = {
  triggerId: string
  trigger?: AgentTrigger
  error?: string
}

export type GroupOverviewForm = {
  name: string
  messageTemplate: string
}

export function deriveGroupOverview({
  group,
  triggers,
  ingresses,
  loading,
  members,
  form,
}: {
  group: AgentTriggerGroup
  triggers: AgentTrigger[]
  ingresses: GroupIngressDetails[]
  loading: boolean
  members: TeamMember[]
  form: GroupOverviewForm
}) {
  const loadedTriggers = group.partitions
    .map((partition) => {
      const loaded = ingresses.find((entry) => entry.triggerId === partition.triggerId)?.trigger

      return loaded ?? triggers.find((trigger) => trigger.id === partition.triggerId)
    })
    .filter((trigger): trigger is AgentTrigger => Boolean(trigger))
  const allIngressesLoaded =
    !loading &&
    loadedTriggers.length === group.partitionCount &&
    !ingresses.some((entry) => entry.error)
  const allResourcesRecorded =
    allIngressesLoaded && loadedTriggers.every((trigger) => Boolean(trigger.providerWiring))
  const groupActive =
    group.state === 'active' &&
    loadedTriggers.length > 0 &&
    loadedTriggers.every((trigger) => trigger.enabled)
  const principalId =
    group.executionPrincipalUserId ??
    group.createdByUserId ??
    loadedTriggers[0]?.executionPrincipalUserId ??
    loadedTriggers[0]?.createdByUserId ??
    loadedTriggers[0]?.userId
  const principalLabel = principalId
    ? executionPrincipalLabel(members, principalId)
    : t('Unknown user')
  const hasChanges =
    form.name.trim() !== group.name || form.messageTemplate.trim() !== group.messageTemplate

  return {
    allIngressesLoaded,
    allResourcesRecorded,
    groupActive,
    principalLabel,
    hasChanges,
  }
}

export type GroupActionContext = {
  group: AgentTriggerGroup
  form: GroupOverviewForm
  canManage: boolean
  canDelete: boolean
  canSave: boolean
  loading: boolean
  allIngressesLoaded: boolean
  allResourcesRecorded: boolean
  groupActive: boolean
  setForm: (form: GroupOverviewForm) => void
  setAction: (action: 'test' | 'delete' | 'save' | null) => void
  setConfirmDeleteOpen: (open: boolean) => void
  onSaved: (group: AgentTriggerGroup) => void
  onDeleted: () => void
}

export async function saveTriggerGroup(ctx: GroupActionContext) {
  const { group, form } = ctx

  if (!ctx.canManage || !ctx.canSave) return
  ctx.setAction('save')
  try {
    const updated = await api.agentUpdateTriggerGroup(
      group.id,
      {
        ...(form.name.trim() !== group.name ? { name: form.name.trim() } : {}),
        ...(form.messageTemplate.trim() !== group.messageTemplate
          ? { messageTemplate: form.messageTemplate.trim() }
          : {}),
      },
      group.teamId,
    )

    ctx.setForm({
      name: updated.name,
      messageTemplate: updated.messageTemplate,
    })
    ctx.onSaved(updated)
  } catch (error) {
    toast.apiError(t('Could not save Watch group'), error, {
      fallback: t('No provider routing was changed. Refresh and try again.'),
    })
  } finally {
    ctx.setAction(null)
  }
}

export async function testTriggerGroup(ctx: GroupActionContext) {
  const { group } = ctx

  if (!ctx.canManage) {
    toast.error(t('Could not test Watch group'), t('Editor or administrator access is required.'))

    return
  }
  if (ctx.loading) {
    toast.error(
      t('Could not test Watch group'),
      t('Provider setup is still loading. Try again in a moment.'),
    )

    return
  }
  if (!ctx.allIngressesLoaded) {
    toast.error(
      t('Could not test Watch group'),
      t('Could not load every shared ingress. Close and reopen the Group, then retry.'),
    )

    return
  }
  if (!ctx.allResourcesRecorded) {
    toast.error(
      t('Could not test Watch group'),
      t('Finish recording every provider ingress before testing.'),
    )

    return
  }
  if (!ctx.groupActive) {
    toast.error(t('Could not test Watch group'), t('Enable the Group before testing.'))

    return
  }
  ctx.setAction('test')
  try {
    const result = await api.agentTestFireTriggerGroup(group.id, group.teamId)

    const counts = { verified: result.verifiedIngressCount, total: group.partitionCount }

    toast.success(
      result.delivery === 'slack'
        ? t('Test fire sent to {destination}.', {
            destination: result.destinationLabel ?? 'Slack',
          })
        : t('Test fire completed.'),
      result.delivery === 'slack'
        ? t('Verified {verified}/{total} shared webhook ingresses.', counts)
        : t(
            '{verified}/{total} shared webhook ingresses verified. This Watch reports in Nuphos.',
            counts,
          ),
    )
  } catch (error) {
    toast.apiError(t('Could not test Watch group'), error)
  } finally {
    ctx.setAction(null)
  }
}

/**
 * Removing a group is removing its partition triggers; nothing about editing
 * one is involved. The parameter is therefore narrowed to what this actually
 * reads — GroupActionContext still satisfies it structurally — so a caller with
 * only a row in hand (the list's row menu) doesn't have to invent a form and a
 * set of no-op setters to ask for a delete.
 */
export async function deleteTriggerGroup(ctx: {
  group: AgentTriggerGroup
  canDelete: boolean
  setAction: (action: 'test' | 'delete' | 'save' | null) => void
  setConfirmDeleteOpen: (open: boolean) => void
  onDeleted: () => void
}) {
  const { group } = ctx

  if (!ctx.canDelete) {
    toast.error(t('Could not remove Watch group'), t('Administrator access is required.'))

    return
  }
  ctx.setAction('delete')
  try {
    // Trigger deletion owns provider cleanup and is idempotent. Deleting all
    // partitions also prunes the Group document after the final ingress.
    // A previous attempt may have removed only some partitions, so settle
    // every request and treat an already-absent trigger as success.
    const results = await Promise.allSettled(
      group.partitions.map((partition) =>
        api.agentDeleteTrigger(partition.triggerId, group.teamId),
      ),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' && !isTriggerAlreadyDeletedError(result.reason)
        ? [result.reason]
        : [],
    )

    if (failures.length > 0) throw failures[0]
    ctx.setConfirmDeleteOpen(false)
    ctx.onDeleted()
  } catch (error) {
    toast.apiError(t('Could not remove Watch group'), error, {
      fallback: t('Provider cleanup may be partial. Retry from the remaining group.'),
    })
    throw error
  } finally {
    ctx.setAction(null)
  }
}
