// What a backend needs to run as one of several replicas, as on Nuphos Cloud: a shared Redis, and
// a rolling deploy that starts a new replica before the old one drains.
import { readFileSync } from 'node:fs'

import { freePorts, logPath, signalGroup, spawn, until } from './processes.ts'

import type { ChildProcess } from 'node:child_process'

const REDIS_IMAGE = 'redis:7.4-alpine'

/** A Redis and the Sentinel the backend finds it through. */
export async function startRedis(): Promise<Record<string, string>> {
  const [redisPort, sentinelPort] = (await freePorts(2)).map(String)
  const run = ['docker', 'run', '--rm', '--network', 'host', REDIS_IMAGE]
  const sentinel = [
    `port ${sentinelPort}`,
    'bind 127.0.0.1',
    `sentinel monitor mymaster 127.0.0.1 ${redisPort} 1`,
  ].join('\\n')

  spawn('redis', [...run, 'redis-server', '--bind', '127.0.0.1', '--port', redisPort, '--save', ''])
  spawn('sentinel', [
    ...run,
    'sh',
    '-c',
    `printf '${sentinel}' > /tmp/s.conf && redis-sentinel /tmp/s.conf`,
  ])
  await until('Redis Sentinel to name a master', async () =>
    readFileSync(logPath('sentinel'), 'utf8').includes('+monitor master mymaster'),
  )

  return { ATLAS_REDIS_ENABLED: 'true', ATLAS_REDIS_SENTINELS: `127.0.0.1:${sentinelPort}` }
}

/** Starts a replica on its own address and, once it is ready, sends the newest one SIGTERM. */
export async function rollBackend(
  backends: ChildProcess[],
  start: (name: string, port: number, url: string) => ChildProcess,
) {
  const [port] = await freePorts(1)
  const url = `http://127.0.0.1:${String(port)}`
  const name = `backend-${String(backends.length + 1)}`
  const old = backends.at(-1)!
  const exited = new Promise<void>((done) => old.once('exit', () => done()))

  backends.push(start(name, port, url))
  await until('the new replica to be ready', async () => (await fetch(`${url}/health/ready`)).ok)
  signalGroup(old, 'SIGTERM')

  return { apiUrl: url, log: logPath(name), exited }
}
