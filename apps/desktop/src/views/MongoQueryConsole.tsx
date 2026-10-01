import { Database, Loader2, Table2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { MongoDocumentsExplorer } from './MongoDocumentsExplorer'
import { useResetOnKey } from './useResetOnKey'

import type { DatabaseConnection, MongoCollectionSummary, MongoDatabaseCatalog } from '../types'

export function MongoQueryConsole({
  teamId,
  connection,
}: {
  teamId: string
  connection: DatabaseConnection
}) {
  const [catalog, setCatalog] = useState<MongoDatabaseCatalog | null>(null)
  const [database, setDatabase] = useState<string | null>(null)
  const [collections, setCollections] = useState<MongoCollectionSummary[]>([])
  const [collection, setCollection] = useState<string | null>(null)
  // The catalog fetch starts on mount, so the spinner is on from the first frame.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(
    () =>
      api
        .atlasGetMongoDatabaseCatalog(teamId, connection.id)
        .then((next) => {
          setCatalog(next)
          setDatabase((current) =>
            current && next.databases.some((item) => item.name === current)
              ? current
              : connection.databaseName &&
                  next.databases.some((item) => item.name === connection.databaseName)
                ? connection.databaseName
                : (next.databases.find((item) => !['admin', 'config', 'local'].includes(item.name))
                    ?.name ??
                  next.databases[0]?.name ??
                  null),
          )
        })
        .catch((cause: unknown) => {
          setError(parseAtlasError(cause).message)
        })
        .finally(() => {
          setLoading(false)
        }),
    [teamId, connection.id, connection.databaseName],
  )

  useResetOnKey(`${teamId}|${connection.id}|${connection.databaseName ?? ''}`, () => {
    setLoading(true)
    setError(null)
  })
  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])
  useResetOnKey(`${teamId}|${connection.id}|${database ?? ''}`, () => {
    if (!database) {
      setCollections([])
      setCollection(null)

      return
    }
    setLoading(true)
    setError(null)
    setCollection(null)
  })
  useEffect(() => {
    if (!database) return
    let active = true

    void api
      .atlasGetMongoCollectionCatalog(teamId, connection.id, database)
      .then((next) => {
        if (!active) return
        setCollections(next.collections)
        setCollection(next.collections[0]?.name ?? null)
      })
      .catch((cause: unknown) => {
        if (active) setError(parseAtlasError(cause).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [teamId, connection.id, database])

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900/20">
      <div className="flex h-[620px] min-h-0">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-zGray-800 bg-zGray-900/45 p-2">
          <div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
            <span>Query scope</span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          {catalog?.databases.map((item) => (
            <div key={item.name}>
              <button
                onClick={() => setDatabase(item.name)}
                className={`mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] ${database === item.name ? 'bg-zGray-700/70 text-main' : 'text-secondary hover:bg-zGray-800/60'}`}
              >
                <Database className="h-3.5 w-3.5 text-[#47A248]" />
                <span className="truncate">{item.name}</span>
              </button>
              {database === item.name && (
                <div className="ml-3 border-l border-zGray-800 pl-2">
                  {collections.map((candidate) => (
                    <button
                      key={candidate.name}
                      onClick={() => setCollection(candidate.name)}
                      className={`mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10.5px] ${collection === candidate.name ? 'bg-zViolet-500/10 text-zViolet-accent' : 'text-tertiary hover:text-secondary'}`}
                    >
                      <Table2 className="h-3 w-3" />
                      <span className="truncate">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">
          {error ? (
            <div className="m-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11.5px] text-error">
              {error}
            </div>
          ) : database && collection ? (
            <MongoDocumentsExplorer
              teamId={teamId}
              connectionId={connection.id}
              database={database}
              collection={collection}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11.5px] text-tertiary">
              Select a collection to query.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
