import { Eye, EyeOff, Loader2, Play, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'

import { CopyableRow } from './parts'
import { ProviderCleanupPreview } from './providerResources'

import type { AgentTrigger } from '../../api'

export function TriggerWebhookPanel({
  loaded,
  webhookUrl,
  canManage,
  revealSecret,
  setRevealSecret,
  copied,
  copy,
}: {
  loaded: AgentTrigger
  webhookUrl: string | null
  canManage: boolean
  revealSecret: boolean
  setRevealSecret: React.Dispatch<React.SetStateAction<boolean>>
  copied: string | null
  copy: (kind: string, value: string) => Promise<void>
}) {
  return (
    <div className="rounded-lg border border-zGray-800 bg-zGray-950 p-3 space-y-2.5">
      {webhookUrl && (
        <CopyableRow
          label="Webhook URL"
          value={webhookUrl}
          copied={copied === 'url'}
          onCopy={() => void copy('url', webhookUrl)}
        />
      )}
      {canManage && loaded.webhookSecret && (
        <CopyableRow
          label="Webhook secret"
          value={loaded.webhookSecret}
          hidden={!revealSecret}
          copied={copied === 'secret'}
          onCopy={() => void copy('secret', loaded.webhookSecret!)}
          rightAction={
            <button
              type="button"
              onClick={() => setRevealSecret((v) => !v)}
              aria-label={revealSecret ? 'Hide secret' : 'Reveal secret'}
              aria-pressed={revealSecret}
              className="w-6 h-6 rounded flex items-center justify-center text-tertiary hover:text-main"
              title={revealSecret ? 'Hide' : 'Reveal'}
            >
              {revealSecret ? (
                <EyeOff className="w-3.5 h-3.5" strokeWidth={1.8} />
              ) : (
                <Eye className="w-3.5 h-3.5" strokeWidth={1.8} />
              )}
            </button>
          }
        />
      )}
      <p className="text-[11.5px] text-tertiary leading-snug">
        Send the secret in the <code className="text-[11px]">X-Webhook-Secret</code> header on every
        request. Works with any sender (Grafana, Linear, Vercel, curl) — no HMAC signing required.
      </p>
    </div>
  )
}

export function TriggerTestFire({
  canManage,
  firing,
  cleanupPending,
  onTestFire,
}: {
  canManage: boolean
  firing: boolean
  cleanupPending: boolean
  onTestFire: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onTestFire}
        disabled={!canManage || firing || cleanupPending}
        variant="secondary"
        size="sm"
      >
        {firing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5" strokeWidth={1.8} />
        )}
        Test fire
      </Button>
    </div>
  )
}

export function TriggerFormFooter({
  mode,
  loaded,
  canDelete,
  canSave,
  saving,
  onDelete,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  loaded: AgentTrigger | null
  canDelete: boolean
  canSave: boolean
  saving: boolean
  onDelete: () => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <div className="px-5 py-3 border-t border-zGray-800 flex items-center justify-between">
      <div>
        {mode === 'edit' && canDelete && (
          <Button
            type="button"
            onClick={onDelete}
            disabled={loaded?.cleanupStatus === 'deleting'}
            variant="ghost"
            size="sm"
            className="text-error hover:text-error"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
            {loaded?.cleanupStatus === 'deleting'
              ? 'Removing…'
              : loaded?.cleanupStatus === 'cleanup_failed'
                ? 'Retry cleanup'
                : 'Delete'}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onCancel} variant="secondary" size="sm">
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={!canSave || saving} size="sm">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {mode === 'create' ? 'Create' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export function TriggerDeleteDialog({
  open,
  loaded,
  onClose,
  onConfirm,
}: {
  open: boolean
  loaded: AgentTrigger | null
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <ConfirmDialog
      open={open}
      title={
        loaded?.requiresProviderCleanup || loaded?.cleanupStatus
          ? 'Remove Watch?'
          : 'Delete trigger?'
      }
      description={
        loaded?.managedProviderResources ? (
          <ProviderCleanupPreview
            triggerName={loaded.name}
            plan={loaded.managedProviderResources}
          />
        ) : loaded?.requiresProviderCleanup || loaded?.cleanupStatus ? (
          `"${loaded?.name ?? ''}" will be disabled, detached from ${loaded?.providerHint ?? loaded?.providerWiring?.provider ?? 'its monitoring provider'}, and removed. Existing provider notification destinations will be preserved.`
        ) : (
          `"${loaded?.name ?? ''}" will be removed. This cannot be undone.`
        )
      }
      confirmLabel={loaded?.cleanupStatus === 'cleanup_failed' ? 'Retry cleanup' : 'Delete'}
      destructive
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
}
