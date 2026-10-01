import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { toast } from '../../components/ui/toast'
import { useResetOnKey } from '../useResetOnKey'

import {
  deleteTriggerGroup,
  deriveGroupOverview,
  saveTriggerGroup,
  testTriggerGroup,
} from './groupOverviewLogic'
import { GroupFormFields, GroupOverviewFooter, GroupTestFireButton } from './GroupOverviewSections'
import { GroupProviderSetup } from './GroupProviderSetup'
import { ExecutionPrincipalBanner } from './parts'

import type { GroupIngressDetails } from './groupOverviewLogic'
import type { AgentTrigger, AgentTriggerGroup } from '../../api'
import type { TeamMember } from '../../types'

export function TriggerGroupOverview({
  group,
  triggers,
  atlasApiUrl,
  canManage,
  canDelete,
  members,
  onBack,
  onSaved,
  onDeleted,
}: {
  group?: AgentTriggerGroup
  triggers: AgentTrigger[]
  atlasApiUrl?: string
  canManage: boolean
  canDelete: boolean
  members: TeamMember[]
  onBack: () => void
  onSaved: (group: AgentTriggerGroup) => void
  onDeleted: () => void
}) {
  const [ingresses, setIngresses] = useState<GroupIngressDetails[]>([])
  const [loading, setLoading] = useState(group !== undefined)
  const [copied, setCopied] = useState<string | null>(null)
  const [revealSecrets, setRevealSecrets] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState({
    name: group?.name ?? '',
    messageTemplate: group?.messageTemplate ?? '',
  })
  const [action, setAction] = useState<'test' | 'delete' | 'save' | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // The effect below keys off the group object; the reset needs a string, so it
  // keys off everything the effect and the reset actually read out of it.
  const groupKey = group
    ? `${group.id}|${group.teamId}|${group.name}|${group.messageTemplate}|${group.partitions
        .map((partition) => partition.triggerId)
        .join(',')}`
    : ''

  useResetOnKey(groupKey, () => {
    if (!group) {
      setIngresses([])
      setLoading(false)

      return
    }
    setForm({
      name: group.name,
      messageTemplate: group.messageTemplate,
    })
    setRevealSecrets({})
    setLoading(true)
  })
  useEffect(() => {
    if (!group) return
    let cancelled = false

    void Promise.all(
      group.partitions.map(async (partition): Promise<GroupIngressDetails> => {
        try {
          return {
            triggerId: partition.triggerId,
            trigger: await api.agentGetTrigger(partition.triggerId, group.teamId),
          }
        } catch (error) {
          return {
            triggerId: partition.triggerId,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    ).then((details) => {
      if (cancelled) return
      setIngresses(details)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [group])

  const copy = useCallback(async (kind: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard access can be unavailable outside a direct user gesture.
    }
  }, [])

  if (!group) {
    return (
      <div className="p-5">
        <div className="text-[12.5px] text-error">Watch group not found.</div>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-[12.5px] text-secondary hover:text-main underline"
        >
          Back to list
        </button>
      </div>
    )
  }

  const { allIngressesLoaded, allResourcesRecorded, groupActive, principalLabel, hasChanges } =
    deriveGroupOverview({ group, triggers, ingresses, loading, members, form })
  const canSave =
    form.name.trim().length > 0 &&
    form.messageTemplate.trim().length > 0 &&
    hasChanges &&
    canManage &&
    action === null
  const actionCtx = {
    group,
    form,
    canManage,
    canDelete,
    canSave,
    loading,
    allIngressesLoaded,
    allResourcesRecorded,
    groupActive,
    setForm,
    setAction,
    setConfirmDeleteOpen,
    onSaved,
    onDeleted,
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <ExecutionPrincipalBanner
          principalLabel={principalLabel}
          status={group.executionAuthorizationStatus}
          error={group.executionAuthorizationError}
          members={members}
          canTransfer={canDelete}
          onTransfer={async (userId) => {
            try {
              onSaved(
                await api.agentTransferTriggerGroupExecutionPrincipal(
                  group.id,
                  userId,
                  group.teamId,
                ),
              )
            } catch (err) {
              toast.apiError('Could not transfer this Watch group', err)
            }
          }}
        />
        <GroupFormFields group={group} form={form} canManage={canManage} setForm={setForm} />

        <GroupProviderSetup
          group={group}
          triggers={triggers}
          ingresses={ingresses}
          loading={loading}
          atlasApiUrl={atlasApiUrl}
          canManage={canManage}
          copied={copied}
          revealSecrets={revealSecrets}
          setRevealSecrets={setRevealSecrets}
          copy={copy}
        />

        <GroupTestFireButton
          canManage={canManage}
          action={action}
          allResourcesRecorded={allResourcesRecorded}
          groupActive={groupActive}
          onTest={() => void testTriggerGroup(actionCtx)}
        />
      </div>

      <GroupOverviewFooter
        canDelete={canDelete}
        canSave={canSave}
        action={action}
        onDelete={() => setConfirmDeleteOpen(true)}
        onCancel={onBack}
        onSave={() => void saveTriggerGroup(actionCtx)}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Remove Watch group?"
        description={`"${group.name}" and its ${String(group.partitionCount)} shared provider ingress${group.partitionCount === 1 ? '' : 'es'} will be removed. Nuphos will clean up every recorded provider resource and preserve unrelated notification destinations.`}
        confirmLabel="Remove group"
        destructive
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => deleteTriggerGroup(actionCtx)}
      />
    </div>
  )
}
