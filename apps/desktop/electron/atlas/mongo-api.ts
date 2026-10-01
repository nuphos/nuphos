import { call } from './client'

import type { DatabaseQueryResult } from './database-types'
import type {
  MongoCollectionCatalog,
  MongoCollectionDetail,
  MongoDatabaseCatalog,
  MongoMonitoringHistory,
  MongoMonitoringSample,
  MongoReadQueryInput,
} from './mongo-types'

export async function getMongoDatabaseCatalog(
  teamId: string,
  connectionId: string,
  refresh = false,
): Promise<MongoDatabaseCatalog> {
  const query = new URLSearchParams({ refresh: String(refresh) })

  return call(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/catalog?${String(query)}`,
    undefined,
    { timeoutMs: 30_000 },
  )
}

export async function getMongoCollectionCatalog(
  teamId: string,
  connectionId: string,
  database: string,
  refresh = false,
): Promise<MongoCollectionCatalog> {
  const query = new URLSearchParams({ database, refresh: String(refresh) })

  return call(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/catalog/collections?${String(query)}`,
    undefined,
    { timeoutMs: 30_000 },
  )
}

export async function getMongoCollectionDetail(
  teamId: string,
  connectionId: string,
  database: string,
  collection: string,
  refresh = false,
): Promise<MongoCollectionDetail> {
  const query = new URLSearchParams({ database, collection, refresh: String(refresh) })

  return call(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/catalog/collection?${String(query)}`,
    undefined,
    { timeoutMs: 30_000 },
  )
}

export async function queryMongoDatabase(
  teamId: string,
  connectionId: string,
  input: MongoReadQueryInput,
): Promise<DatabaseQueryResult> {
  return call(
    'POST',
    `/teams/${teamId}/database-connections/${connectionId}/query/mongodb`,
    input,
    {
      retry: false,
      timeoutMs: 20_000,
    },
  )
}

export async function getMongoMonitoringHistory(
  teamId: string,
  connectionId: string,
  rangeMinutes = 60,
): Promise<MongoMonitoringHistory> {
  const query = new URLSearchParams({ rangeMinutes: String(rangeMinutes) })

  return call(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/monitoring?${String(query)}`,
  )
}

export async function sampleMongoMonitoring(
  teamId: string,
  connectionId: string,
): Promise<MongoMonitoringSample> {
  return call(
    'POST',
    `/teams/${teamId}/database-connections/${connectionId}/monitoring/sample`,
    {},
    {
      retry: false,
      timeoutMs: 20_000,
    },
  )
}
