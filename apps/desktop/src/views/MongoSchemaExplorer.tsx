import { ArrowLeft, FolderClosed, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../api'
import { InputGroup, InputGroupInput } from '../components/ui/input-group'

import { CollectionList, DatabasesSidebar } from './mongo/SchemaBrowserPanes'
import { CollectionDetail } from './mongo/SchemaCollectionDetail'
import { SYSTEM_DATABASES } from './mongo/schemaFormat'
import { useResetOnKey } from './useResetOnKey'

import type {
  DatabaseConnection,
  MongoCollectionCatalog,
  MongoCollectionDetail,
  MongoCollectionSummary,
  MongoDatabaseCatalog,
} from '../types'
import type { DetailTab } from './mongo/schemaFormat'

type Props = {
  teamId: string
  connection: DatabaseConnection
}

export function MongoSchemaExplorer({ teamId, connection }: Props) {
  const [catalog, setCatalog] = useState<MongoDatabaseCatalog | null>(null)
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)
  const [collections, setCollections] = useState<MongoCollectionCatalog | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<MongoCollectionSummary | null>(null)
  const [detail, setDetail] = useState<MongoCollectionDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('Documents')
  const [search, setSearch] = useState('')
  // The catalog fetch starts on mount, so the spinner is on from the first frame.
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [loadingCollections, setLoadingCollections] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(
    (refresh = false) =>
      api
        .atlasGetMongoDatabaseCatalog(teamId, connection.id, refresh)
        .then((next) => {
          setCatalog(next)
          setSelectedDatabase((current) => {
            if (current && next.databases.some((database) => database.name === current))
              return current
            if (
              connection.databaseName &&
              next.databases.some((database) => database.name === connection.databaseName)
            ) {
              return connection.databaseName
            }

            return (
              next.databases.find((database) => !SYSTEM_DATABASES.has(database.name))?.name ??
              next.databases[0]?.name ??
              null
            )
          })
        })
        .catch((cause: unknown) => {
          setError(parseAtlasError(cause).message)
          setCatalog({ databases: [], truncated: false, fetchedAt: new Date().toISOString() })
        })
        .finally(() => {
          setLoadingCatalog(false)
        }),
    [teamId, connection.id, connection.databaseName],
  )

  const loadCollections = useCallback(
    (database: string, refresh = false) =>
      api
        .atlasGetMongoCollectionCatalog(teamId, connection.id, database, refresh)
        .then((next) => {
          setCollections(next)
        })
        .catch((cause: unknown) => {
          setError(parseAtlasError(cause).message)
          setCollections({
            database,
            collections: [],
            truncated: false,
            fetchedAt: new Date().toISOString(),
          })
        })
        .finally(() => {
          setLoadingCollections(false)
        }),
    [teamId, connection.id],
  )

  const openCollection = useCallback(
    async (collection: MongoCollectionSummary, refresh = false) => {
      if (!selectedDatabase) return
      setSelectedCollection(collection)
      setDetail(null)
      setDetailTab('Documents')
      setLoadingDetail(true)
      setError(null)
      try {
        setDetail(
          await api.atlasGetMongoCollectionDetail(
            teamId,
            connection.id,
            selectedDatabase,
            collection.name,
            refresh,
          ),
        )
      } catch (cause) {
        setError(parseAtlasError(cause).message)
      } finally {
        setLoadingDetail(false)
      }
    },
    [teamId, connection.id, selectedDatabase],
  )

  // The two loaders below are also driven from the refresh button, so their
  // "entering loading" state lives with each caller rather than inside them.
  useResetOnKey(`${teamId}|${connection.id}|${connection.databaseName ?? ''}`, () => {
    setLoadingCatalog(true)
    setError(null)
  })
  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])
  useResetOnKey(`${teamId}|${connection.id}|${selectedDatabase ?? ''}`, () => {
    if (!selectedDatabase) return
    setLoadingCollections(true)
    setError(null)
    setSelectedCollection(null)
    setDetail(null)
  })
  useEffect(() => {
    if (selectedDatabase) void loadCollections(selectedDatabase)
  }, [selectedDatabase, loadCollections])

  const filteredCollections = useMemo(() => {
    const needle = search.trim().toLowerCase()

    if (!needle) return collections?.collections ?? []

    return (collections?.collections ?? []).filter((collection) =>
      collection.name.toLowerCase().includes(needle),
    )
  }, [collections, search])

  async function refresh() {
    if (selectedCollection) {
      await openCollection(selectedCollection, true)

      return
    }
    if (selectedDatabase) {
      setLoadingCollections(true)
      setError(null)
      setSelectedCollection(null)
      setDetail(null)
      await loadCollections(selectedDatabase, true)

      return
    }
    setLoadingCatalog(true)
    setError(null)
    await loadCatalog(true)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900/20">
      <div className="flex h-[560px] min-h-0">
        <DatabasesSidebar
          catalog={catalog}
          loading={loadingCatalog}
          selectedDatabase={selectedDatabase}
          onSelect={setSelectedDatabase}
        />

        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-12 items-center gap-2 border-b border-zGray-800 px-4">
            {selectedCollection ? (
              <button
                onClick={() => {
                  setSelectedCollection(null)
                  setDetail(null)
                }}
                className="mr-1 rounded p-1 text-tertiary hover:bg-zGray-800 hover:text-main"
                title="Back to collections"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <FolderClosed className="h-4 w-4 text-[#47A248]" />
            )}
            <div className="min-w-0 flex-1 truncate text-[13px] text-main">
              {selectedDatabase ?? 'Select a database'}
              {selectedCollection && (
                <>
                  <span className="mx-1.5 text-tertiary">/</span>
                  {selectedCollection.name}
                </>
              )}
            </div>
            {!selectedCollection && (
              <InputGroup
                render={<label />}
                className="flex w-56 items-center gap-1.5 rounded-md border border-zGray-800 bg-field px-2 py-1 text-tertiary"
              >
                <Search className="h-3.5 w-3.5" />
                <InputGroupInput
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search collections"
                  className="text-[11.5px] text-main"
                />
              </InputGroup>
            )}
            <button
              onClick={() => void refresh()}
              className="rounded p-1.5 text-tertiary hover:bg-zGray-800 hover:text-main"
              title="Refresh metadata"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingCollections || loadingDetail ? 'animate-spin' : ''}`}
              />
            </button>
          </div>

          {error && (
            <div className="mx-4 mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11.5px] text-error">
              {error}
            </div>
          )}
          {selectedCollection ? (
            <CollectionDetail
              teamId={teamId}
              connectionId={connection.id}
              detail={detail}
              loading={loadingDetail}
              tab={detailTab}
              onTab={setDetailTab}
            />
          ) : (
            <CollectionList
              collections={filteredCollections}
              loading={loadingCollections}
              truncated={collections?.truncated ?? false}
              onOpen={(collection) => void openCollection(collection)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
