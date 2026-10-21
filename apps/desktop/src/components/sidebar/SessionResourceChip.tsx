import { Terminal, X } from 'lucide-react'

import { ResourcePreview } from '../ui/resource-preview'

import { ResourceListMenu } from './ResourceListMenu'
import { chipNames, resourceLabel } from './sessionResourcePresentation'
import { menuChipClass, resourceStyle, titlebarChip } from './sessionResourceStyle'

import type { ResourceActions } from './ResourceListMenu'
import type { ResourceChip } from './sessionResourcePresentation'
import type { SessionResource } from '../../api/session-resource-types'
import type { PointerEvent } from 'react'

type ChipProps = {
  titlebar: boolean
  measure?: boolean
  canManage: boolean
  removing: boolean
  onUnlink: (resourceId: string) => void
  actions: ResourceActions
}

function stopTitlebarPointer(titlebar: boolean) {
  return (event: PointerEvent) => {
    if (titlebar) event.stopPropagation()
  }
}

/**
 * One chip in the row. Chips may shrink, but only the label truncates, so the
 * icon and the chip's edge always stay whole. `measure` renders the bare chip
 * for the invisible sizing copy, without previews or menus.
 */
export function SessionResourceChip({ chip, ...props }: ChipProps & { chip: ResourceChip }) {
  const { titlebar, measure, actions } = props

  if (chip.kind === 'resource') return <ResourceBadge resource={chip.resource} {...props} />

  if (chip.kind === 'terminals') {
    const content = (
      <>
        <Terminal className="size-3 shrink-0" />
        <span>×{chip.terminals.length}</span>
      </>
    )

    // Sidebar chips are part of the row, which opens the chat, so the group
    // only names its terminals there; the titlebar lists them to open one.
    return titlebar && !measure ? (
      <ResourceListMenu
        chips={[chip]}
        actions={actions}
        label={`${String(chip.terminals.length)} terminals`}
        className={`${menuChipClass(titlebar)} titlebar-no-drag`}
      >
        {content}
      </ResourceListMenu>
    ) : (
      <span className={menuChipClass(titlebar)} title={chipNames([chip]).join('\n')}>
        {content}
      </span>
    )
  }

  const { tabId, name } = chip.terminal
  const Label = titlebar ? 'button' : 'span'
  const noDrag = titlebar && !measure ? 'titlebar-no-drag' : ''

  return (
    <Label
      onPointerDown={stopTitlebarPointer(titlebar)}
      onClick={(event) => actions.openTerminal(tabId, event)}
      className={`inline-flex min-w-0 max-w-40 items-center gap-1 text-secondary ${titlebar ? titlebarChip : ''} ${noDrag}`}
      title={name}
    >
      <Terminal className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </Label>
  )
}

function ResourceBadge({
  resource,
  titlebar,
  measure,
  canManage,
  removing,
  onUnlink,
  actions,
}: ChipProps & { resource: SessionResource }) {
  const Label = titlebar ? 'button' : 'span'
  const github = resource.provider === 'github'
  const { icon, color } = resourceStyle(resource)
  const label = resourceLabel(resource)

  const unlinkButton =
    titlebar && canManage ? (
      <button
        type="button"
        aria-label={`Unlink ${label}`}
        title="Unlink resource"
        disabled={removing}
        className="inline-flex shrink-0 self-stretch items-center rounded-r px-1 transition-colors text-tertiary hover:bg-red-500/15 hover:text-red-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-current disabled:opacity-40"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onUnlink(resource.id)
        }}
      >
        <X className="size-3" />
        {github && <span>Unlink</span>}
      </button>
    ) : null

  const badge = (
    <span
      className={`inline-flex min-w-0 items-center ${titlebar ? 'session-resource-tag rounded border' : ''} ${titlebar && !measure ? 'titlebar-no-drag' : ''} ${color}`}
    >
      <Label
        onPointerDown={stopTitlebarPointer(titlebar)}
        onClick={(event) => actions.openResource(resource, event)}
        className={
          titlebar
            ? 'inline-flex min-w-0 max-w-24 items-center gap-1 rounded-l px-1.5 py-0.5 transition-colors hover:bg-[var(--sidebar-overlay-hover)] active:bg-[var(--sidebar-overlay-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-current'
            : 'inline-flex min-w-0 max-w-40 items-center gap-1'
        }
        title={github ? undefined : `${resource.title} · ${resource.state}`}
        aria-label={`${label} · ${resource.state}`}
      >
        <span className="inline-flex shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </Label>
      {!github && unlinkButton}
    </span>
  )

  return github && !measure ? (
    <ResourcePreview
      actionable={titlebar}
      actions={unlinkButton}
      repository={resource.repository ?? 'GitHub'}
      identifier={label}
      title={resource.title}
      state={resource.state}
    >
      {badge}
    </ResourcePreview>
  ) : (
    badge
  )
}
