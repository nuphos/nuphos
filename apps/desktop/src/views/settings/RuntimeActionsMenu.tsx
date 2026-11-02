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
  onRename: () => void
  onSignIn: () => void
  onToggleEnabled: () => void
  onRemove: () => void
}) {
  if (!canEdit) return null
  const enabled = instance.status === 'active'
  // Unknown authentication is not evidence that the agent cannot sign in.
  const canSignIn = enabled && (instance.kind === 'managed' || instance.kind === 'external')

  return (
    <Menu>
      <MenuTrigger
        aria-label={t('Manage {name}', { name: instance.label })}
        disabled={busy}
        className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
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
        <MenuItem onClick={onToggleEnabled}>
          {enabled ? t('Disable runtime') : t('Enable runtime')}
        </MenuItem>
        {/* A person's computer keeps its default agents; a Box can remove any of its agents. */}
        {(instance.kind !== 'local' || localRemovalId(instance)) && (
          // The Box deletes the agent's sign-in itself, so it has to be connected.
          <MenuItem
            destructive
            disabled={instance.local?.online === false}
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
