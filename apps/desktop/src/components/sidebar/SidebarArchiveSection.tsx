import { Popover } from '@base-ui/react/popover'
import { Archive, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { onChatArchived, onChatUnarchived } from '../../lib/chatArchiveEvents'
import { useArchivedChats } from '../../views/archived-chats/useArchivedChats'
import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'

import { SidebarSectionList } from './sections-list'

import type { ComponentProps, RefObject } from 'react'

type Props = {
  listProps: Omit<ComponentProps<typeof SidebarSectionList>, 'sections'>
  /** The footer row the open list spans, above the button. */
  row: RefObject<HTMLElement | null>
}

/** Share the first archive page between availability and the expanded list. */
export function SidebarArchiveSection({ listProps, row }: Props) {
  const teamId = listProps.scope.teamId
  const archive = useArchivedChats({ teamId, filter: '' })
  const { reload } = archive

  // This window's own archives decide whether the button shows at all.
  useEffect(() => {
    const offArchived = onChatArchived((change) => {
      if (change.teamId === teamId) reload()
    })
    const offUnarchived = onChatUnarchived(reload)

    return () => {
      offArchived()
      offUnarchived()
    }
  }, [teamId, reload])

  if (archive.items.length === 0 && !archive.failed) return null

  return <ArchivePopover listProps={listProps} row={row} archive={archive} />
}

type ArchiveProps = Props & { archive: ReturnType<typeof useArchivedChats> }

function ArchivePopover({ listProps, row, archive }: ArchiveProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const observeHeight = useCallback((element: HTMLDivElement | null) => {
    const page = anchor.current?.closest<HTMLElement>('[data-mode-pages]')

    if (!element || !page) return
    const update = () =>
      page.style.setProperty(
        '--sidebar-archive-height',
        `${String(element.getBoundingClientRect().height)}px`,
      )
    const observer = new ResizeObserver(update)

    observer.observe(element)
    update()

    return () => observer.disconnect()
  }, [])
  const [open, setOpen] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)

  return (
    <div
      ref={anchor}
      data-archive-expanded={open || panelVisible ? 'true' : undefined}
      className="flex items-center"
    >
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) return
          setPanelVisible(true)
          // Agents, auto-archive and other devices archive too: read the list afresh.
          archive.reload()
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setPanelVisible(false)
        }}
      >
        <Popover.Trigger
          render={
            <IconButton
              label={t('Archived')}
              icon={<Archive strokeWidth={1.8} />}
              className="w-8 data-[popup-open]:bg-state-hover data-[popup-open]:text-primary"
            />
          }
        />
        <Popover.Portal>
          <Popover.Positioner
            side="top"
            align="start"
            anchor={row}
            collisionPadding={0}
            className="z-[1000]"
          >
            <Popover.Popup
              ref={observeHeight}
              className="sidebar-archive-overlay flex max-h-[var(--available-height)] w-[var(--anchor-width)] flex-col px-2.5 outline-none"
            >
              <Popover.Close
                aria-expanded={open}
                className="flex h-7 w-full shrink-0 items-center gap-1.5 px-2 text-[13px] font-medium text-tertiary hover:text-secondary"
              >
                <Popover.Title render={<span />}>{t('Archived')}</Popover.Title>
                <ChevronDown className="size-3" />
              </Popover.Close>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 scrollbar-thin">
                <ArchiveItems
                  archive={archive}
                  listProps={{
                    ...listProps,
                    onSelect: (key) => {
                      setOpen(false)
                      listProps.onSelect(key)
                    },
                  }}
                />
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {/* Archived is not a page: it stays first, and the tabs drag only past this line. */}
      <span aria-hidden className="mx-1.5 h-4 w-px bg-state-selected" />
    </div>
  )
}

function ArchiveItems({ listProps, archive }: Omit<ArchiveProps, 'row'>) {
  return (
    <>
      <SidebarSectionList
        {...listProps}
        sections={[
          {
            compact: true,
            // A reload keeps the rows it has until the new page arrives.
            loading: archive.loading && archive.items.length === 0,
            items: archive.items.map((chat) => ({
              key: `agent-session:${chat.sessionId}`,
              label: chat.title || chat.firstMessage || t('Untitled task'),
              enabled: true,
              task: true,
              readOnlyChat: true,
            })),
          },
        ]}
      />
      {archive.failed && (
        <Button variant="ghost" size="sm" onClick={archive.reload}>
          {t('Retry')}
        </Button>
      )}
      {archive.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          disabled={archive.loadingMore}
          onClick={() => void archive.loadMore()}
        >
          {t('Load more')}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => listProps.onSelect('team.archived-chats')}>
        {t('View all')}
      </Button>
    </>
  )
}
