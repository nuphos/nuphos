import postgres from 'postgres'

import { classifyDatabaseError } from '@/lib/database-connections'
import { databaseMongoClient } from '@/lib/database-mongo-client'

import type { ParsedDatabaseConnection } from '@/lib/database-connections'
import type { MongoNetworkOptions } from '@/lib/database-network'
import type { DatabaseConnectionHealth, DatabaseReadOnlyCapability } from '@/models'

const DEFAULT_TIMEOUT_MS = 5_000

function unknownHealth(startedAt: number, error: unknown): DatabaseConnectionHealth {
  const classified = classifyDatabaseError(error)

  return {
    status: classified.status,
    errorCategory: classified.category,
    message: classified.message,
    checkedAt: new Date(),
    latencyMs: Date.now() - startedAt,
    databaseName: null,
    serverVersion: null,
    readOnly: 'unverified',
  }
}

function mongoReadOnlyCapability(roles: { role?: unknown }[]): DatabaseReadOnlyCapability {
  const names = roles
    .map((item) => (typeof item.role === 'string' ? item.role : ''))
    .filter(Boolean)

  if (
    names.some((name) =>
      /^(root|dbOwner|readWrite|readWriteAnyDatabase|userAdmin|userAdminAnyDatabase|dbAdmin|dbAdminAnyDatabase|clusterAdmin|hostManager|restore|backup)$/i.test(
        name,
      ),
    )
  ) {
    return 'writable'
  }
  if (
    names.length > 0 &&
    names.every((name) => /^(read|readAnyDatabase|clusterMonitor)$/i.test(name))
  ) {
    return 'verified'
  }

  // Custom roles cannot be proven read-only without usersInfo/showPrivileges,
  // which the least-privilege account often cannot call. Never guess.
  return 'unverified'
}

async function probeMongo(
  parsed: ParsedDatabaseConnection,
  timeoutMs: number,
  network: MongoNetworkOptions,
): Promise<DatabaseConnectionHealth> {
  const startedAt = Date.now()
  const client = databaseMongoClient(
    parsed.connectionUri,
    {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
      socketTimeoutMS: timeoutMs,
      maxPoolSize: 1,
      minPoolSize: 0,
    },
    network,
  )

  try {
    await client.connect()
    const database = client.db(parsed.databaseName ?? undefined)

    await database.command({ ping: 1 }, { timeoutMS: timeoutMs })

    let serverVersion: string | null = null
    let readOnly: DatabaseReadOnlyCapability = 'unverified'

    try {
      const buildInfo = await database.admin().command({ buildInfo: 1 }, { timeoutMS: timeoutMs })

      serverVersion = typeof buildInfo.version === 'string' ? buildInfo.version : null
    } catch {
      // Version discovery is metadata-only and may be denied independently of
      // database reads. Keep the connection healthy but do not invent a value.
    }
    try {
      const status = (await database.command(
        { connectionStatus: 1, showPrivileges: false },
        { timeoutMS: timeoutMs },
      )) as { authInfo?: { authenticatedUserRoles?: { role?: unknown }[] } }

      readOnly = mongoReadOnlyCapability(status.authInfo?.authenticatedUserRoles ?? [])
    } catch {
      // Same rule as version discovery: lack of role-inspection permission is
      // an explicit unverified capability, not a failed health check.
    }

    return {
      status: 'healthy',
      errorCategory: null,
      message:
        readOnly === 'writable'
          ? 'Connection succeeded, but the MongoDB account has a known write-capable role.'
          : readOnly === 'unverified'
            ? 'Connection succeeded, but custom or undiscoverable MongoDB roles could not be proven read-only.'
            : null,
      checkedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      databaseName: database.databaseName || parsed.databaseName,
      serverVersion,
      readOnly,
    }
  } catch (error) {
    return unknownHealth(startedAt, error)
  } finally {
    await client.close().catch(() => undefined)
  }
}

async function probePostgres(
  parsed: ParsedDatabaseConnection,
  timeoutMs: number,
): Promise<DatabaseConnectionHealth> {
  const startedAt = Date.now()
  const sql = postgres(parsed.connectionUri, {
    max: 1,
    connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
    idle_timeout: 1,
    max_lifetime: 5,
    prepare: false,
    onnotice: () => undefined,
    connection: { statement_timeout: timeoutMs },
  })

  try {
    const rows = await sql<
      {
        database_name: string
        version: string
        transaction_read_only: string
        default_transaction_read_only: string
      }[]
    >`
      SELECT
        current_database() AS database_name,
        current_setting('server_version') AS version,
        current_setting('transaction_read_only') AS transaction_read_only,
        current_setting('default_transaction_read_only') AS default_transaction_read_only
    `
    const row = rows[0]
    const readOnly =
      row?.transaction_read_only === 'on' && row.default_transaction_read_only === 'on'
        ? 'verified'
        : 'writable'

    return {
      status: 'healthy',
      errorCategory: null,
      message:
        readOnly === 'writable'
          ? 'Connection succeeded, but PostgreSQL does not default this account to read-only transactions.'
          : null,
      checkedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      databaseName: row?.database_name ?? parsed.databaseName,
      serverVersion: row?.version ?? null,
      readOnly,
    }
  } catch (error) {
    return unknownHealth(startedAt, error)
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
}

export function probeDatabaseConnection(
  parsed: ParsedDatabaseConnection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  mongoNetwork: MongoNetworkOptions = {},
): Promise<DatabaseConnectionHealth> {
  return parsed.engine === 'mongodb'
    ? probeMongo(parsed, timeoutMs, mongoNetwork)
    : probePostgres(parsed, timeoutMs)
}
