import { Terminal, X } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'

import { resourceFullLabel, resourceLabel } from './sessionResourcePresentation'
import { resourceStyle } from './sessionResourceStyle'

import type { ResourceChip } from './sessionResourcePresentation'
import type { SessionResource } from '../../api/session-resource-types'
import type { MouseEvent, ReactNode } from 'react'

export type ResourceActions = {
  openResource: (resource: SessionResource, event: MouseEvent) => void
  openTerminal: (tabId: string, event: MouseEvent) => void
}

/**
 * A titlebar chip that lists resources in full: the "+N" overflow chip and the
 * grouped terminals chip. Items take the same action as the chips they stand
 * for; with `unlink`, a second group unlinks each resource.
 */
export function ResourceListMenu({
  chips,
  actions,
  unlink,
  label,
  className,
  children,
}: {
  chips: ResourceChip[]
  actions: ResourceActions
  unlink?: { removing: string[]; onUnlink: (resourceId: string) => void }
  label: string
  className: string
  children: ReactNode
}) {
  const resources = chips.flatMap((chip) => (chip.kind === 'resource' ? [chip.resource] : []))

  return (
    <Menu>
      <MenuTrigger
        aria-label={label}
        title={label}
        className={className}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </MenuTrigger>
      <MenuContent className="max-w-80">
        {resources.map((resource) => {
          const { icon, color } = resourceStyle(resource)

          return (
            <MenuItem
              key={resource.id}
              icon={<span className={`inline-flex ${color}`}>{icon}</span>}
              hint={resource.state}
              onClick={(event) => actions.openResource(resource, event)}
            >
              <span className="break-words">{resourceFullLabel(resource)}</span>
            </MenuItem>
          )
        })}
        {chips.flatMap((chip) => {
          if (chip.kind === 'resource') return []
          const terminals = chip.kind === 'terminal' ? [chip.terminal] : chip.terminals

          return terminals.map(({ tabId, name }) => (
            <MenuItem
              key={tabId}
              icon={<Terminal className="size-3.5" />}
              onClick={(event) => actions.openTerminal(tabId, event)}
            >
              <span className="break-words">{name}</span>
            </MenuItem>
          ))
        })}
        {unlink && resources.length > 0 && <MenuSeparator />}
        {unlink &&
          resources.map((resource) => (
            <MenuItem
              key={`unlink:${resource.id}`}
              icon={<X className="size-3.5" />}
              destructive
              disabled={unlink.removing.includes(resource.id)}
              onClick={(event) => {
                event.stopPropagation()
                unlink.onUnlink(resource.id)
              }}
            >
              Unlink {resourceLabel(resource)}
            </MenuItem>
          ))}
      </MenuContent>
    </Menu>
  )
}
