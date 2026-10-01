import { Hono } from 'hono'

import {
  databaseCatalogCollectionQuerySchema,
  databaseCatalogCollectionsQuerySchema,
  databaseCatalogQuerySchema,
} from '@/lib/api/database-connections'
import { listD1Tables } from '@/lib/byos/cloudflare-d1'
import {
  cachedMongoCatalog,
  getMongoCollectionDetail,
  listMongoCollections,
  listMongoDatabases,
} from '@/lib/database-catalog'
import { classifyDatabaseError } from '@/lib/database-connections'
import {
  probeCloudflareD1Connection,
  resolveCloudflareD1Connection,
} from '@/lib/database-provider-cloudflare'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import {
  connectionNetwork,
  directConnectionUri,
  publicView,
  requireConversationDatabasePolicy,
  requireConnectionAccess,
  requireMongoCatalogConnection,
} from '@/routes/database-connections/shared'

import type { ConnectionVariables } from '@/routes/database-connections/shared'

async function runCatalogOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AppError) throw error
    const classified = classifyDatabaseError(error)

    throw new AppError(502, `database_${classified.category}_failed`, classified.message)
  }
}

export const databaseConnectionCatalogRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionCatalogRoutes.get('/', (c) => {
  const connection = requireConnectionAccess(
    c.get('databaseConnection'),
    c.get('userId'),
    c.get('teamRole'),
  )

  requireConversationDatabasePolicy(c, connection, 'metadata')

  c.header('Cache-Control', 'no-store')

  return c.json(publicView(connection, c.get('userId'), c.get('teamRole')))
})

databaseConnectionCatalogRoutes.get(
  '/catalog',
  zv('query', databaseCatalogQuerySchema),
  async (c) => {
    const raw = requireConnectionAccess(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    requireConversationDatabasePolicy(c, raw, 'metadata')

    if (raw.engine === 'cloudflare-d1') {
      const { database } = await runCatalogOperation(() => probeCloudflareD1Connection(raw))

      c.header('Cache-Control', 'no-store')

      return c.json({
        databases: [
          { name: database.name, sizeOnDisk: database.fileSize, empty: database.numTables === 0 },
        ],
        truncated: false,
        fetchedAt: new Date().toISOString(),
      })
    }
    const connection = requireMongoCatalogConnection(raw, c.get('userId'), c.get('teamRole'))
    const { refresh } = c.req.valid('query')
    const network = await connectionNetwork(connection)
    const result = await runCatalogOperation(() =>
      cachedMongoCatalog([connection._id.toHexString(), 'databases'], refresh, () =>
        listMongoDatabases(directConnectionUri(connection), network.mongoOptions),
      ),
    )

    c.header('Cache-Control', 'no-store')

    return c.json(result)
  },
)

databaseConnectionCatalogRoutes.get(
  '/catalog/collections',
  zv('query', databaseCatalogCollectionsQuerySchema),
  async (c) => {
    const raw = requireConnectionAccess(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    requireConversationDatabasePolicy(c, raw, 'metadata')
    const { database, refresh } = c.req.valid('query')

    if (raw.engine === 'cloudflare-d1') {
      if (database !== raw.databaseName) {
        throw new AppError(
          404,
          'database_not_found',
          'Cloudflare D1 database not found in this resource.',
        )
      }
      const tables = await runCatalogOperation(async () => {
        const { origin, handle } = await resolveCloudflareD1Connection(raw)

        return listD1Tables(handle, origin.externalResourceId)
      })

      c.header('Cache-Control', 'no-store')

      return c.json({
        database,
        collections: tables.map((name) => ({
          name,
          type: 'collection' as const,
          documentCount: null,
          avgDocumentSize: null,
          storageSize: null,
          totalIndexSize: null,
          indexCount: null,
        })),
        truncated: false,
        fetchedAt: new Date().toISOString(),
      })
    }
    const connection = requireMongoCatalogConnection(raw, c.get('userId'), c.get('teamRole'))
    const network = await connectionNetwork(connection)
    const result = await runCatalogOperation(() =>
      cachedMongoCatalog([connection._id.toHexString(), 'collections', database], refresh, () =>
        listMongoCollections(directConnectionUri(connection), database, network.mongoOptions),
      ),
    )

    c.header('Cache-Control', 'no-store')

    return c.json(result)
  },
)

databaseConnectionCatalogRoutes.get(
  '/catalog/collection',
  zv('query', databaseCatalogCollectionQuerySchema),
  async (c) => {
    const connection = requireMongoCatalogConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    requireConversationDatabasePolicy(c, connection, 'metadata')
    const { database, collection, refresh } = c.req.valid('query')
    const network = await connectionNetwork(connection)
    const result = await runCatalogOperation(() =>
      cachedMongoCatalog(
        [connection._id.toHexString(), 'collection', database, collection],
        refresh,
        () =>
          getMongoCollectionDetail(
            directConnectionUri(connection),
            database,
            collection,
            network.mongoOptions,
          ),
      ),
    )

    if (!result)
      throw new AppError(404, 'database_collection_not_found', 'MongoDB collection not found.')
    c.header('Cache-Control', 'no-store')

    return c.json(result)
  },
)
