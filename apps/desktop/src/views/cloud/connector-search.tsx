import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '../../components/ui/combobox'
import { CATALOG } from '../addIntegrationCatalog'

import { CatalogLogo } from './catalog-logo'
import { connectorSuggestions } from './connector-suggestions'

import type { CatalogItem } from '../addIntegrationCatalog'

/**
 * The Connectors search field. It still filters the page as you type, and while focused it also
 * offers matching connectors: arrows move, Enter opens the detail or setup view, Esc closes.
 */
export function ConnectorSearch({
  filter,
  onFilterChange,
  installed,
  onPick,
}: {
  filter: string
  onFilterChange: (filter: string) => void
  installed: ReadonlySet<string>
  onPick: (item: CatalogItem) => void
}) {
  const [open, setOpen] = useState(false)
  const items = useMemo(() => connectorSuggestions(CATALOG, filter, installed), [filter, installed])

  return (
    <Combobox<CatalogItem>
      items={items}
      filter={null}
      value={null}
      open={open}
      onOpenChange={setOpen}
      inputValue={filter}
      onInputValueChange={(value, details) => {
        // Picking an item would write its name into the box; only typing changes the filter.
        if (details.reason === 'input-change' || details.reason === 'input-clear') {
          onFilterChange(value)
        }
      }}
      onValueChange={(item) => {
        if (!item) return
        setOpen(false)
        onPick(item)
      }}
      itemToStringLabel={(item) => item.name}
      autoHighlight
    >
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tertiary"
          strokeWidth={2}
        />
        <ComboboxInput
          aria-label="Search connectors"
          placeholder="Search connectors"
          showTrigger={false}
          onFocus={() => setOpen(true)}
          className="h-8 rounded-lg border-zGray-800/55 bg-transparent"
          inputClassName="pl-8 text-[12.5px]"
        />
      </div>
      <ComboboxContent className="p-1">
        <ComboboxEmpty className="empty:hidden">No connectors match.</ComboboxEmpty>
        <ComboboxList>
          {(item: CatalogItem) => (
            <ComboboxItem key={item.key} value={item} className="rounded-md">
              <span className="flex min-w-0 items-center gap-2">
                <CatalogLogo provider={item.key} size={16} />
                <span className="truncate">{item.name}</span>
                <span className="ml-auto flex-none pl-3 text-[11.5px] text-tertiary">
                  {installed.has(item.key) ? 'Connected' : 'Add'}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
