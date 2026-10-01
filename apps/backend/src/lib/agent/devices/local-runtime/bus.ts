import { getRedis, getSubscriber, redisEnabled } from '@/lib/redis'

import { processSingleton } from './singleton'

export type TunnelBusHandler = (message: string) => void

export type TunnelBus = {
  publish(channel: string, message: string): Promise<void>
  /** Resolves once the subscription is live, so a publish that follows cannot race past it. */
  subscribe(channel: string, handler: TunnelBusHandler): Promise<() => void>
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

      return Promise.resolve()
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

  return {
    async publish(channel, message) {
      await getRedis().publish(channel, message)
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
}

export function tunnelBus(): TunnelBus {
  return processSingleton('bus', () =>
    redisEnabled() ? createRedisTunnelBus() : createLocalTunnelBus(),
  )
}
