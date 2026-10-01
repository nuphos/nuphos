/** Stop an orphaned local backend before it can keep reconciling shared runtimes. */
const state = globalThis as typeof globalThis & { __nuphosStopLauncherWatchdog?: () => void }

export function watchDevLauncher(raw: string | undefined, onExit: () => void): () => void {
  state.__nuphosStopLauncherWatchdog?.()
  const pid = Number(raw)

  if (!raw || !/^\d+$/u.test(raw) || !Number.isSafeInteger(pid) || pid <= 1) return () => {}

  const stop = () => {
    clearInterval(timer)
    if (state.__nuphosStopLauncherWatchdog === stop) delete state.__nuphosStopLauncherWatchdog
  }
  const check = () => {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return
      stop()
      onExit()
    }
  }
  const timer = setInterval(check, 1_000)

  timer.unref()
  state.__nuphosStopLauncherWatchdog = stop
  check()

  return stop
}
