import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CloudLogo } from '../../components/CloudLogo'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '../../components/ui/combobox'
import { t } from '../../i18n'
import { CATALOG } from '../addIntegrationCatalog'
import { nameOf } from '../settings/personalCredentials'

import { CatalogLogo } from './catalog-logo'
import { connectorSuggestions, searchTerms } from './connector-suggestions'

import type { CatalogItem } from '../addIntegrationCatalog'
import type { PersonalConnector } from '../settings/personalCredentials'

type Suggestion =
  | { kind: 'team'; key: string; name: string; item: CatalogItem }
  | { kind: 'personal'; key: string; name: string; item: PersonalConnector }

function statusOf(suggestion: Suggestion, installed: ReadonlySet<string>) {
  // The subtitle already names it as personal.
  if (suggestion.kind === 'personal') return null

  return installed.has(suggestion.item.key) ? t('Connected') : t('Add')
}

/**
 * The Connectors search field. It still filters the page as you type, and while focused it also
 * offers matching connectors: arrows move, Enter opens the detail or setup view, Esc closes.
 */
export function ConnectorSearch({
  filter,
  onFilterChange,
  installed,
  personal,
  onPick,
  onPickPersonal,
}: {
  filter: string
  onFilterChange: (filter: string) => void
  installed: ReadonlySet<string>
  /** The member's own accounts matching the search; listed after the team's while typing. */
  personal: PersonalConnector[]
  onPick: (item: CatalogItem) => void
  onPickPersonal: () => void
}) {
  const [open, setOpen] = useState(false)
  const items = useMemo<Suggestion[]>(
    () => [
      ...connectorSuggestions(CATALOG, filter, installed).map((item) => ({
        kind: 'team' as const,
        key: item.key,
        name: item.name,
        item,
      })),
      ...(searchTerms(filter).length > 0 ? personal : []).map((item) => ({
        kind: 'personal' as const,
        key: `personal-${item.provider}`,
        name: nameOf(item.provider),
        item,
      })),
    ],
    [filter, installed, personal],
  )

  return (
    <Combobox<Suggestion>
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
      onValueChange={(suggestion) => {
        if (!suggestion) return
        setOpen(false)
        if (suggestion.kind === 'personal') onPickPersonal()
        else onPick(suggestion.item)
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
          aria-label={t('Search connectors')}
          placeholder={t('Search connectors')}
          showTrigger={false}
          onFocus={() => setOpen(true)}
          className="h-8 rounded-lg border-line-control/55 bg-transparent"
          inputClassName="pl-8 text-[12.5px]"
        />
      </div>
      <ComboboxContent className="p-1">
        <ComboboxEmpty className="empty:hidden">{t('No connectors match.')}</ComboboxEmpty>
        <ComboboxList>
          {(suggestion: Suggestion) => (
            <ComboboxItem key={suggestion.key} value={suggestion} className="rounded-md">
              <span className="flex min-w-0 items-center gap-2">
                {suggestion.kind === 'personal' ? (
                  <CloudLogo provider={suggestion.item.provider} size={16} />
                ) : (
                  <CatalogLogo provider={suggestion.item.key} size={16} />
                )}
                {/* The subtitle tells a team connector from a personal account of the same name. */}
                <span className="min-w-0">
                  <span className="block truncate">{suggestion.name}</span>
                  <span className="block truncate text-[11.5px] text-tertiary">
                    {suggestion.kind === 'personal'
                      ? t('Your personal account')
                      : t('Team connector')}
                  </span>
                </span>
                <span className="ml-auto flex-none pl-3 text-[11.5px] text-tertiary">
                  {statusOf(suggestion, installed)}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
