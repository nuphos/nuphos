import { MongoClient } from 'mongodb'

import { config } from '@/config'
import { instrumentMongoClient } from '@/otel/instrumentation/mongo'

import type { Db } from 'mongodb'

export const mongo = new MongoClient(config.mongoUri, {
  appName: new URLSearchParams(config.mongoUri.split('?')[1]).get('appName') ?? 'nuphos-backend',
  // Surfaces commandStarted/Succeeded/Failed events used by the OTel mongo
  // instrumentation. We gate on the master OTEL_ENABLED flag so deploys that
  // never opt in don't pay the per-command APM event allocation — the driver
  // emits these regardless of whether any listeners are registered.
  monitorCommands: config.otel.enabled,
})

instrumentMongoClient(mongo)

let _db: Db | undefined

export async function connectDb(): Promise<Db> {
  if (_db) return _db
  await mongo.connect()
  _db = mongo.db(config.mongoDb)

  return _db
}

export function db(): Db {
  if (!_db) throw new Error('Database not connected. Call connectDb() first.')

  return _db
}

export async function closeDb(): Promise<void> {
  await mongo.close()
  _db = undefined
}
