import { randomUUID } from 'node:crypto'

import { getRedis, getSubscriber, reconnectSubscriber, redisEnabled } from '@/lib/redis'

import { processSingleton } from './singleton'

export type TunnelBusHandler = (message: string) => void

export type TunnelBus = {
  /** How many subscribers received the message: pub/sub keeps nothing for one that is not listening. */
  publish(channel: string, message: string): Promise<number>
  /** Resolves once the subscription is live, so a publish that follows cannot race past it. */
  subscribe(channel: string, handler: TunnelBusHandler): Promise<() => void>
  /** A tunnel heard nothing on its channel: replace the shared subscription if it is the cause. */
  reconnect?(): void
}

type Handlers = Map<string, Set<TunnelBusHandler>>

function deliver(handlers: Handlers, channel: string, message: string): void {
  for (const handler of [...(handlers.get(channel) ?? [])]) handler(message)
}

function remove(handlers: Handlers, channel: string, handler: TunnelBusHandler): boolean {
  const set = handlers.get(channel)

  set?.delete(handler)
  if (set?.size) return false
  handlers.delete(channel)

  return true
}

/** Single-process delivery, for a backend running without Redis and for tests. */
export function createLocalTunnelBus(): TunnelBus {
  const handlers: Handlers = new Map()

  return {
    publish(channel, message) {
      queueMicrotask(() => {
        deliver(handlers, channel, message)
      })

      return Promise.resolve(handlers.get(channel)?.size ?? 0)
    },
    subscribe(channel, handler) {
      const set = handlers.get(channel) ?? new Set()

      set.add(handler)
      handlers.set(channel, set)

      return Promise.resolve(() => {
        remove(handlers, channel, handler)
      })
    },
  }
}

const PROBE_MS = 5_000

/**
 * One tunnel hearing nothing does not show the shared subscriber is deaf: that
 * tunnel's channel or its publish may be what failed. Replacing the subscriber
 * cuts every stream on the replica, so it happens only when the subscriber misses
 * a probe of its own, and never when the probe could not even be published.
 */
export function guardedReconnect(
  bus: Pick<TunnelBus, 'publish' | 'subscribe'>,
  reconnect: () => void,
  probeMs = PROBE_MS,
): () => void {
  let probing = false

  return () => {
    if (probing) return
    probing = true
    void subscriberHears(bus, probeMs)
      .then((heard) => {
        if (heard === false) reconnect()
      })
      .finally(() => {
        probing = false
      })
  }
}

/** Whether a probe came back; undefined when it could not be published. */
async function subscriberHears(
  bus: Pick<TunnelBus, 'publish' | 'subscribe'>,
  probeMs: number,
): Promise<boolean | undefined> {
  const channel = `atlas:tunnel:probe:${randomUUID()}`
  let heard = () => {}
  const echo = new Promise<true>((resolve) => {
    heard = () => resolve(true)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const silence = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), probeMs)
  })
  const unsubscribe = bus.subscribe(channel, () => heard())

  try {
    return await Promise.race([
      unsubscribe
        .then(() => bus.publish(channel, 'probe'))
        .then(
          () => echo,
          () => undefined,
        ),
      silence,
    ])
  } finally {
    clearTimeout(timer)
    void unsubscribe.then(
      (off) => off(),
      () => {},
    )
  }
}

/** Frames publish on the shared client connection, so one replica's frames stay in order. */
export function createRedisTunnelBus(): TunnelBus {
  const handlers: Handlers = new Map()
  const ready = new Map<string, Promise<unknown>>()
  const leaving = new Map<string, Promise<unknown>>()
  let listening = false

  const listen = () => {
    if (listening) return
    listening = true
    getSubscriber().on('message', (channel: string, message: string) => {
      deliver(handlers, channel, message)
    })
  }

  const bus: TunnelBus = {
    publish(channel, message) {
      return getRedis().publish(channel, message)
    },
    async subscribe(channel, handler) {
      listen()
      const set = handlers.get(channel) ?? new Set()

      set.add(handler)
      handlers.set(channel, set)
      let subscribed = ready.get(channel)

      if (!subscribed) {
        subscribed = (leaving.get(channel) ?? Promise.resolve()).then(() =>
          getSubscriber().subscribe(channel),
        )
        ready.set(channel, subscribed)
      }
      const unsubscribe = () => {
        if (!remove(handlers, channel, handler)) return
        const previous = ready.get(channel) ?? Promise.resolve()

        ready.delete(channel)
        const left: Promise<unknown> = previous
          .catch(() => undefined)
          .then(() => getSubscriber().unsubscribe(channel))
          .catch(() => undefined)
          .finally(() => {
            if (leaving.get(channel) === left) leaving.delete(channel)
          })

        leaving.set(channel, left)
      }

      try {
        await subscribed
      } catch (error) {
        unsubscribe()
        throw error
      }

      return unsubscribe
    },
  }

  bus.reconnect = guardedReconnect(bus, reconnectSubscriber)

  return bus
}

export function tunnelBus(): TunnelBus {
  return processSingleton('bus', () =>
    redisEnabled() ? createRedisTunnelBus() : createLocalTunnelBus(),
  )
}
