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

import type { AddIntegrationKey, CatalogItem } from '../addIntegrationCatalog'

/** Offered first when nothing is typed: the connectors most teams add early on. */
const POPULAR: AddIntegrationKey[] = [
  'github',
  'aws',
  'gcp',
  'linear',
  'slack',
  'grafana',
  'sentry',
  'notion',
  'cloudflare',
  'jira',
]
const MAX_SUGGESTIONS = 8

/** Typed text matches the whole catalog; an empty box suggests what is not added yet. */
function suggestionsFor(query: string, installed: ReadonlySet<string>): CatalogItem[] {
  const items = CATALOG.flatMap((category) => category.items)
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  if (terms.length > 0) {
    return items
      .filter((item) => terms.every((term) => item.haystack.includes(term)))
      .slice(0, MAX_SUGGESTIONS)
  }
  const rank = (item: CatalogItem) => {
    const index = POPULAR.indexOf(item.key)

    return index === -1 ? POPULAR.length : index
  }

  return items
    .filter((item) => !installed.has(item.key))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_SUGGESTIONS)
}

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
  const items = useMemo(() => suggestionsFor(filter, installed), [filter, installed])

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
