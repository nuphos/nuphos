import { Eye, EyeOff, Loader2, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

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
  const [before, after] = t(
    'Send the secret in the {header} header on every request. Works with any sender (Grafana, Linear, Vercel, curl) — no HMAC signing required.',
  ).split('{header}')

  return (
    <div className="rounded-lg border border-line-control bg-surface-canvas p-3 space-y-2.5">
      {webhookUrl && (
        <CopyableRow
          label={t('Webhook URL')}
          value={webhookUrl}
          copied={copied === 'url'}
          onCopy={() => void copy('url', webhookUrl)}
        />
      )}
      {canManage && loaded.webhookSecret && (
        <CopyableRow
          label={t('Webhook secret')}
          value={loaded.webhookSecret}
          hidden={!revealSecret}
          copied={copied === 'secret'}
          onCopy={() => void copy('secret', loaded.webhookSecret!)}
          rightAction={
            <button
              type="button"
              onClick={() => setRevealSecret((v) => !v)}
              aria-label={revealSecret ? t('Hide secret') : t('Reveal secret')}
              aria-pressed={revealSecret}
              className="w-6 h-6 rounded flex items-center justify-center text-tertiary hover:text-main"
              title={revealSecret ? t('Hide') : t('Reveal')}
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
        {before}
        <code className="text-[11px]">X-Webhook-Secret</code>
        {after}
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
        {t('Test fire')}
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
  onRemoveWithoutProviderCleanup,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  loaded: AgentTrigger | null
  canDelete: boolean
  canSave: boolean
  saving: boolean
  onDelete: () => void
  onRemoveWithoutProviderCleanup: () => Promise<void>
  onCancel: () => void
  onSubmit: () => void
}) {
  const [removeWithoutCleanupOpen, setRemoveWithoutCleanupOpen] = useState(false)

  return (
    <div className="px-5 py-3 border-t border-line-control flex items-center justify-between">
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
              ? t('Removing…')
              : loaded?.cleanupStatus === 'cleanup_failed'
                ? t('Retry cleanup')
                : t('Delete')}
          </Button>
        )}
        {mode === 'edit' && canDelete && integrationDisconnected(loaded) && (
          <Button
            type="button"
            onClick={() => setRemoveWithoutCleanupOpen(true)}
            variant="ghost"
            size="sm"
            className="text-error hover:text-error"
          >
            {t('Remove without provider cleanup')}
          </Button>
        )}
        <TriggerRemoveWithoutCleanupDialog
          open={removeWithoutCleanupOpen}
          loaded={loaded}
          onClose={() => setRemoveWithoutCleanupOpen(false)}
          onConfirm={onRemoveWithoutProviderCleanup}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onCancel} variant="secondary" size="sm">
          {t('Cancel')}
        </Button>
        <Button type="button" onClick={onSubmit} disabled={!canSave || saving} size="sm">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {mode === 'create' ? t('Create') : t('Save')}
        </Button>
      </div>
    </div>
  )
}

/** Cleanup failed only because the Watch's integration is no longer connected. */
function integrationDisconnected(trigger: AgentTrigger | null): boolean {
  return (
    trigger?.cleanupStatus === 'cleanup_failed' &&
    trigger.cleanupErrorCode === 'provider_integration_disconnected'
  )
}

function TriggerRemoveWithoutCleanupDialog({
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
  const name = loaded?.name ?? ''
  const resources = (loaded?.managedProviderResources?.resources ?? []).filter(
    (resource) => resource.cleanupAction !== 'preserve',
  )

  return (
    <ConfirmDialog
      open={open}
      title={t('Remove without provider cleanup')}
      description={
        <span className="block">
          <span className="block">
            {t(
              '“{name}” will be removed. Providers Nuphos can still reach are cleaned up as usual. Resources in a provider whose integration is disconnected stay there and must be deleted by hand.',
              { name },
            )}
          </span>
          <span className="mt-3 block">
            {resources.length > 0
              ? t(
                  'Nuphos recorded these resources. Older Watches may have more than this list shows.',
                )
              : t(
                  'Nuphos has no record of which resources this Watch created. Check the provider by hand.',
                )}
          </span>
          {resources.length > 0 && (
            <span className="mt-1.5 block space-y-1">
              {resources.map((resource) => (
                <span key={resource.id} className="block break-words">
                  {resource.kind} ·{' '}
                  {resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer" className="underline">
                      {resource.name}
                    </a>
                  ) : (
                    resource.name
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      }
      confirmLabel={t('Remove without provider cleanup')}
      destructive
      onClose={onClose}
      onConfirm={onConfirm}
    />
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
  const provider = loaded?.providerHint ?? loaded?.providerWiring?.provider

  return (
    <ConfirmDialog
      open={open}
      title={
        loaded?.requiresProviderCleanup || loaded?.cleanupStatus
          ? t('Remove Watch?')
          : t('Delete trigger?')
      }
      description={
        loaded?.managedProviderResources ? (
          <ProviderCleanupPreview
            triggerName={loaded.name}
            plan={loaded.managedProviderResources}
          />
        ) : loaded?.requiresProviderCleanup || loaded?.cleanupStatus ? (
          provider ? (
            t(
              '"{name}" will be disabled, detached from {provider}, and removed. Existing provider notification destinations will be preserved.',
              { name: loaded?.name ?? '', provider },
            )
          ) : (
            t(
              '"{name}" will be disabled, detached from its monitoring provider, and removed. Existing provider notification destinations will be preserved.',
              { name: loaded?.name ?? '' },
            )
          )
        ) : (
          t('"{name}" will be removed. This cannot be undone.', { name: loaded?.name ?? '' })
        )
      }
      confirmLabel={loaded?.cleanupStatus === 'cleanup_failed' ? t('Retry cleanup') : t('Delete')}
      destructive
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
}
