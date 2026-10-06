import { config } from '@/config'

export const AGENT_TRIGGER_QUEUE = 'atlas-agent-triggers'

export function buildBullMQConnection() {
  // Mirror lib/redis.ts buildOptions() and fail loudly when Redis is enabled
  // but sentinels are missing, so the misconfiguration shows up at startup
  // instead of silently disabling cron triggers.
  if (config.redis.sentinels.length === 0) {
    throw new Error('ATLAS_REDIS_SENTINELS must list at least one host:port')
  }
  const sentinels = config.redis.sentinels.map((entry) => {
    const [host, portStr] = entry.split(':')

    if (!host) throw new Error(`Invalid ATLAS_REDIS_SENTINELS entry: ${entry}`)

    return { host, port: portStr ? Number(portStr) : 26379 }
  })
  const natMap: Record<string, { host: string; port: number }> = {}

  for (const entry of config.redis.natMap) {
    const [from, to, ...extra] = entry.split('=')

    if (!from || !to || extra.length > 0) {
      throw new Error(`Invalid ATLAS_REDIS_NAT_MAP entry: ${entry}`)
    }
    const [fromHost, fromPortStr] = from.split(':')

    if (!fromHost || !fromPortStr) {
      throw new Error(`Invalid ATLAS_REDIS_NAT_MAP source: ${from}`)
    }
    const fromPort = Number(fromPortStr)

    if (!Number.isInteger(fromPort) || fromPort < 1 || fromPort > 65535) {
      throw new Error(`Invalid ATLAS_REDIS_NAT_MAP source port: ${from}`)
    }
    const [toHost, toPortStr] = to.split(':')

    if (!toHost || !toPortStr) throw new Error(`Invalid ATLAS_REDIS_NAT_MAP target: ${to}`)
    const toPort = Number(toPortStr)

    if (!Number.isInteger(toPort) || toPort < 1 || toPort > 65535) {
      throw new Error(`Invalid ATLAS_REDIS_NAT_MAP target port: ${to}`)
    }
    natMap[`${fromHost}:${String(fromPort)}`] = { host: toHost, port: toPort }
  }

  return {
    sentinels,
    name: config.redis.masterName,
    password: config.redis.password,
    sentinelPassword: config.redis.password,
    db: config.redis.db,
    ...(Object.keys(natMap).length > 0 ? { natMap } : {}),
  }
}
