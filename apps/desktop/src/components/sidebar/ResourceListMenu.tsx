import { GitMerge, Terminal, X } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../i18n'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'

import { ResourceMark } from './ResourceMark'
import {
  finishedBreakdown,
  finishedLabel,
  resourceFullLabel,
  resourceLabel,
  resourceStatus,
} from './sessionResourcePresentation'
import { resourceStyle } from './sessionResourceStyle'

import type { ResourceChip } from './sessionResourcePresentation'
import type { SessionResource } from '../../api/session-resource-types'
import type { MouseEvent, ReactNode } from 'react'

export type ResourceActions = {
  openResource: (resource: SessionResource, event: MouseEvent) => void
  openTerminal: (tabId: string, event: MouseEvent) => void
  /** The merged badge: opens the summary panel's Changes list on these items' filter. */
  openChanges: (resources: SessionResource[], event: MouseEvent) => void
}

/**
 * A titlebar chip that lists resources in full: the "+N" overflow chip and the
 * grouped terminals chip. Items take the same action as the chips they stand
 * for, so the merged badge is one row that opens the Changes list; with
 * `unlink`, a second group unlinks each resource the row shows on its own.
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
  const finished = chips.filter((chip) => chip.kind === 'finished')
  // The merged badge's row hands focus to the Changes list; closing the menu
  // must not pull it back to the trigger.
  const openedChanges = useRef(false)
  const finalFocus = () => {
    const keep = !openedChanges.current

    openedChanges.current = false

    return keep
  }

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
      <MenuContent className="max-w-80" finalFocus={finalFocus}>
        {resources.map((resource) => {
          const { icon, color } = resourceStyle(resource)

          return (
            <MenuItem
              key={resource.id}
              icon={<span className={`inline-flex ${color}`}>{icon}</span>}
              hint={resourceStatus(resource)}
              onClick={(event) => actions.openResource(resource, event)}
            >
              <span className="break-words">{resourceFullLabel(resource)}</span>{' '}
              <ResourceMark resource={resource} />
            </MenuItem>
          )
        })}
        {finished.map((chip) => (
          <MenuItem
            key={chip.key}
            icon={<GitMerge className="size-3.5 session-resource-merged" />}
            hint={finishedBreakdown(chip.resources)}
            onClick={(event) => {
              openedChanges.current = true
              actions.openChanges(chip.resources, event)
            }}
          >
            {finishedLabel(chip.resources)}
          </MenuItem>
        ))}
        {chips.flatMap((chip) => {
          if (chip.kind === 'resource' || chip.kind === 'finished') return []
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
              {t('Unlink {label}', { label: resourceLabel(resource) })}
            </MenuItem>
          ))}
      </MenuContent>
    </Menu>
  )
}
