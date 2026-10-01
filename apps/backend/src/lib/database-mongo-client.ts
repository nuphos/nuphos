import { MongoClient } from 'mongodb'

import type { MongoNetworkOptions } from '@/lib/database-network'
import type { MongoClientOptions } from 'mongodb'

export type { MongoNetworkOptions } from '@/lib/database-network'

export function databaseMongoClient(
  connectionUri: string,
  options: MongoClientOptions,
  network: MongoNetworkOptions = {},
): MongoClient {
  return new MongoClient(connectionUri, { ...options, ...network })
}
