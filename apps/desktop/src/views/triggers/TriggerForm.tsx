import { Loader2 } from 'lucide-react'

import { ManagedProviderResourcesSection } from './providerResources'
import { triggerPrincipalLabel } from './shared'
import { TriggerFormFields } from './TriggerFormFields'
import {
  TriggerDeleteDialog,
  TriggerFormFooter,
  TriggerTestFire,
  TriggerWebhookPanel,
} from './TriggerFormPanels'
import { useTriggerFormController } from './useTriggerFormController'

import type { AgentTrigger } from '../../api'
import type { TeamMember } from '../../types'

type FormProps = {
  mode: 'create' | 'edit'
  triggerId?: string
  teamId?: string
  canManage: boolean
  canDelete: boolean
  members: TeamMember[]
  atlasApiUrl?: string
  /** null while loading, true/false once known. Drives the cron warning banner. */
  cronEnabled: boolean | null
  onCancel: () => void
  onSaved: (trigger: AgentTrigger) => void
  onDeleted: (triggerId: string) => void
}

export function TriggerForm({
  mode,
  triggerId,
  teamId,
  canManage,
  canDelete,
  members,
  atlasApiUrl,
  cronEnabled,
  onCancel,
  onSaved,
  onDeleted,
}: FormProps) {
  const {
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
  } = useTriggerFormController({
    mode,
    triggerId,
    teamId,
    canManage,
    canDelete,
    atlasApiUrl,
    onSaved,
    onDeleted,
  })

  if (mode === 'edit' && !loaded && !loadError) {
    return (
      <div className="flex items-center justify-center py-12 text-tertiary">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }
  if (mode === 'edit' && loadError) {
    return (
      <div className="p-5">
        <div className="text-[12.5px] text-error">{loadError}</div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 text-[12.5px] text-secondary hover:text-main underline"
        >
          Back to list
        </button>
      </div>
    )
  }

  const hasChanges =
    mode === 'create' ||
    (loaded !== null &&
      (form.name.trim() !== loaded.name ||
        form.messageTemplate.trim() !== loaded.messageTemplate ||
        (loaded.triggerType === 'cron' &&
          form.cronExpression.trim() !== (loaded.cronExpression ?? ''))))
  const canSave =
    !loaded?.cleanupStatus &&
    form.name.trim().length > 0 &&
    form.messageTemplate.trim().length > 0 &&
    (form.triggerType === 'webhook' || form.cronExpression.trim().length > 0) &&
    canManage &&
    hasChanges
  const principalLabel = loaded ? triggerPrincipalLabel(members, loaded) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No title row: the breadcrumb names the form, and Cancel below is
          the way out. */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <TriggerFormFields
          mode={mode}
          loaded={loaded}
          setLoaded={setLoaded}
          form={form}
          setForm={setForm}
          canManage={canManage}
          canDelete={canDelete}
          cronEnabled={cronEnabled}
          members={members}
          principalLabel={principalLabel}
        />

        {/* Webhook-only: URL + secret + test fire.
            URL row depends on atlasApiUrl resolving (it builds the absolute
            public URL); the secret and header-name instructions do not, so
            keep the panel visible even when the URL isn't ready yet. */}
        {mode === 'edit' && loaded?.triggerType === 'webhook' && (
          <TriggerWebhookPanel
            loaded={loaded}
            webhookUrl={webhookUrl}
            canManage={canManage}
            revealSecret={revealSecret}
            setRevealSecret={setRevealSecret}
            copied={copied}
            copy={copy}
          />
        )}

        {mode === 'edit' && loaded?.managedProviderResources && (
          <ManagedProviderResourcesSection
            plan={loaded.managedProviderResources}
            copied={copied}
            onCopy={copy}
          />
        )}

        {mode === 'edit' && (
          <TriggerTestFire
            canManage={canManage}
            firing={firing}
            cleanupPending={Boolean(loaded?.cleanupStatus)}
            onTestFire={() => void testFire()}
          />
        )}
      </div>

      <TriggerFormFooter
        mode={mode}
        loaded={loaded}
        canDelete={canDelete}
        canSave={canSave}
        saving={saving}
        onDelete={() => setConfirmDeleteOpen(true)}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
      <TriggerDeleteDialog
        open={confirmDeleteOpen}
        loaded={loaded}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={confirmRemove}
      />
    </div>
  )
}
