import { useEffect, useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { toast } from '../components/ui/toast'
import { connectedMessage, findDuplicateConnection } from '../lib/posthogConnections'
import { defaultPermissions, normalizePermissions } from '../lib/posthogPermissions'

import { DialogFooter, WaitingForBrowser } from './BindPosthogDialogParts'
import { FormStep } from './BindPosthogForm'
import { PosthogProjectChecklist } from './PosthogProjectChecklist'
import { usePosthogOAuth } from './usePosthogOAuth'
import { usePosthogScopeCatalog } from './usePosthogScopeCatalog'
import { useResetOnKey } from './useResetOnKey'

import type { PosthogDialogKind } from './BindPosthogForm'
import type { PosthogIntegration, PosthogPermissions, PosthogRegion } from '../types'

export type PosthogDialogMode = {
  kind: 'reconnect' | 'permissions'
  integration: Pick<PosthogIntegration, 'id' | 'label' | 'region' | 'permissions'>
}

type Props = {
  teamId: string
  mode?: PosthogDialogMode
  onClose: () => void
  /** Receives the bound (or updated) binding id so the caller can focus it. */
  onBound: (bindingId?: string) => void
}

const TITLES: Record<PosthogDialogKind, string> = {
  connect: 'Connect PostHog',
  reconnect: 'Reconnect PostHog',
  permissions: 'Edit PostHog permissions',
}

function useExistingIntegrations(teamId: string, enabled: boolean): PosthogIntegration[] {
  const [integrations, setIntegrations] = useState<PosthogIntegration[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    api
      .atlasListPosthogIntegrations(teamId)
      .then((rows) => {
        if (!cancelled) setIntegrations(rows)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [teamId, enabled])

  return integrations
}

export function BindPosthogDialog({ teamId, mode, onClose, onBound }: Props) {
  const [active, setActive] = useState<PosthogDialogMode | undefined>(mode)
  const kind: PosthogDialogKind = active?.kind ?? 'connect'
  const showMatrix = kind !== 'reconnect'
  const catalog = usePosthogScopeCatalog(teamId)
  const existing = useExistingIntegrations(teamId, !mode)
  const [label, setLabel] = useState('')
  const [region, setRegion] = useState<PosthogRegion>('us')
  const [permissions, setPermissions] = useState<PosthogPermissions | null>(null)
  const [saving, setSaving] = useState(false)
  const duplicate = kind === 'connect' ? findDuplicateConnection(existing, label, region) : null

  function finish(bindingId: string) {
    if (kind === 'connect') toast.success(connectedMessage(existing, bindingId, label.trim()))
    if (active?.kind === 'permissions') {
      toast.success(`Updated the permissions of ${active.integration.label}`)
    }
    onBound(bindingId)
  }

  const oauth = usePosthogOAuth({
    teamId,
    chooseProjects: kind !== 'permissions',
    onDone: finish,
  })
  const { phase, setPhase } = oauth

  useResetOnKey(`${catalog ? 'loaded' : 'loading'}|${kind}|${active?.integration.id ?? ''}`, () => {
    if (!catalog) return
    setPermissions(
      active?.kind === 'permissions'
        ? normalizePermissions(catalog, active.integration.permissions)
        : defaultPermissions(catalog),
    )
  })

  function start() {
    if (kind === 'connect' && !label.trim()) return toast.error('Label is required.')
    if (showMatrix && !permissions) return toast.error('Permissions are still loading.')
    void oauth.authorize({
      ...(active ? { integrationId: active.integration.id } : { label: label.trim(), region }),
      ...(showMatrix && permissions ? { permissions } : {}),
    })
  }

  async function saveProjects() {
    if (phase.kind !== 'projects') return
    if (phase.selectedIds.length === 0) return toast.error('Select at least one project.')
    setSaving(true)
    try {
      await api.atlasUpdatePosthogProjects(teamId, phase.bindingId, phase.selectedIds)
      finish(phase.bindingId)
    } catch (cause) {
      toast.apiError('Could not save PostHog projects', cause)
      setSaving(false)
    }
  }

  function cancelAction() {
    if (phase.kind === 'projects') finish(phase.bindingId)
    else if (phase.kind === 'waiting') oauth.cancel()
    else onClose()
  }

  return (
    <Modal open onClose={onClose} title={TITLES[kind]} width={560}>
      <div className="px-5 py-4 space-y-3 text-[13px] max-h-[70vh] overflow-y-auto">
        {phase.kind === 'form' && (
          <FormStep
            kind={kind}
            label={label}
            onLabelChange={setLabel}
            region={region}
            onRegionChange={setRegion}
            duplicate={duplicate}
            onEditDuplicate={(integration) => setActive({ kind: 'permissions', integration })}
            catalog={catalog}
            permissions={permissions}
            onPermissionsChange={setPermissions}
          />
        )}
        {phase.kind === 'waiting' && <WaitingForBrowser keepsGrant={kind !== 'connect'} />}
        {phase.kind === 'projects' && (
          <>
            <p className="text-secondary text-[12.5px] leading-relaxed">
              {kind === 'connect'
                ? `${connectedMessage(existing, phase.bindingId, 'PostHog')}.`
                : 'PostHog is connected.'}{' '}
              Choose the projects the agent may query.
            </p>
            <PosthogProjectChecklist
              projects={phase.available}
              selectedIds={phase.selectedIds}
              onChange={(selectedIds) => setPhase({ ...phase, selectedIds })}
              disabled={saving}
            />
          </>
        )}
      </div>
      <DialogFooter
        phaseKind={phase.kind}
        saving={saving}
        canStart={!showMatrix || permissions !== null}
        canSave={phase.kind === 'projects' && phase.selectedIds.length > 0}
        startLabel={kind === 'permissions' ? 'Request new permissions' : 'Connect with PostHog'}
        onCancel={cancelAction}
        onStart={start}
        onSave={() => void saveProjects()}
      />
    </Modal>
  )
}
