import { Plus } from 'lucide-react'

import { api } from '../api'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'

import { TriggerCalendar } from './triggers/calendar/TriggerCalendar'
import { PageViewSwitch } from './triggers/PageViewSwitch'
import { TriggerDetail } from './triggers/TriggerDetail'
import { TriggerForm } from './triggers/TriggerForm'
import { TriggerGroupOverview } from './triggers/TriggerGroupOverview'
import { TriggersListPage } from './triggers/TriggersListPage'
import { useTriggersPageView } from './triggers/useTriggersPageView'
import { useTriggersViewState } from './triggers/useTriggersViewState'

import type { TriggersPageView } from './triggers/useTriggersPageView'
import type { TriggerFormRef } from '../lib/appRoutes'

type Props = {
  teamId?: string
  currentUserId?: string
  /** The workspace toolbar's shared search box. */
  filter: string
  /** Bumped by the toolbar's refresh button; re-runs the listing. */
  refreshKey?: number
  /** Row count for the page header, as every other team tool page reports it. */
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  /**
   * Where the page is, held on the workspace tab rather than here so the
   * breadcrumb can name it and the toolbar can tell a list from a form. Which
   * is why no sub-view below draws a title bar or a back button of its own.
   */
  triggerDetail: { triggerId: string; triggerName: string } | null
  setTriggerDetail: (d: { triggerId: string; triggerName: string } | null) => void
  triggerForm: TriggerFormRef | null
  setTriggerForm: (f: TriggerFormRef | null) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
  /** Show this view instead of the viewer's last choice; applied again whenever it changes. */
  initialView?: TriggersPageView
}

export function TriggersView({
  teamId,
  currentUserId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  triggerDetail,
  setTriggerDetail,
  triggerForm,
  setTriggerForm,
  onOpenAgentChat,
  initialView,
}: Props) {
  const [pageView, changePageView] = useTriggersPageView(initialView)
  const {
    members,
    membersFailed,
    setMembersReloadKey,
    canManage,
    canDelete,
    atlasApiUrl,
    listState,
    setListState,
    cronEnabled,
    isActive,
    reload,
  } = useTriggersViewState({
    teamId,
    currentUserId,
    refreshKey,
    onLoading,
    inSubView: Boolean(triggerDetail) || Boolean(triggerForm),
    onCreate: () => setTriggerForm({ kind: 'create' }),
  })

  const triggers = listState.kind === 'ready' ? listState.triggers : []
  const onPage = !triggerForm && !triggerDetail
  const showCalendar = onPage && pageView === 'calendar' && listState.kind !== 'error' && teamId
  // Leaving a form returns to the trigger it belongs to when there is one, and
  // to the list otherwise — the same rule the breadcrumb's Triggers crumb uses.
  const closeForm = () => setTriggerForm(null)
  const newTriggerAction = {
    label: 'New trigger',
    icon: Plus,
    onClick: () => setTriggerForm({ kind: 'create' }),
  }

  const patchTrigger = async (triggerId: string, enabled: boolean) => {
    try {
      const updated = await api.agentUpdateTrigger(triggerId, { enabled }, teamId)

      setListState((prev) =>
        prev.kind === 'ready'
          ? {
              ...prev,
              triggers: prev.triggers.map((t) => (t.id === triggerId ? { ...t, ...updated } : t)),
            }
          : prev,
      )
    } catch (err) {
      toast.apiError('Could not update trigger', err, {
        fallback: 'Check your connection and try again.',
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {membersFailed && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
          <span>
            Could not load team roles, so managing Triggers is unavailable. This is a loading
            problem, not a permission one.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMembersReloadKey((key) => key + 1)}
          >
            Retry
          </Button>
        </div>
      )}

      <PageViewSwitch
        active={isActive && onPage && listState.kind === 'ready'}
        value={pageView}
        onChange={changePageView}
      />

      {showCalendar && (
        <TriggerCalendar
          teamId={teamId}
          triggers={triggers}
          loading={listState.kind === 'loading'}
          refreshKey={refreshKey}
          emptyAction={canManage ? newTriggerAction : undefined}
          onOpenTrigger={(triggerId, triggerName) => setTriggerDetail({ triggerId, triggerName })}
        />
      )}

      {onPage && !showCalendar && (
        <TriggersListPage
          state={listState}
          setState={setListState}
          teamId={teamId}
          members={members}
          canManage={canManage}
          canDelete={canDelete}
          filter={filter}
          isActive={isActive}
          onCount={onCount}
          onRetry={() => void reload()}
          onOpenTrigger={(triggerId, triggerName) => setTriggerDetail({ triggerId, triggerName })}
          onOpenGroup={(groupId, name) => setTriggerForm({ kind: 'group', groupId, name })}
          onEditTrigger={(triggerId, name) => setTriggerForm({ kind: 'edit', triggerId, name })}
          onCreate={() => setTriggerForm({ kind: 'create' })}
          onOpenAgentChat={onOpenAgentChat}
        />
      )}

      {!triggerForm && triggerDetail && teamId && (
        <TriggerDetail
          trigger={triggers.find((t) => t.id === triggerDetail.triggerId)}
          listStatus={listState.kind}
          teamId={teamId}
          canManage={canManage}
          isActive={isActive}
          filter={filter}
          onCount={onCount}
          onRetry={() => void reload()}
          onEdit={() =>
            setTriggerForm({
              kind: 'edit',
              triggerId: triggerDetail.triggerId,
              name: triggerDetail.triggerName,
              returnToDetail: true,
            })
          }
          onToggle={(enabled) => void patchTrigger(triggerDetail.triggerId, enabled)}
        />
      )}

      {triggerForm?.kind === 'group' && listState.kind === 'ready' && (
        <TriggerGroupOverview
          group={listState.groups.find((group) => group.id === triggerForm.groupId)}
          triggers={listState.triggers}
          atlasApiUrl={atlasApiUrl}
          canManage={canManage}
          canDelete={canDelete}
          members={members}
          onBack={closeForm}
          onSaved={(updatedGroup) => {
            setListState((previous) =>
              previous.kind === 'ready'
                ? {
                    kind: 'ready',
                    groups: previous.groups.map((group) =>
                      group.id === updatedGroup.id ? updatedGroup : group,
                    ),
                    triggers: previous.triggers.map((trigger) => {
                      if (trigger.watchGroupId !== updatedGroup.id) return trigger
                      const partition = updatedGroup.partitions.find(
                        (candidate) => candidate.triggerId === trigger.id,
                      )

                      return {
                        ...trigger,
                        name: partition
                          ? `${updatedGroup.name} · ${partition.provider}`
                          : trigger.name,
                        messageTemplate: updatedGroup.messageTemplate,
                      }
                    }),
                  }
                : previous,
            )
          }}
          onDeleted={() => {
            closeForm()
            void reload()
          }}
        />
      )}

      {triggerForm?.kind === 'create' && (
        <TriggerForm
          mode="create"
          teamId={teamId}
          canManage={canManage}
          canDelete={canDelete}
          members={members}
          atlasApiUrl={atlasApiUrl}
          cronEnabled={cronEnabled}
          onCancel={closeForm}
          onSaved={(trigger) => {
            setListState((prev) =>
              prev.kind === 'ready'
                ? { ...prev, triggers: [trigger, ...prev.triggers] }
                : { kind: 'ready', triggers: [trigger], groups: [] },
            )
            // A brand-new trigger has no runs, but its detail page is where
            // you go next — Run now lives there.
            setTriggerDetail({ triggerId: trigger.id, triggerName: trigger.name })
            closeForm()
          }}
          onDeleted={() => {}}
        />
      )}

      {triggerForm?.kind === 'edit' && (
        <TriggerForm
          mode="edit"
          triggerId={triggerForm.triggerId}
          teamId={teamId}
          canManage={canManage}
          canDelete={canDelete}
          members={members}
          atlasApiUrl={atlasApiUrl}
          cronEnabled={cronEnabled}
          onCancel={closeForm}
          onSaved={(trigger) => {
            setListState((prev) =>
              prev.kind === 'ready'
                ? {
                    ...prev,
                    triggers: prev.triggers.map((t) =>
                      t.id === trigger.id ? { ...t, ...trigger } : t,
                    ),
                  }
                : prev,
            )
            // A rename has to reach the breadcrumb, which is reading the name
            // that was captured when the form opened.
            if (triggerForm.returnToDetail) {
              setTriggerDetail({ triggerId: trigger.id, triggerName: trigger.name })
            }
            closeForm()
          }}
          onDeleted={(triggerId) => {
            setListState((prev) =>
              prev.kind === 'ready'
                ? { ...prev, triggers: prev.triggers.filter((t) => t.id !== triggerId) }
                : prev,
            )
            // Nothing left to name on the breadcrumb.
            if (triggerDetail?.triggerId === triggerId) setTriggerDetail(null)
            closeForm()
            void reload()
          }}
        />
      )}
    </div>
  )
}
