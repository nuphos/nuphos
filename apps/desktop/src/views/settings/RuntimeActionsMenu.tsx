import { Ellipsis } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'

import type { RuntimeInstance } from '../../types/runtime'

export function RuntimeActionsMenu({
  instance,
  busy,
  canEdit,
  authenticated,
  onEdit,
  onSignIn,
  onToggleEnabled,
  onRemove,
}: {
  instance: RuntimeInstance
  busy: boolean
  canEdit: boolean
  /** What the runtime reported about its own account, if it can say. */
  authenticated?: boolean
  onEdit: () => void
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
        aria-label={`Manage ${instance.label}`}
        disabled={busy}
        className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
      >
        <Ellipsis className="h-4 w-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onClick={onEdit}>Edit agent</MenuItem>
        {canSignIn && (
          <MenuItem onClick={onSignIn}>{authenticated ? 'Sign in again' : 'Sign in'}</MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={onToggleEnabled}>{enabled ? 'Disable agent' : 'Enable agent'}</MenuItem>
        <MenuItem destructive onClick={onRemove}>
          Remove agent
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
