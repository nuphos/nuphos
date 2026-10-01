import clsx from 'clsx'
import { RefreshCw, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from './ui/combobox'

// Cap how many namespace rows render at once. A cluster can have thousands of
// namespaces; mounting them all freezes the main thread on open. Render at most
// this many and let type-to-filter reach the rest — instant and never janky.
const NS_RENDER_CAP = 200

export function NamespaceCombobox({
  namespaces,
  loading,
  truncated,
  total,
  onOpen,
  selectedNamespace,
  onSelectNamespace,
}: {
  namespaces: string[]
  loading?: boolean
  truncated?: boolean
  total?: number | null
  onOpen?: () => void
  selectedNamespace: string
  onSelectNamespace?: (ns: string) => void
}) {
  // We cap the rendered rows to avoid freezing on huge clusters. We only
  // *listen* to the input (to drive the filter/cap) and leave the input's
  // display to Base UI — controlling `inputValue` ourselves clobbers what the
  // user types and breaks search. `filter={null}` because we pre-filter.
  const [query, setQuery] = useState('')

  // The real namespaces matching the query (no synthetic rows).
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? namespaces.filter((ns) => ns.toLowerCase().includes(q)) : namespaces
  }, [namespaces, query])

  // Combobox items: prepend the "All namespaces" ('') row only when not
  // actively searching.
  const filtered = useMemo(() => (query.trim() ? matches : ['', ...matches]), [matches, query])

  // Only render the first NS_RENDER_CAP matches; the rest are reachable by
  // typing. This is what keeps a 1000+ namespace cluster from freezing.
  const visible = useMemo(() => {
    const sliced = filtered.slice(0, NS_RENDER_CAP)

    // Pin the active selection so Base UI highlights it on open even when it
    // falls outside the first NS_RENDER_CAP alphabetical entries — otherwise
    // autoHighlight lands on the first row and a keyboard user could confirm
    // the wrong namespace on a 200+ cluster.
    if (
      selectedNamespace &&
      matches.includes(selectedNamespace) &&
      !sliced.includes(selectedNamespace)
    ) {
      return [...sliced, selectedNamespace]
    }

    return sliced
  }, [filtered, matches, selectedNamespace])
  // Counts exclude the synthetic '' row so the footer reflects real namespaces.
  const shownCount = visible.filter((ns) => ns !== '').length
  const hiddenCount = matches.length - shownCount
  // The fetch itself was capped, so even `matches` is only a slice of the
  // cluster — the filter above cannot reach the rest. Gate this on the continue
  // token, never on `total`: the count is optional and a server that omits it
  // would otherwise make a truncated list look complete.
  const fetchedIsPartial = Boolean(truncated)

  function labelForNamespace(ns: string) {
    return ns || 'All namespaces'
  }

  return (
    <Combobox
      modal
      items={visible}
      filter={null}
      value={selectedNamespace}
      onInputValueChange={(value) => setQuery(value)}
      onOpenChange={(isOpen) => {
        // Reset the filter each fresh open so the full (capped) list shows.
        if (isOpen) {
          setQuery('')
          // Lazy fetch: the list is only loaded once the user asks for it.
          onOpen?.()
        }
      }}
      onValueChange={(value) => {
        onSelectNamespace?.(value ?? '')
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
      }}
      itemToStringLabel={(ns) => ns}
      autoHighlight
    >
      <ComboboxInput
        aria-label="Select namespace"
        placeholder="All namespaces"
        variant="ghost"
        showTrigger={!selectedNamespace}
        endAdornment={
          selectedNamespace ? (
            <button
              type="button"
              aria-label="Clear namespace"
              title="Clear namespace"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onSelectNamespace?.('')
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur()
                }
              }}
              className="flex h-full w-6 flex-shrink-0 items-center justify-center rounded-md text-tertiary outline-none transition-colors hover:bg-zGray-800/70 hover:text-main"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null
        }
        className="h-7 w-[220px] max-w-[220px] text-secondary hover:bg-zGray-800/60 focus-within:ring-1 focus-within:ring-zGray-700"
        inputClassName="px-2 text-[12.5px]"
      />
      <ComboboxContent className="w-[260px] max-h-[420px] bg-zGray-850 p-0 [padding-block:0]">
        <ComboboxList className="max-h-[340px] overflow-auto p-0 [padding-block:0]">
          {(ns) => (
            <Fragment key={ns === '' ? '__all__' : ns}>
              <ComboboxItem value={ns}>{labelForNamespace(String(ns))}</ComboboxItem>
              {ns === '' && namespaces.length > 0 && (
                <ComboboxSeparator className="my-1 h-px bg-zGray-800" />
              )}
            </Fragment>
          )}
        </ComboboxList>
        {loading ? (
          <div className="border-t border-zGray-800 px-2 py-1.5 text-[11.5px] text-tertiary">
            Loading namespaces…
          </div>
        ) : hiddenCount > 0 || fetchedIsPartial ? (
          <div className="border-t border-zGray-800 px-2 py-1.5 text-[11.5px] text-tertiary">
            Showing {shownCount} of {matches.length.toLocaleString()} — type to filter
            {/* Naming the real total matters: on a cluster with tens of
                thousands of namespaces the fetched page is a rounding error,
                and only what we fetched is searchable here. */}
            {fetchedIsPartial && (
              <div className="mt-0.5 text-tertiary/80">
                Searching the first {namespaces.length.toLocaleString()}
                {total != null ? ` of ${total.toLocaleString()}` : ''} namespaces in this cluster
              </div>
            )}
          </div>
        ) : null}
      </ComboboxContent>
    </Combobox>
  )
}

export function RefreshButton({
  onRefresh,
  loading,
}: {
  onRefresh: () => void
  loading?: boolean
}) {
  return (
    <button
      onClick={onRefresh}
      className="w-7 h-7 rounded-md hover:bg-zGray-800/60 text-secondary hover:text-main flex items-center justify-center"
      title="Refresh"
      aria-label="Refresh"
    >
      <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} strokeWidth={2} />
    </button>
  )
}
