import type { ChildProcess } from 'node:child_process'

type Result = Record<string, unknown>
type Frame = { id?: number; method?: string; result?: Result; error?: unknown }

/** JSON-RPC over an adapter's stdio, for one model probe. */
export type AdapterRpc = {
  call: (method: string, params: unknown) => Promise<Result>
  /** Rejects every request still waiting; later calls reject at once. */
  stop: (error: Error) => void
}

/**
 * Talks to the probed adapter. An adapter can exit at any moment (a bad
 * install, a sign-in it cannot read), and a write to its closed stdin fails
 * with EPIPE: with no listener that is an uncaught exception in the main
 * process. Every such failure, the child's own error and its exit included,
 * is reported once to `fail` instead, and never thrown.
 */
export function adapterRpc(child: ChildProcess, fail: (error: Error) => void): AdapterRpc {
  const waiting = new Map<
    number,
    { resolve: (result: Result) => void; reject: (e: Error) => void }
  >()
  let nextId = 1
  let stopped: Error | undefined
  let buffer = ''
  const failOnce = (error: Error) => {
    if (!stopped) fail(error)
  }
  const write = (message: Record<string, unknown>) => {
    const stdin = child.stdin

    if (!stdin || stdin.destroyed || !stdin.writable) {
      failOnce(new Error('The runtime closed its input during model discovery'))

      return
    }
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`, (error) => {
      if (error)
        failOnce(new Error(`Model discovery could not reach the runtime: ${error.message}`))
    })
  }
  const receive = (frame: Frame) => {
    // The adapter asks something of the client: nothing is offered during a probe.
    if (frame.method && frame.id !== undefined) {
      write({ id: frame.id, error: { code: -32601, message: 'Unavailable' } })

      return
    }
    const request = frame.id === undefined ? undefined : waiting.get(frame.id)

    if (!request || frame.id === undefined) return
    waiting.delete(frame.id)
    if (frame.error)
      request.reject(
        new Error(`Model discovery failed: ${JSON.stringify(frame.error).slice(0, 300)}`),
      )
    else request.resolve(frame.result ?? {})
  }

  child.stdin?.on('error', (error) => {
    failOnce(new Error(`Model discovery could not reach the runtime: ${error.message}`))
  })
  child.once('error', (error) => failOnce(error))
  child.once('exit', () => failOnce(new Error('The runtime exited during model discovery')))
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline)

      buffer = buffer.slice(newline + 1)
      try {
        receive(JSON.parse(line) as Frame)
      } catch {
        // Not a JSON-RPC frame: adapters log to stdout too.
      }
    }
  })

  return {
    call: (method, params) =>
      new Promise<Result>((resolve, reject) => {
        if (stopped) {
          reject(stopped)

          return
        }
        const id = nextId++

        waiting.set(id, { resolve, reject })
        write({ id, method, params })
      }),
    stop: (error) => {
      stopped ??= error
      for (const request of waiting.values()) request.reject(stopped)
      waiting.clear()
    },
  }
}
