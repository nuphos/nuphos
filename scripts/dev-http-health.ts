import type { ChildProcess } from 'node:child_process'

export function waitForHttpHealth(
  child: ChildProcess,
  url: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (healthy: boolean) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      child.off('exit', onExit)
      resolve(healthy)
    }
    const onExit = () => done(false)
    const check = async () => {
      if (Date.now() - started > timeoutMs) return done(false)
      try {
        const response = await fetch(url)

        if (response.ok) done(true)
      } catch {
        // The local service is still starting.
      }
    }
    const timer = setInterval(() => void check(), 400)

    child.once('exit', onExit)
    void check()
  })
}
