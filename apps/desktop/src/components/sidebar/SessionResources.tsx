import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { useSessionTerminalProcesses } from '../../lib/sessionTerminalProcesses'
import { toast } from '../ui/toast'

import { ResourceListMenu } from './ResourceListMenu'
import { SessionResourceChip } from './SessionResourceChip'
import { chipNames, resourceChips } from './sessionResourcePresentation'
import { menuChipClass } from './sessionResourceStyle'
import { useFittingChips } from './useFittingChips'

import type { ResourceActions } from './ResourceListMenu'
import type { SessionResource } from '../../api/session-resource-types'

/** Resource links belong to their session, including sessions that are not open. */
export function SessionResources({
  resources,
  teamId,
  sessionId,
  titlebar = false,
  onOpen,
  onOpenTab,
}: {
  resources: SessionResource[]
  teamId: string
  sessionId: string
  titlebar?: boolean
  onOpen?: (url: string, external: boolean) => void
  onOpenTab?: (tabId: string) => void
}) {
  const processes = useSessionTerminalProcesses(sessionId)

  const [canManage, setCanManage] = useState(false)
  const [removed, setRemoved] = useState<string[]>([])
  const [removing, setRemoving] = useState<string[]>([])

  const chips = resourceChips(
    resources.filter((resource) => !removed.includes(resource.id)),
    processes,
  )
  const { rowRef, measureRef, shown, minimum, fresh } = useFittingChips(
    chips.map((chip) => chip.key),
    titlebar && canManage,
  )
  const hidden = chips.length - shown
  // Set by an unlink from the "+N" menu. If the row then fits, "+N" and its
  // menu unmount and take focus with them, so it moves to the last chip.
  const refocus = useRef(false)

  useLayoutEffect(() => {
    if (!refocus.current || removing.length || !fresh) return
    refocus.current = false
    if (hidden > 0 || (document.activeElement && document.activeElement !== document.body)) return
    const buttons = rowRef.current?.querySelectorAll<HTMLElement>(
      ':scope > :not([aria-hidden]) button',
    )

    buttons?.[buttons.length - 1]?.focus()
  })

  useEffect(() => {
    let disposed = false

    if (titlebar && resources.length) {
      void agentApi
        .agentGetSessionResources(sessionId, teamId)
        .then((result) => {
          if (!disposed) setCanManage(result.canManage)
        })
        .catch(() => {})
    }

    return () => {
      disposed = true
    }
  }, [sessionId, teamId, resources.length, titlebar])

  async function unlink(resourceId: string) {
    setRemoving((ids) => [...ids, resourceId])
    try {
      await agentApi.agentUnlinkSessionResource(sessionId, teamId, resourceId)
      setRemoved((ids) => [...ids, resourceId])
    } catch (error) {
      toast.apiError('Could not unlink resource', error)
    } finally {
      setRemoving((ids) => ids.filter((id) => id !== resourceId))
    }
  }

  // In the sidebar a chip opens nothing itself: the click reaches the row and
  // opens the chat. Lists that open things live in the titlebar only.
  const actions: ResourceActions = {
    openResource: (resource, event) => {
      if (!titlebar) return
      event.stopPropagation()
      const thread = resource.provider === 'slack' || resource.provider === 'discord'

      onOpen?.(resource.url, thread || event.metaKey)
    },
    openTerminal: (tabId, event) => {
      if (!titlebar) return
      event.stopPropagation()
      onOpenTab?.(tabId)
    },
  }

  if (!chips.length) return null
  const chipProps = {
    titlebar,
    canManage,
    onUnlink: (resourceId: string) => void unlink(resourceId),
    actions,
  }

  return (
    <div
      ref={rowRef}
      // In the titlebar the row only takes the room the title leaves, down to
      // its "+N" chip: chips fold away before the title truncates. The row
      // still moves the window; only the chips themselves opt out.
      style={titlebar ? { minWidth: minimum } : undefined}
      className={
        titlebar
          ? 't-session-heading relative flex flex-1 items-center gap-1 overflow-hidden text-[11px] text-tertiary'
          : 'relative flex min-w-0 items-center gap-2 overflow-hidden px-2 pb-2 pl-8 text-[11px] text-tertiary'
      }
      aria-label="Linked resources"
    >
      {chips.slice(0, shown).map((chip) => (
        <SessionResourceChip
          key={chip.key}
          chip={chip}
          removing={chip.kind === 'resource' && removing.includes(chip.resource.id)}
          {...chipProps}
        />
      ))}
      {hidden > 0 &&
        (titlebar ? (
          <ResourceListMenu
            chips={chips}
            actions={actions}
            unlink={
              canManage
                ? {
                    removing,
                    onUnlink: (resourceId) => {
                      refocus.current = true
                      chipProps.onUnlink(resourceId)
                    },
                  }
                : undefined
            }
            label={`${String(hidden)} more linked resources, show all`}
            className={`${menuChipClass(titlebar)} titlebar-no-drag`}
          >
            +{hidden}
          </ResourceListMenu>
        ) : (
          <span
            className={menuChipClass(titlebar)}
            title={chipNames(chips.slice(shown)).join('\n')}
          >
            +{hidden}
          </span>
        ))}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max"
      >
        {chips.map((chip) => (
          <SessionResourceChip key={chip.key} chip={chip} measure removing={false} {...chipProps} />
        ))}
        <span className={menuChipClass(titlebar)}>+{chips.length}</span>
      </div>
    </div>
  )
}
