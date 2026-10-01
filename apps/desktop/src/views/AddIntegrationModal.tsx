import clsx from 'clsx'
import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api } from '../api'
import { CloudLogo } from '../components/CloudLogo'
import { DatabaseEngineGlyph } from '../components/DatabaseEngineIcon'
import { LinearMark } from '../components/LinearMark'
import { Modal } from '../components/Modal'
import { SearchBox } from '../components/Toolbar'
import { toast } from '../components/ui/toast'

import { CATALOG } from './addIntegrationCatalog'
import { useResetOnKey } from './useResetOnKey'

import type { AddIntegrationKey, CatalogCategory } from './addIntegrationCatalog'

// Re-exported so the many existing consumers keep importing the key union from
// here; the definition moved to addIntegrationCatalog with the catalog data.
export type { AddIntegrationKey } from './addIntegrationCatalog'

const CONNECTOR_CAPABILITIES_URL = 'https://docs.nuphos.ai/connectors/capabilities'

// CloudLogo covers every provider except Linear, which ships its own
// (deliberately monochrome) brand mark.
function ItemLogo({ k }: { k: AddIntegrationKey }) {
  if (k === 'linear') return <LinearMark size={20} />
  // Database engines aren't cloud providers, so they carry their own glyph.
  if (k === 'mongodb') return <DatabaseEngineGlyph engine="mongodb" className="h-5 w-5" />

  return <CloudLogo provider={k} size={20} />
}

// One catalog section with freely available connector cards.
function CatalogSection({
  cat,
  onPick,
}: {
  cat: CatalogCategory
  onPick: (key: AddIntegrationKey) => void
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-tertiary font-medium mb-2">
        {cat.title}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cat.items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onPick(item.key)}
            className={clsx(
              'text-left p-3 rounded-lg border border-zGray-800 bg-zGray-850 transition-colors flex items-start gap-3',
              'hover:border-zViolet-500/50 hover:bg-zGray-800',
            )}
          >
            <div className="w-8 h-8 rounded-md bg-zGray-900 flex items-center justify-center flex-shrink-0">
              <ItemLogo k={item.key} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-main font-medium truncate">{item.name}</div>
              <div className="text-[11.5px] text-tertiary leading-snug mt-0.5">
                {item.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function AddIntegrationModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (key: AddIntegrationKey) => void
}) {
  const [query, setQuery] = useState('')

  // This component stays mounted across opens (only `Modal`'s internals come
  // and go), so a stale filter would survive and the catalog would reopen
  // pre-narrowed to whatever was typed last time.
  useResetOnKey(String(open), () => setQuery(''))

  const visible = useMemo(() => {
    // Every word has to match, but in any order — so "google cloud" and
    // "cloud google" both land on GCP.
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

    if (terms.length === 0) return CATALOG

    return CATALOG.map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => terms.every((term) => item.haystack.includes(term))),
    })).filter((cat) => cat.items.length > 0)
  }, [query])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add connector"
      description={
        <>
          Connect a cloud, observability, networking, compliance, source-control, project, document,
          or messaging tool to this team.{' '}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm text-secondary underline decoration-zGray-700 underline-offset-2 transition-colors hover:text-main focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zViolet-500"
            onClick={() => {
              void api.appOpenExternal(CONNECTOR_CAPABILITIES_URL).catch((err: unknown) => {
                toast.apiError('Could not open connector capabilities', err)
              })
            }}
          >
            View capabilities
            <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </>
      }
      width={720}
      // The unfiltered catalog is taller than the cap anyway, so this pins the
      // panel at the height it already rests at — typing narrows the list
      // without the modal resizing under the cursor.
      fillHeight
    >
      {/* min-h-full so the no-matches state can center itself down the panel's
          full height rather than clinging to the top of all that empty space. */}
      <div className="flex min-h-full flex-col">
        {/* Sticky rather than pinned above the body: `Modal` has no slot between
            its header and the scroll area, and the filter should stay reachable
            while a long catalog scrolls under it. */}
        <div className="sticky top-0 z-10 border-b border-zGray-800 bg-zGray-900 px-5 py-3">
          <SearchBox
            filter={query}
            onFilterChange={setQuery}
            fill
            label="Filter connectors"
            autoFocus
          />
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-5 py-10 text-center text-[12.5px] text-tertiary">
            No connectors match “{query.trim()}”.
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5 selectable">
            {visible.map((cat) => (
              <CatalogSection key={cat.title} cat={cat} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
