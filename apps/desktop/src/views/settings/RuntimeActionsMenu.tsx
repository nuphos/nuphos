import { Ellipsis } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'

import { localRemovalId } from './agentPresentation'

import type { RuntimeInstance } from '../../types/runtime'

export function RuntimeActionsMenu({
  instance,
  busy,
  canEdit,
  authenticated,
  localSignIn,
  onRename,
  onSignIn,
  onToggleEnabled,
  onRemove,
}: {
  instance: RuntimeInstance
  busy: boolean
  canEdit: boolean
  /** What the runtime reported about its own account, if it can say. */
  authenticated?: boolean
  /** One of the viewer's own computers' agents that is signed out, so it signs in from here too. */
  localSignIn?: boolean
  onRename: () => void
  onSignIn: () => void
  onToggleEnabled: () => void
  onRemove: () => void
}) {
  if (!canEdit) return null
  const enabled = instance.status === 'active'
  // Unknown authentication is not evidence that the agent cannot sign in.
  const canSignIn =
    enabled && (instance.kind === 'managed' || instance.kind === 'external' || localSignIn === true)

  return (
    <Menu>
      <MenuTrigger
        aria-label={t('Manage {name}', { name: instance.label })}
        disabled={busy}
        className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-state-hover hover:text-main"
      >
        <Ellipsis className="h-4 w-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onClick={onRename}>{t('Rename')}</MenuItem>
        {canSignIn && (
          <MenuItem onClick={onSignIn}>
            {authenticated ? t('Sign in again') : t('Sign in')}
          </MenuItem>
        )}
        <MenuSeparator />
        {/* A computer's agents have no disabled state: they are added or removed. */}
        {instance.kind !== 'local' && (
          <MenuItem onClick={onToggleEnabled}>
            {enabled ? t('Disable runtime') : t('Enable runtime')}
          </MenuItem>
        )}
        {/* A Box can remove any of its agents, and an offline computer deletes one when it is
            back; a person's own default agent is only forgotten. */}
        {(instance.kind !== 'local' || localRemovalId(instance)) && (
          <MenuItem
            destructive
            hint={instance.local?.online === false ? t('Offline') : undefined}
            onClick={onRemove}
          >
            {t('Remove runtime')}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
