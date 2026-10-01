import { Database, Loader2, RefreshCw, Table2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { useResetOnKey } from './useResetOnKey'

import type { DatabaseConnection, MongoCollectionCatalog } from '../types'

export function D1SchemaExplorer({
  teamId,
  connection,
}: {
  teamId: string
  connection: DatabaseConnection
}) {
  const [catalog, setCatalog] = useState<MongoCollectionCatalog | null>(null)
  const [loading, setLoading] = useState(Boolean(connection.databaseName))
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (refresh = false) => {
      const databaseName = connection.databaseName

      if (!databaseName) return
      api
        .atlasGetMongoCollectionCatalog(teamId, connection.id, databaseName, refresh)
        .then(setCatalog)
        .catch((cause: unknown) => {
          setError(parseAtlasError(cause).message)
          setCatalog(null)
        })
        .finally(() => setLoading(false))
    },
    [teamId, connection.id, connection.databaseName],
  )

  // `load` is kicked from the effect below, so the pre-fetch reset it used to
  // do lives here instead; the refresh button does it inline.
  useResetOnKey(`${teamId}|${connection.id}|${connection.databaseName ?? ''}`, () => {
    if (!connection.databaseName) return
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900/20">
      <div className="flex h-12 items-center gap-2 border-b border-zGray-800 px-4">
        <Database className="h-4 w-4 text-[#F38020]" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-main">
          {connection.databaseName ?? connection.name}
        </span>
        <span className="rounded bg-zGray-800 px-2 py-0.5 text-[10px] text-tertiary">
          SQLite tables via Cloudflare D1
        </span>
        <button
          onClick={() => {
            setLoading(true)
            setError(null)
            load(true)
          }}
          disabled={loading}
          className="rounded p-1.5 text-tertiary hover:bg-zGray-800 hover:text-main disabled:opacity-50"
          title="Refresh tables"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error ? (
        <div className="m-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11.5px] text-error">
          {error}
        </div>
      ) : loading && !catalog ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
        </div>
      ) : !catalog?.collections.length ? (
        <div className="flex h-56 items-center justify-center text-[12px] text-tertiary">
          No D1 tables found.
        </div>
      ) : (
        <div className="max-h-[508px] overflow-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-zGray-900 text-tertiary">
              <tr className="border-b border-zGray-800">
                <th className="px-4 py-2.5 font-medium">Table</th>
                <th className="px-3 py-2.5 font-medium">Product</th>
                <th className="px-3 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {catalog.collections.map((table) => (
                <tr
                  key={table.name}
                  className="border-b border-zGray-800/70 text-secondary last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-main">
                      <Table2 className="h-4 w-4 text-[#F38020]" />
                      {table.name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">Cloudflare D1</td>
                  <td className="px-3 py-2.5 text-tertiary">
                    Detailed SQLite schema inspection is not enabled in this workspace yet.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
