import clsx from 'clsx'
import { ChevronRight, Puzzle, Store, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSubmenu, MenuTrigger } from '../../components/ui/menu'
import { MenuSeparator, MenuSubmenuTrigger } from '../../components/ui/menu-extras'
import { toast } from '../../components/ui/toast'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

import { WEB_STORE_URL, addableExtensionId } from './webStore'

import type { BrowserExtensionItem } from '../../api/browser-extension-types'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'

function ExtensionIcon({ item, className }: { item: BrowserExtensionItem; className?: string }) {
  return item.icon ? (
    <img src={item.icon} alt="" className={clsx('object-contain', className)} draggable={false} />
  ) : (
    <Puzzle className={className} aria-hidden="true" />
  )
}

/**
 * The browser toolbar's extensions: an "Add to Nuphos" button on a Web Store
 * item page, a button per extension that opens its popup, and a menu to remove one. Shows
 * nothing for a tab outside the user's browser session (an agent's), which has no extensions.
 */
export function BrowserExtensions({
  tabId,
  url,
  active,
  buttonClass,
  viewRef,
}: {
  /** The Dock tab's web contents ID; null until its page attaches. */
  tabId: number | null
  url: string
  active: boolean
  buttonClass: string
  viewRef: RefObject<WebviewTag | null>
}) {
  const [items, setItems] = useState<BrowserExtensionItem[] | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(() => {
    if (tabId === null) return
    void api
      .browserExtensions(tabId)
      .then(setItems)
      .catch(() => setItems(null))
  }, [tabId])

  useEffect(() => {
    refresh()

    return api.onBrowserExtensionsChanged(refresh)
  }, [refresh])

  // Extensions act on the tab the user is looking at.
  useEffect(() => {
    if (active && tabId !== null && items) void api.browserExtensionSelectTab(tabId)
  }, [active, items, tabId])

  if (tabId === null || !items) return null
  // The store's own "Add to Chrome" can't work here, so offer ours beside the address.
  const addableId = addableExtensionId(url, items)

  const add = (id: string) => {
    setAdding(true)
    api
      .browserExtensionAdd(id)
      .catch((error: unknown) => toast.apiError(t('Could not add the extension'), error))
      .finally(() => setAdding(false))
  }
  const remove = (id: string) => {
    api
      .browserExtensionRemove(id)
      .catch((error: unknown) => toast.apiError(t('Could not remove the extension'), error))
  }

  return (
    <>
      {addableId && (
        <Button
          size="sm"
          className="ml-1 !h-7 shrink-0 gap-1.5 px-2 text-[12.5px]"
          disabled={adding}
          onClick={() => add(addableId)}
        >
          <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
          {adding ? t('Adding…') : t('Add to Nuphos')}
        </Button>
      )}
      {items
        .filter((item) => !item.error)
        .map((item) => (
          <Tooltip key={item.id} content={item.name} side="bottom">
            <button
              type="button"
              className={clsx(buttonClass, 'relative')}
              aria-label={item.name}
              onClick={(event) => {
                const { x, y, width, height } = event.currentTarget.getBoundingClientRect()

                void api.browserExtensionActivate(item.id, tabId, { x, y, width, height })
              }}
            >
              <ExtensionIcon item={item} className="h-4 w-4" />
              {item.badge && (
                <span
                  className="absolute -right-0.5 -top-0.5 min-w-3 rounded-sm px-0.5 text-[8px] font-semibold leading-3 text-white"
                  style={{ backgroundColor: item.badge.color ?? '#5f6368' }}
                >
                  {item.badge.text.slice(0, 4)}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              className={buttonClass}
              title={t('Extensions')}
              aria-label={t('Extensions')}
            >
              <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
        />
        <MenuContent align="end" className="w-[260px]">
          <MenuItem
            icon={<Store className="h-3.5 w-3.5" />}
            onClick={() => {
              if (viewRef.current) viewRef.current.src = WEB_STORE_URL
            }}
          >
            {t('Find extensions in the Chrome Web Store')}
          </MenuItem>
          {items.length > 0 && <MenuSeparator />}
          {items.map((item) => (
            <MenuSubmenu key={item.id}>
              <MenuSubmenuTrigger
                icon={<ExtensionIcon item={item} className="h-4 w-4" />}
                chevron={<ChevronRight className="h-3 w-3" />}
                title={item.error ?? undefined}
              >
                {item.error ? t('{name} (turned off)', { name: item.name }) : item.name}
              </MenuSubmenuTrigger>
              <MenuContent align="start" className="w-[200px]">
                <MenuItem
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  destructive
                  onClick={() => remove(item.id)}
                >
                  {t('Remove from Nuphos…')}
                </MenuItem>
              </MenuContent>
            </MenuSubmenu>
          ))}
        </MenuContent>
      </Menu>
    </>
  )
}
