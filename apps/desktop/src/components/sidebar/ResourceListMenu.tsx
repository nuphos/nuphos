import { ExternalLink, GitMerge, Terminal, X } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../i18n'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu'

import { ResourceMark } from './ResourceMark'
import {
  finishedBreakdown,
  finishedLabel,
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

/** The preview card's footer buttons, as menu items. */
const ROW_ACTION =
  '!min-h-0 !gap-1 rounded !px-1.5 !py-0.5 !text-[11px] !text-tertiary [&>span:first-child]:!h-3 [&>span:first-child]:!w-3 [&>span:first-child]:!text-current'

/**
 * A row reads like the resource's preview card: where it lives and its number
 * over the title. Linear titles start with their identifier, which the first
 * line already shows.
 */
function resourceRow(resource: SessionResource) {
  const label = resourceLabel(resource)

  if (resource.provider === 'github')
    return { place: resource.repository ?? 'GitHub', label, title: resource.title }
  if (resource.provider === 'linear')
    return { place: 'Linear', label, title: resource.title.slice(label.length).trim() || label }

  return {
    place: resource.provider === 'slack' ? 'Slack' : 'Discord',
    label: undefined,
    title: resource.title,
  }
}

/**
 * A titlebar chip that lists resources in full: the "+N" overflow chip and the
 * grouped terminals chip. Items take the same action as the chips they stand
 * for, so the merged badge is one row that opens the Changes list; with
 * `unlink`, each resource row ends in its own unlink item.
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
      <MenuContent
        className={resources.length ? 'w-80 max-w-[calc(100vw-24px)]' : 'max-w-80'}
        finalFocus={finalFocus}
      >
        {resources.map((resource) => {
          const { icon, color } = resourceStyle(resource)
          const { place, label: identifier, title } = resourceRow(resource)

          // Each row is the resource's preview card in miniature: its details,
          // then the same open and unlink actions along the bottom.
          return (
            <div
              key={resource.id}
              className="border-t border-zGray-800/60 px-2.5 py-2 first:border-t-0"
            >
              <div className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-tertiary">
                <span className={`inline-flex shrink-0 ${color}`}>{icon}</span>
                <span className="min-w-0 truncate">{place}</span>
                {identifier && <span className="shrink-0 tabular-nums">{identifier}</span>}
                <ResourceMark resource={resource} />
                <span className="shrink-0 text-secondary">{resourceStatus(resource)}</span>
              </div>
              <div className="mt-1 line-clamp-2 break-words text-[13px] font-medium leading-snug text-main">
                {title}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <MenuItem
                  className={`${ROW_ACTION} -ml-1.5 data-[highlighted]:!text-main`}
                  icon={<ExternalLink className="size-3" />}
                  onClick={(event) => actions.openResource(resource, event)}
                >
                  {t('Open in browser tab')}
                </MenuItem>
                {unlink && (
                  <MenuItem
                    className={`${ROW_ACTION} -mr-1.5 data-[highlighted]:!bg-error/10 data-[highlighted]:!text-error`}
                    icon={<X className="size-3" />}
                    title={t('Unlink {label}', { label: resourceLabel(resource) })}
                    disabled={unlink.removing.includes(resource.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      unlink.onUnlink(resource.id)
                    }}
                  >
                    {t('Unlink')}
                  </MenuItem>
                )}
              </div>
            </div>
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
      </MenuContent>
    </Menu>
  )
}
