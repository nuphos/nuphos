import type Redis from 'ioredis'

// Context for the `redis.operation.failed` line, so a burst of timeouts says
// which commands stalled, who sent them and what the connection was doing.
// Command names only: arguments carry keys and values and are never read.

type RedisQueueView = Pick<Redis, 'commandQueue' | 'status'>

const WRAPPER_FRAME = /\/lib\/redis(?:-op-log)?\.ts:/
const MAX_COMMANDS = 5

/** First stack frame outside the Redis wrapper, as `fn (path:line)` relative to src/. */
export function callerFrame(stack: string | undefined): string | undefined {
  const frame = stack
    ?.split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/^at /, ''))
    .find((line) => line && !WRAPPER_FRAME.test(line))

  if (!frame) return undefined
  const src = frame.indexOf('/src/')
  const relative =
    src < 0 ? frame : frame.slice(0, frame.lastIndexOf('(', src) + 1) + frame.slice(src + 5)

  return relative.replace(/:\d+(\)?)$/, '$1')
}

function commandName(client: RedisQueueView, index: number): string | undefined {
  return client.commandQueue.peekAt(index)?.command.name
}

/** Logging must never turn a swallowed Redis failure into a throw. */
function safely<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * Call before an op writes its commands; `sent()` right after the op returns
 * picks up the commands it wrote synchronously, `fields()` describes the
 * failure. Commands written after an await, or while the client is offline,
 * are not seen and leave `command` unset. Nothing here throws.
 */
export function trackRedisOp(client: RedisQueueView) {
  const caller = safely(() => callerFrame(new Error('redis op caller').stack))
  const start = performance.now()
  const queued = safely(() => client.commandQueue.length)
  let command: string | undefined

  return {
    sent(): void {
      command = safely(() => {
        if (queued === undefined) return undefined
        const names = new Set<string>()

        for (let i = queued; i < client.commandQueue.length && names.size < MAX_COMMANDS; i += 1) {
          const name = commandName(client, i)

          if (name) names.add(name)
        }

        return names.size > 0 ? [...names].join(',') : undefined
      })
    },
    fields() {
      return {
        role: 'client',
        caller,
        command,
        elapsed_ms: Math.round(performance.now() - start),
        status: safely(() => client.status),
        in_flight: safely(() => client.commandQueue.length),
        head_command: safely(() => commandName(client, 0)),
      }
    },
  }
}
