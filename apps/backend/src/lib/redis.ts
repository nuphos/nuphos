import { randomBytes } from 'node:crypto'

import Redis from 'ioredis'

import { config } from '@/config'
import { errorTelemetryProperties, logEvent } from '@/lib/observability'
import { instrumentRedis } from '@/otel/instrumentation/redis'

import { REDIS_OP_TIMEOUT_MESSAGE, createRedisWedgeDetector } from './redis-wedge'

import type { RedisOptions } from 'ioredis'

// Stable identity per backend pod. HOSTNAME is set by k8s to the pod name; on
// a dev machine it's typically unset, so we generate a random id per process
// rather than falling back to the machine hostname (which would collide across
// two local processes running on the same workstation).
export const replicaId: string =
  config.hostname ?? `atlas-${String(process.pid)}-${randomBytes(4).toString('hex')}`

let _client: Redis | null = null
let _subscriber: Redis | null = null
const wedge = createRedisWedgeDetector(() => {
  logEvent('warn', 'redis.client.forced_reconnect', { replica_id: replicaId })
  _client?.disconnect(true)
})

function buildOptions(): RedisOptions {
  if (config.redis.sentinels.length === 0) {
    throw new Error('ATLAS_REDIS_SENTINELS must list at least one host:port')
  }
  const sentinels = config.redis.sentinels.map((entry) => {
    const [host, portStr] = entry.split(':')

    if (!host) throw new Error(`Invalid ATLAS_REDIS_SENTINELS entry: ${entry}`)
    const port = portStr ? Number(portStr) : 26379

    if (!Number.isFinite(port)) throw new Error(`Invalid sentinel port in ${entry}`)

    return { host, port }
  })
  const natMap: Record<string, { host: string; port: number }> = {}

  for (const entry of config.redis.natMap) {
    const [from, to] = entry.split('=')

    if (!from || !to) throw new Error(`Invalid ATLAS_REDIS_NAT_MAP entry: ${entry}`)
    const [toHost, toPortStr] = to.split(':')

    if (!toHost || !toPortStr) throw new Error(`Invalid ATLAS_REDIS_NAT_MAP target: ${to}`)
    const toPort = Number(toPortStr)

    if (!Number.isFinite(toPort)) throw new Error(`Invalid ATLAS_REDIS_NAT_MAP port: ${to}`)
    natMap[from] = { host: toHost, port: toPort }
  }

  return {
    sentinels,
    name: config.redis.masterName,
    password: config.redis.password,
    sentinelPassword: config.redis.password,
    db: config.redis.db,
    ...(Object.keys(natMap).length > 0 ? { natMap } : {}),
    // Per-op fail-fast is enforced by the withRedis() timeout wrapper. The
    // offline queue covers the brief window between client construction and
    // first connection; maxRetriesPerRequest stops commands from looping
    // forever while Redis is unhealthy.
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number) => Math.min(times * 200, 2_000),
  }
}

export function redisEnabled(): boolean {
  return config.redis.enabled
}

export function getRedis(): Redis {
  if (!_client) {
    _client = new Redis(buildOptions())
    _client.on('error', (err) => {
      logEvent('warn', 'redis.client.error', {
        role: 'client',
        replica_id: replicaId,
        ...errorTelemetryProperties(err),
      })
    })
    instrumentRedis(_client, { role: 'client' })
  }

  return _client
}

export function getSubscriber(): Redis {
  if (!_subscriber) {
    _subscriber = new Redis(buildOptions())
    _subscriber.on('error', (err) => {
      logEvent('warn', 'redis.client.error', {
        role: 'subscriber',
        replica_id: replicaId,
        ...errorTelemetryProperties(err),
      })
    })
    instrumentRedis(_subscriber, { role: 'subscriber' })
  }

  return _subscriber
}

/** Run a Redis op with a strict timeout. Returns null on disable / timeout / error
 *  so callers can fall back without try/catch noise. Logs at warn on failure.
 *
 *  Note: when the timeout wins the race, the underlying ioredis command keeps
 *  running until it completes or its own connection times out. We attach a
 *  no-op `.catch` so a late rejection from that abandoned promise doesn't
 *  surface as an unhandled rejection (which Bun treats as fatal). The server-
 *  side side-effect can still land later — callers that need stronger
 *  semantics (e.g. compare-and-delete) use Lua scripts. */
export async function withRedis<T>(op: (client: Redis) => Promise<T>): Promise<T | null> {
  if (!redisEnabled()) return null
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const opPromise = op(getRedis())

    opPromise.catch(() => {})
    const result = await Promise.race<T>([
      opPromise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(REDIS_OP_TIMEOUT_MESSAGE))
        }, config.redis.opTimeoutMs)
      }),
    ])

    wedge.success()

    return result
  } catch (err) {
    wedge.failure(err)
    logEvent('warn', 'redis.operation.failed', {
      replica_id: replicaId,
      ...errorTelemetryProperties(err),
    })

    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function pingRedis(): Promise<boolean> {
  const result = await withRedis((c) => c.ping())

  return result === 'PONG'
}

export async function closeRedis(): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (_client) tasks.push(_client.quit().catch(() => {}))
  if (_subscriber) tasks.push(_subscriber.quit().catch(() => {}))
  await Promise.allSettled(tasks)
  _client = null
  _subscriber = null
}
