import { ChevronRight, Database, Loader2 } from 'lucide-react'

import { formatBytes, formatCount, SYSTEM_DATABASES, typeLabel } from './schemaFormat'
import { CenteredLoader, CollectionGlyph, SafetyNotice } from './schemaShared'

import type { MongoCollectionSummary, MongoDatabaseCatalog } from '../../types'

export function DatabasesSidebar({
  catalog,
  loading,
  selectedDatabase,
  onSelect,
}: {
  catalog: MongoDatabaseCatalog | null
  loading: boolean
  selectedDatabase: string | null
  onSelect: (name: string) => void
}) {
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-zGray-800 bg-zGray-900/45 p-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
          Databases
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-tertiary" />}
      </div>
      {catalog?.databases.map((database) => (
        <button
          key={database.name}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onSelect(database.name)
          }}
          onClick={(event) => {
            // Keyboard only — pointer presses already fired at pointerdown.
            if (event.detail !== 0) return
            onSelect(database.name)
          }}
          className={`mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${selectedDatabase === database.name ? 'bg-zGray-700/70 text-main' : 'text-secondary hover:bg-zGray-800/60 hover:text-main'}`}
        >
          <Database
            className={`h-3.5 w-3.5 shrink-0 ${SYSTEM_DATABASES.has(database.name) ? 'text-tertiary' : 'text-[#47A248]'}`}
          />
          <span className="min-w-0 flex-1 truncate">{database.name}</span>
          {SYSTEM_DATABASES.has(database.name) && (
            <span className="text-[9px] text-tertiary">system</span>
          )}
        </button>
      ))}
      {!loading && catalog?.databases.length === 0 && (
        <div className="px-2 py-5 text-center text-[11.5px] text-tertiary">
          No authorized databases
        </div>
      )}
      {catalog?.truncated && (
        <SafetyNotice compact text="Database list limited by the metadata safety budget." />
      )}
    </aside>
  )
}

export function CollectionList({
  collections,
  loading,
  truncated,
  onOpen,
}: {
  collections: MongoCollectionSummary[]
  loading: boolean
  truncated: boolean
  onOpen: (collection: MongoCollectionSummary) => void
}) {
  if (loading) return <CenteredLoader />
  if (collections.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center text-[12px] text-tertiary">
        No collections found in this database.
      </div>
    )
  }

  return (
    <div className="h-[508px] overflow-auto">
      {truncated && (
        <SafetyNotice text="Collection list limited by the metadata safety budget. Refine the database scope if an expected collection is missing." />
      )}
      <table className="w-full text-left text-[11.5px]">
        <thead className="sticky top-0 z-10 bg-zGray-900 text-tertiary">
          <tr className="border-b border-zGray-800">
            <th className="px-4 py-2.5 font-medium">Collection</th>
            <th className="px-3 py-2.5 font-medium">Documents</th>
            <th className="px-3 py-2.5 font-medium">Avg. size</th>
            <th className="px-3 py-2.5 font-medium">Storage</th>
            <th className="px-3 py-2.5 font-medium">Indexes</th>
            <th className="w-8 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {collections.map((collection) => (
            <tr
              key={collection.name}
              onClick={() => onOpen(collection)}
              className="border-b border-zGray-800/70 text-secondary hover:bg-zGray-800/35 hover:text-main"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <CollectionGlyph type={collection.type} />
                  <span className="font-medium">{collection.name}</span>
                  <span className="rounded bg-zGray-800 px-1.5 py-0.5 text-[9.5px] text-tertiary">
                    {typeLabel(collection.type)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2.5 tabular-nums">{formatCount(collection.documentCount)}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {formatBytes(collection.avgDocumentSize)}
              </td>
              <td className="px-3 py-2.5 tabular-nums">{formatBytes(collection.storageSize)}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatCount(collection.indexCount)}</td>
              <td className="px-2 py-2.5">
                <ChevronRight className="h-3.5 w-3.5 text-tertiary" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
